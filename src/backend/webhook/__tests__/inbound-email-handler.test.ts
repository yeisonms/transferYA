import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import {
  extractMerchantIdentifierFromRecipient,
  getLatestGoogleVerificationCode,
  handleInboundEmail,
} from '../inbound-email-handler.js';
import { InMemoryPaymentFingerprintRepository } from '../../../domain/idempotency/fingerprint.js';
import {
  InMemoryMerchantRoutingRepository,
  MerchantRoutingService,
} from '../../../domain/routing/service.js';
import type { Merchant } from '../../../domain/routing/types.js';
import type { StoredNotificationRecord } from '../types.js';

function createMockReqRes(
  method: string,
  body: any,
  headers: Record<string, string> = {},
  url = '/api/v1/webhooks/inbound-email',
) {
  const req = new EventEmitter() as unknown as IncomingMessage & { body?: any };
  req.method = method;
  req.headers = headers;
  req.url = url;
  req.body = body;

  const resHeaders: Record<string, string> = {};
  const res = {
    statusCode: 200,
    headers: resHeaders,
    setHeader(name: string, value: string) {
      resHeaders[name] = value;
    },
    end: vi.fn(),
  } as unknown as ServerResponse & {
    statusCode: number;
    headers: Record<string, string>;
    end: any;
  };

  // Emitir cuerpo de forma asíncrona
  process.nextTick(() => {
    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.emit('data', Buffer.from(payload));
    }
    req.emit('end');
  });

  return { req, res };
}

class MockSupabaseRepository {
  public savedNotifications = new Map<string, StoredNotificationRecord>();
  public registeredDevices = new Map<string, any>();
  public merchants = new Map<string, Merchant>();
  public fingerprintRepo = new InMemoryPaymentFingerprintRepository();

  async registerFingerprint(record: any) {
    return this.fingerprintRepo.registerFingerprint(record);
  }

  async findByFingerprint(deviceId: string, fingerprint: string) {
    return this.fingerprintRepo.findByFingerprint(deviceId, fingerprint);
  }

  async findByMerchantFingerprint(merchantId: string, fingerprint: string) {
    return this.fingerprintRepo.findByMerchantFingerprint(merchantId, fingerprint);
  }

  async getMerchantWithOwner(id: string) {
    return this.merchants.get(id) ?? null;
  }

  async getMerchantByDeviceId(deviceId: string) {
    const dev = this.registeredDevices.get(deviceId);
    if (!dev) return null;
    return this.merchants.get(dev.merchantId) ?? null;
  }

  async registerDevice(
    id: string,
    merchantId: string,
    secretHash: string,
    label: string,
  ) {
    this.registeredDevices.set(id, { id, merchantId, secretHash, label });
  }

  async saveReceivedNotification(record: StoredNotificationRecord) {
    const id = `notif_${Math.random().toString(36).substring(2, 9)}`;
    const full = { ...record, id };
    this.savedNotifications.set(id, full);
    return { id };
  }

  async getNotificationById(id: string) {
    return this.savedNotifications.get(id) ?? null;
  }

  async updateNotification(id: string, update: any) {
    const current = this.savedNotifications.get(id);
    if (current) {
      this.savedNotifications.set(id, { ...current, ...update });
    }
  }

  async getCashierRecipients(merchantId: string, _deviceId: string) {
    return [
      {
        id: 'cashier_1',
        merchantId,
        name: 'Cajero Principal',
        phoneNumber: '+573001234567',
        isActive: true,
      },
    ];
  }
}

