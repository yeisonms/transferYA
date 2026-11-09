import { describe, it, expect, vi } from 'vitest';
import { NotificationWebhookHandler } from '../backend/webhook/handler.js';
import type {
  IDeviceRepository,
  INonceCache,
  INotificationRepository,
  HttpRequest,
  StoredNotificationRecord,
} from '../backend/webhook/types.js';
import { buildCanonicalString, computeHmacSignature } from '../protocol/signer.js';
import type { CapturedNotificationPayload } from '../protocol/types.js';

describe('Prueba E2E: Corte de Red, Recuperación Offline y Detección de Stale Alert (ADR-0001 / ADR-0002)', () => {
  const secret = 'enterprise-sentinel-shared-secret-88';
  const deviceId = 'centinela-tienda-norte-01';

  it('debe completar el flujo E2E: captura en offline, espera 120s, despacho tras reconexion y clasificacion como STALE_ALERT', async () => {
    // T0: Momento exacto en que la app bancaria emite la notificación en el móvil
    const t0CaptureTime = 1700000000000;
    // T1: 120 segundos después (2 minutos de corte de red en el local)
    const t1ReconnectionTime = t0CaptureTime + 120000;

    let savedRecord: StoredNotificationRecord | null = null;

    const mockNotificationRepo: INotificationRepository = {
      saveReceivedNotification: vi.fn().mockImplementation(async (record) => {
        savedRecord = record;
        return { id: 'db-e2e-rec-999' };
      }),
    };

    const mockDeviceRepo: IDeviceRepository = {
      getDeviceSecret: vi.fn().mockResolvedValue(secret),
    };

    const mockNonceCache: INonceCache = {
      acquireNonce: vi.fn().mockResolvedValue(true),
    };

    // Backend Webhook inicializado con el reloj del servidor en T1 (reconexión)
    const backendHandler = new NotificationWebhookHandler({
      deviceRepository: mockDeviceRepo,
      notificationRepository: mockNotificationRepo,
      nonceCache: mockNonceCache,
      nowProvider: () => t1ReconnectionTime,
    });

    // 1. Payload generado por el Dispositivo Centinela tras reconexión (dispatched_at = t1)
    const clientPayload: CapturedNotificationPayload = {
      device_id: deviceId,
      wallet_package: 'com.nequi.MobileApp',
      raw_title: 'Nequi',
      raw_text: 'Te transfirieron $80.000 de Pedro Picapiedra (Saldo: $250.000)',
      captured_at: t0CaptureTime,
      dispatched_at: t1ReconnectionTime,
      amount: 80000,
      sender_name: 'Pedro Picapiedra',
    };

    // 2. Firma generada en el móvil con el secreto del KeyStore en T1
    const nonce = 'e2e-unique-nonce-120s-delayed';
    const canonical = buildCanonicalString({
      method: 'POST',
      path: '/api/v1/webhooks/notifications',
      timestamp: t1ReconnectionTime,
      nonce,
      body: clientPayload,
    });

    const signature = computeHmacSignature(secret, canonical);

    const httpRequest: HttpRequest = {
      method: 'POST',
      path: '/api/v1/webhooks/notifications',
      headers: {
        'x-device-id': deviceId,
        'x-timestamp': t1ReconnectionTime.toString(),
        'x-nonce': nonce,
        'x-signature': signature,
      },
      body: clientPayload,
    };

    // 3. Envío al Webhook del backend
    const response = await backendHandler.handle(httpRequest);

    // 4. Aseveraciones E2E
    expect(response.statusCode).toBe(202);
    expect(response.body.success).toBe(true);

    // Verificación crítica de auditoría y mitigación de fraude en caja:
    expect(savedRecord).not.toBeNull();
    expect(savedRecord!.capturedAt).toBe(t0CaptureTime);
    expect(savedRecord!.dispatchedAt).toBe(t1ReconnectionTime);
    expect(savedRecord!.latencyMs).toBe(120000); // 120.000 ms = 2 minutos
    expect(savedRecord!.isStale).toBe(true); // Flag activado según ADR-0001 (>90s)
    expect(savedRecord!.status).toBe('RECEIVED');
  });
});

