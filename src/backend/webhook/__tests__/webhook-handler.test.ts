import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationWebhookHandler } from '../handler.js';
import type {
  IDeviceRepository,
  INonceCache,
  INotificationRepository,
  HttpRequest,
  StoredNotificationRecord,
} from '../types.js';
import {
  buildCanonicalString,
  computeHmacSignature,
} from '../../../protocol/signer.js';
import type { CapturedNotificationPayload } from '../../../protocol/types.js';

describe('NotificationWebhookHandler (Ticket 02)', () => {
  const mockSecret = 'super-secret-key-sentinel-99';
  const mockDeviceId = 'centinela-device-cali-001';
  const fixedNow = 1700000000000;
  const validNonce = 'nonce-uuid-777-abc';

  let mockDeviceRepo: IDeviceRepository;
  let mockNonceCache: INonceCache;
  let mockNotificationRepo: INotificationRepository;
  let handler: NotificationWebhookHandler;

  const validPayload: CapturedNotificationPayload = {
    device_id: mockDeviceId,
    wallet_package: 'com.nequi.MobileApp',
    raw_title: 'Nequi',
    raw_text: 'Te transfirieron $75.000 de Carlos Ruiz (Saldo: $200.000)',
    captured_at: fixedNow - 3000, // 3 segundos atrás
    dispatched_at: fixedNow - 1000,
    amount: 75000,
    sender_name: 'Carlos Ruiz',
  };

  function createSignedRequest(
    payload: CapturedNotificationPayload,
    secret: string = mockSecret,
    timestamp: number = fixedNow - 1000,
    nonce: string = validNonce,
    path: string = '/api/v1/webhooks/notifications',
  ): HttpRequest {
    const canonical = buildCanonicalString({
      method: 'POST',
      path,
      timestamp,
      nonce,
      body: payload,
    });

    const signature = computeHmacSignature(secret, canonical);

    return {
      method: 'POST',
      path,
      headers: {
        'x-device-id': payload.device_id,
        'x-timestamp': timestamp.toString(),
        'x-nonce': nonce,
        'x-signature': signature,
      },
      body: payload,
    };
  }

  beforeEach(() => {
    mockDeviceRepo = {
      getDeviceSecret: vi.fn().mockResolvedValue(mockSecret),
    };

    mockNonceCache = {
      acquireNonce: vi.fn().mockResolvedValue(true), // Por defecto, nonce nuevo
    };

    mockNotificationRepo = {
      saveReceivedNotification: vi
        .fn()
        .mockResolvedValue({ id: 'db-record-id-12345' }),
    };

    handler = new NotificationWebhookHandler({
      deviceRepository: mockDeviceRepo,
      nonceCache: mockNonceCache,
      notificationRepository: mockNotificationRepo,
      nowProvider: () => fixedNow,
    });
  });

  describe('1. Seguridad Criptográfica y Validación HMAC', () => {
    it('debe rechazar con HTTP 401 si falta alguna cabecera obligatoria', async () => {
      const req: HttpRequest = {
        headers: {
          'x-device-id': mockDeviceId,
          // Faltan timestamp, nonce y signature
        },
        body: validPayload,
      };

      const res = await handler.handle(req);

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('UNAUTHORIZED');
      expect(mockNonceCache.acquireNonce).not.toHaveBeenCalled();
      expect(mockNotificationRepo.saveReceivedNotification).not.toHaveBeenCalled();
    });

    it('debe rechazar con HTTP 401 si el dispositivo no existe o está deshabilitado', async () => {
      vi.mocked(mockDeviceRepo.getDeviceSecret).mockResolvedValue(null);

      const req = createSignedRequest(validPayload);
      const res = await handler.handle(req);

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('UNAUTHORIZED');
      expect(res.body.message).toContain('Dispositivo no reconocido');
      expect(mockNotificationRepo.saveReceivedNotification).not.toHaveBeenCalled();
    });

    it('debe rechazar con HTTP 401 si la firma HMAC es inválida (clave incorrecta o payload adulterado)', async () => {
      // Firmado con clave ajena
      const req = createSignedRequest(validPayload, 'attacker-unauthorized-secret');

      const res = await handler.handle(req);

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('INVALID_SIGNATURE');
      expect(mockNonceCache.acquireNonce).not.toHaveBeenCalled();
      expect(mockNotificationRepo.saveReceivedNotification).not.toHaveBeenCalled();
    });

    it('debe rechazar con HTTP 401 si el timestamp tiene un desfase mayor a 30 segundos (ADR-0002)', async () => {
      const expiredTimestamp = fixedNow - 35000; // 35 segundos en el pasado
      const req = createSignedRequest(validPayload, mockSecret, expiredTimestamp);

      const res = await handler.handle(req);

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('TIMESTAMP_DRIFT_EXCEEDED');
      expect(mockNonceCache.acquireNonce).not.toHaveBeenCalled();
      expect(mockNotificationRepo.saveReceivedNotification).not.toHaveBeenCalled();
    });
  });

  describe('2. Prevención de Ataques de Repetición (Anti-Replay)', () => {
    it('debe rechazar con HTTP 409 (Conflict) si el nonce ya fue utilizado previamente en la caché', async () => {
      // Simular que el nonce ya existe (acquireNonce retorna false)
      vi.mocked(mockNonceCache.acquireNonce).mockResolvedValue(false);

      const req = createSignedRequest(validPayload);
      const res = await handler.handle(req);

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('REPLAY_ATTACK_DETECTED');
      expect(res.body.message).toContain('Nonce ya utilizado');
      expect(mockNonceCache.acquireNonce).toHaveBeenCalledWith(
        mockDeviceId,
        validNonce,
        60, // TTL 60 segundos según ADR-0002
      );
      expect(mockNotificationRepo.saveReceivedNotification).not.toHaveBeenCalled();
    });
  });

  describe('3. Ingesta Exitosa y Persistencia en Base de Datos (Escenario Ideal)', () => {
    it('debe responder HTTP 202 (Accepted), registrar el nonce con TTL 60s y persistir en BD con estado RECEIVED', async () => {
      const req = createSignedRequest(validPayload);
      const res = await handler.handle(req);

      // Verificación de respuesta HTTP
      expect(res.statusCode).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Notificación aceptada para procesamiento');
      expect(res.body.data).toEqual({ id: 'db-record-id-12345' });

      // Verificación de adquisición de Nonce con TTL de 60s
      expect(mockNonceCache.acquireNonce).toHaveBeenCalledWith(
        mockDeviceId,
        validNonce,
        60,
      );

      // Verificación de persistencia en PostgreSQL / Supabase
      const expectedRecord: StoredNotificationRecord = {
        deviceId: mockDeviceId,
        walletPackage: 'com.nequi.MobileApp',
        rawTitle: 'Nequi',
        rawText: 'Te transfirieron $75.000 de Carlos Ruiz (Saldo: $200.000)',
        capturedAt: validPayload.captured_at,
        dispatchedAt: validPayload.dispatched_at,
        receivedAt: fixedNow,
        latencyMs: 3000, // fixedNow - captured_at
        isStale: false,
        status: 'RECEIVED',
        amount: 75000,
        senderName: 'Carlos Ruiz',
        paymentReference: null,
      };

      expect(mockNotificationRepo.saveReceivedNotification).toHaveBeenCalledWith(
        expectedRecord,
      );
    });
  });

  describe('4. Gestión de Pagos Desfasados (Stale Alerts - ADR-0001)', () => {
    it('debe aceptar la petición con HTTP 202 pero persistir isStale = true si latencyMs > 90 segundos', async () => {
      const stalePayload: CapturedNotificationPayload = {
        ...validPayload,
        captured_at: fixedNow - 120000, // Interceptado hace 2 minutos (120 segundos)
        dispatched_at: fixedNow - 500,
      };

      const req = createSignedRequest(stalePayload);
      const res = await handler.handle(req);

      expect(res.statusCode).toBe(202);
      expect(res.body.success).toBe(true);

      expect(mockNotificationRepo.saveReceivedNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          isStale: true,
          latencyMs: 120000,
          status: 'RECEIVED',
        }),
      );
    });
  });
});