describe('Endpoint Inbound Email Webhook (Ruta Cloud TransferYA)', () => {
  describe('1. Utilidades y Extracción de Destinatario', () => {
    it('debe extraer el slug o merchantId de direcciones con plus-addressing', () => {
      expect(
        extractMerchantIdentifierFromRecipient(
          'pago+la-sinverguenceria@inbound.transferya.app',
        ),
      ).toBe('la-sinverguenceria');
      expect(
        extractMerchantIdentifierFromRecipient(
          'notificaciones+c6a8f123-4567-89ab-cdef@transferya.app',
        ),
      ).toBe('c6a8f123-4567-89ab-cdef');
    });

    it('debe extraer el nombre de usuario si no tiene signo más', () => {
      expect(
        extractMerchantIdentifierFromRecipient(
          'mi-tienda@inbound.transferya.app',
        ),
      ).toBe('mi-tienda');
    });

    it('debe manejar encabezados con nombre tipo "Mi Tienda <correo@dominio>"', () => {
      expect(
        extractMerchantIdentifierFromRecipient(
          'Restaurante Don Pedro <pago+don-pedro@inbound.transferya.app>',
        ),
      ).toBe('don-pedro');
    });
  });

  describe('2. Seguridad y Métodos HTTP', () => {
    it('debe rechazar métodos GET con 405 Method Not Allowed', async () => {
      const { req, res } = createMockReqRes('GET', null);
      await handleInboundEmail(req, res);
      expect(res.statusCode).toBe(405);
    });

    it('debe rechazar si el secret no coincide con 401 Unauthorized', async () => {
      const { req, res } = createMockReqRes(
        'POST',
        { from: 'test@example.com' },
        { 'x-inbound-secret': 'clave_incorrecta' },
      );
      await handleInboundEmail(req, res, { secret: 'clave_super_secreta' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('3. Handshake de Verificación de Reenvío de Google', () => {
    it('debe capturar el código de confirmación de Gmail y guardarlo en el cache consultable', async () => {
      const mockRepo = new MockSupabaseRepository();
      const merchantId = 'merchant_panaderia_1';

      const emailPayload = {
        from: 'forwarding-noreply@google.com',
        to: `pago+${merchantId}@inbound.transferya.app`,
        subject: 'Solicitud de reenvío de Gmail - Confirmación',
        text: 'Código de confirmación: 748392019\nVisita https://mail.google.com/mail/vf-xyz',
      };

      const { req, res } = createMockReqRes('POST', emailPayload);
      await handleInboundEmail(req, res, { repository: mockRepo });

      expect(res.statusCode).toBe(200);
      const resBody = JSON.parse(res.end.mock.calls[0][0]);
      expect(resBody.success).toBe(true);
      expect(resBody.type).toBe('GOOGLE_VERIFICATION');
      expect(resBody.verificationCode).toBe('748392019');

      // Consultar cache en memoria
      const cached = getLatestGoogleVerificationCode(merchantId);
      expect(cached).not.toBeNull();
      expect(cached?.code).toBe('748392019');
    });
  });

  describe('4. Flujo Completo de Recepción de Pago Nequi por Correo', () => {
    it('debe procesar un pago entrante, registrarlo y enviarlo a WhatsApp si no es duplicado', async () => {
      const mockRepo = new MockSupabaseRepository();
      const merchantId = 'merchant_hamburguesas_1';
      mockRepo.merchants.set(merchantId, {
        id: merchantId,
        name: 'Hamburguesas La Sinvergüencería',
        status: 'ACTIVE',
        subscriptionExpiresAt: Date.now() + 86400000 * 30,
        createdAt: Date.now(),
      });

      const mockWhatsappClient = {
        sendPaymentAlert: vi.fn().mockResolvedValue({
          success: true,
          messageId: 'wamid_test_123',
        }),
      };

      const emailPayload = {
        from: 'comprobantes@nequi.com.co',
        to: `pago+${merchantId}@inbound.transferya.app`,
        subject: '¡Hola! Te enviaron plata a tu Nequi',
        text: `
          ¿Cuánto?: $ 45.000
          ¿Quién te la envió?: Carlos Gomez
          Número de referencia: M99887766
        `,
      };

      const { req, res } = createMockReqRes('POST', emailPayload);
      await handleInboundEmail(req, res, {
        repository: mockRepo,
        whatsappClient: mockWhatsappClient,
      });

      expect(res.statusCode).toBe(200);
      const resBody = JSON.parse(res.end.mock.calls[0][0]);
      expect(resBody.success).toBe(true);
      expect(resBody.type).toBe('PAYMENT');
      expect(resBody.pipelineResult.status).toBe('PROCESSED');
      expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledTimes(1);
    });

    it('debe DEDUPLICAR y no enviar WhatsApp si el Centinela ya procesó el pago previamente', async () => {
      const mockRepo = new MockSupabaseRepository();
      const merchantId = 'merchant_hamburguesas_1';
      mockRepo.merchants.set(merchantId, {
        id: merchantId,
        name: 'Hamburguesas La Sinvergüencería',
        status: 'ACTIVE',
        subscriptionExpiresAt: Date.now() + 86400000 * 30,
        createdAt: Date.now(),
      });

      const fingerprintRepo = new InMemoryPaymentFingerprintRepository();
      const mockWhatsappClient = {
        sendPaymentAlert: vi.fn().mockResolvedValue({
          success: true,
          messageId: 'wamid_test_123',
        }),
      };

      // Simular que el Centinela Android ya procesó la transacción hace 10 segundos
      const canonicalRefHash =
        'NEQUI|REF:M99887766'; // Mismo código de Nequi
      const { createHash } = await import('node:crypto');
      const expectedFingerprint = createHash('sha256')
        .update(canonicalRefHash, 'utf-8')
        .digest('hex');

      await fingerprintRepo.registerFingerprint({
        deviceId: 'dev_centinela_local',
        merchantId,
        fingerprint: expectedFingerprint,
        wallet: 'NEQUI',
        amount: 45000,
        senderName: 'Carlos Gomez',
        capturedAt: Date.now() - 10000,
      });

      // Llega el correo de Gmail 10 segundos después
      const emailPayload = {
        from: 'comprobantes@nequi.com.co',
        to: `pago+${merchantId}@inbound.transferya.app`,
        subject: '¡Hola! Te enviaron plata a tu Nequi',
        text: `
          ¿Cuánto?: $ 45.000
          ¿Quién te la envió?: Carlos Gomez
          Número de referencia: M99887766
        `,
      };

      const { req, res } = createMockReqRes('POST', emailPayload);

      await handleInboundEmail(req, res, {
        repository: mockRepo,
        fingerprintRepository: fingerprintRepo,
        whatsappClient: mockWhatsappClient,
      });

      expect(res.statusCode).toBe(200);
      const resBody = JSON.parse(res.end.mock.calls[0][0]);
      expect(resBody.success).toBe(true);
      expect(resBody.pipelineResult.status).toBe('DUPLICATE_PAYMENT');
      // ¡EL CAJERO NO RECIBE WHATSAPP DUPLICADO!
      expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledTimes(0);
    });
  });
});
