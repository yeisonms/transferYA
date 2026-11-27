import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { handleIosShortcutWebhook } from '../ios-shortcut-handler.js';
import { InMemoryPaymentFingerprintRepository } from '../../../domain/idempotency/fingerprint.js';
import type { Merchant } from '../../../domain/routing/types.js';
import type { StoredNotificationRecord } from '../types.js';

function createMockReqRes(
  method: string,
  body: any,
  headers: Record<string, string> = {},
  url = '/api/v1/webhooks/ios-shortcut',
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

  process.nextTick(() => {
    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.emit('data', Buffer.from(payload));
    }
    req.emit('end');
  });

  return { req, res };
}

class MockShortcutRepository {
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

  async getMerchantById(id: string) {
    return this.merchants.get(id) ?? null;
  }

  async getMerchantWithOwner(id: string) {
    return this.merchants.get(id) ?? null;
  }

  async getMerchantByDeviceId(deviceId: string) {
    const dev = this.registeredDevices.get(deviceId);
    if (!dev) return null;
    return this.merchants.get(dev.merchantId) ?? null;
  }

  async findMerchantByBillingPhone(phone: string) {
    for (const m of this.merchants.values()) {
      if (m.billingPhone === phone) return m;
    }
    return null;
  }

  async registerDevice(id: string, merchantId: string, secretHash: string, label: string) {
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
        name: 'Cajero Mostrador',
        phoneNumber: '+573113654315',
        isActive: true,
      },
    ];
  }

  async getMerchantUsage(_merchantId: string) {
    return {
      usedAlerts: 10,
      quotaAlerts: 1500,
      planId: 'emprendedor',
    };
  }

  async recordWhatsAppDispatch(_params: any) {}
}

describe('Webhook de Atajos de iOS para iPhone (src/backend/webhook/ios-shortcut-handler)', () => {
  let repository: MockShortcutRepository;
  let mockWhatsappClient: any;
  const now = 1732140000000;

  const testMerchant: Merchant = {
    id: 'merchant-test-uuid',
    name: 'Restaurante Central iPhone',
    status: 'ACTIVE',
    subscriptionStatus: 'ACTIVE',
    subscriptionEndsAt: now + 30 * 86400000,
    billingPhone: '+573113654315',
    createdAt: now - 86400000,
  };

  beforeEach(() => {
    repository = new MockShortcutRepository();
    repository.merchants.set(testMerchant.id, testMerchant);
    repository.registeredDevices.set('caja_1_iphone', {
      id: 'caja_1_iphone',
      merchantId: testMerchant.id,
      label: 'Caja 1 iPhone',
    });

    mockWhatsappClient = {
      sendPaymentAlert: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'wamid.HBgLTEST1234',
      }),
      sendRenewalConfirmation: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'wamid.HBgLRENEW1234',
      }),
    };
  });

  describe('1. Autenticación y Validación de Seguridad', () => {
    it('debe rechazar con 401 si no se envía ningún token', async () => {
      const { req, res } = createMockReqRes('POST', {
        text: 'Bancolombia: recibiste $50.000',
      });

      await handleIosShortcutWebhook(req, res, { repository, nowProvider: () => now });

      expect(res.statusCode).toBe(401);
      const payload = JSON.parse(res.end.mock.calls[0][0]);
      expect(payload.error).toBe('UNAUTHORIZED');
      expect(payload.message).toContain('Falta el token de vinculación');
    });

    it('debe rechazar con 401 si el token no corresponde a ningún comercio registrado', async () => {
      const { req, res } = createMockReqRes(
        'POST',
        { text: 'Bancolombia: recibiste $50.000' },
        { 'x-transferya-token': 'token-invalido-123' },
      );

      await handleIosShortcutWebhook(req, res, { repository, nowProvider: () => now });

      expect(res.statusCode).toBe(401);
      const payload = JSON.parse(res.end.mock.calls[0][0]);
      expect(payload.error).toBe('UNAUTHORIZED');
      expect(payload.message).toContain('Comercio no reconocido');
    });

    it('debe rechazar con 400 si el texto del SMS está vacío', async () => {
      const { req, res } = createMockReqRes(
        'POST',
        { text: '   ' },
        { 'x-transferya-token': testMerchant.id },
      );

      await handleIosShortcutWebhook(req, res, { repository, nowProvider: () => now });

      expect(res.statusCode).toBe(400);
      const payload = JSON.parse(res.end.mock.calls[0][0]);
      expect(payload.error).toBe('BAD_REQUEST');
      expect(payload.message).toContain('no puede estar vacío');
    });

    it('debe responder 204 ante peticiones OPTIONS pre-flight', async () => {
      const { req, res } = createMockReqRes('OPTIONS', null);

      await handleIosShortcutWebhook(req, res, { repository, nowProvider: () => now });

      expect(res.statusCode).toBe(204);
    });
  });

  describe('2. Ingesta y Procesamiento de SMS Bancolombia / Nequi', () => {
    it('debe procesar exitosamente SMS de transferencia Bancolombia con token en header x-transferya-token', async () => {
      const smsText =
        'Bancolombia: JEFFERSON, recibiste una transferencia de YEISON STIVEN MURCIA por $35.000 en tu cuenta *5871 conectada a la llave @jefferson el 20/11/26 a las 10:39.';

      const { req, res } = createMockReqRes(
        'POST',
        {
          text: smsText,
          sender: '85566',
        },
        { 'x-transferya-token': 'caja_1_iphone' },
      );

      await handleIosShortcutWebhook(req, res, {
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(res.end.mock.calls[0][0]);
      expect(payload.success).toBe(true);
      expect(payload.status).toBe('PROCESSED');
      expect(payload.payment.amount).toBe(35000);
      expect(payload.payment.senderName).toBe('Yeison Stiven Murcia');
      expect(payload.payment.wallet).toBe('BANCOLOMBIA');

      // WhatsApp debe haber sido notificado
      expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledWith(
        '+573113654315',
        expect.objectContaining({
          amount: 35000,
          senderName: 'Yeison Stiven Murcia',
        }),
        expect.anything(),
      );
    });

    it('debe soportar token en query param ?token=... (común en Atajos de iOS)', async () => {
      const smsText =
        'Bancolombia: recibiste una transferencia por $75.000 de MARIA GOMEZ en tu cuenta *5871.';

      const { req, res } = createMockReqRes(
        'POST',
        { text: smsText },
        {},
        `/api/v1/webhooks/ios-shortcut?token=${testMerchant.id}`,
      );

      await handleIosShortcutWebhook(req, res, {
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(res.end.mock.calls[0][0]);
      expect(payload.success).toBe(true);
      expect(payload.status).toBe('PROCESSED');
      expect(payload.payment.amount).toBe(75000);
      expect(payload.payment.senderName).toBe('Maria Gomez');
    });

    it('debe tolerar si el comerciante puso la variable en la clave JSON en Atajos ({ "<mensaje>": "" })', async () => {
      const smsText =
        'Bancolombia: recibiste una transferencia por $50.000 de PEDRO PEREZ en tu cuenta *5871.';

      // Simula el error común en Atajos de iOS donde el texto del mensaje se asigna a la clave
      const { req, res } = createMockReqRes(
        'POST',
        { [smsText]: '' },
        {},
        `/api/v1/webhooks/ios-shortcut?token=${testMerchant.id}`,
      );

      await handleIosShortcutWebhook(req, res, {
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(res.end.mock.calls[0][0]);
      expect(payload.success).toBe(true);
      expect(payload.status).toBe('PROCESSED');
      expect(payload.payment.amount).toBe(50000);
      expect(payload.payment.senderName).toBe('Pedro Perez');
    });

    it('debe tolerar si iOS envía text como objeto estructurado ({ text: { content: "..." } })', async () => {
      const smsText =
        'Bancolombia: recibiste una transferencia por $90.000 de ANA SILVA en tu cuenta *5871.';

      const { req, res } = createMockReqRes(
        'POST',
        { text: { content: smsText, sender: '85566' } },
        {},
        `/api/v1/webhooks/ios-shortcut?token=${testMerchant.id}`,
      );

      await handleIosShortcutWebhook(req, res, {
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(res.end.mock.calls[0][0]);
      expect(payload.success).toBe(true);
      expect(payload.status).toBe('PROCESSED');
      expect(payload.payment.amount).toBe(90000);
      expect(payload.payment.senderName).toBe('Ana Silva');
    });

    it('debe soportar token en Authorization Bearer', async () => {
      const smsText =
        '¡Plata recibida! Carlos Ruiz te envió $20.000 a tu Nequi.';

      const { req, res } = createMockReqRes(
        'POST',
        { text: smsText, sender: 'Nequi' },
        { authorization: `Bearer ${testMerchant.id}` },
      );

      await handleIosShortcutWebhook(req, res, {
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(res.end.mock.calls[0][0]);
      expect(payload.success).toBe(true);
      expect(payload.status).toBe('PROCESSED');
      expect(payload.payment.amount).toBe(20000);
      expect(payload.payment.wallet).toBe('NEQUI');
    });

    it('debe ignorar mensajes que no sean pagos monetarios sin disparar WhatsApp', async () => {
      const smsText =
        'Bancolombia: Tu clave dinamica es 849201. Valida por 5 minutos.';

      const { req, res } = createMockReqRes(
        'POST',
        { text: smsText, sender: '85566' },
        { 'x-transferya-token': 'caja_1_iphone' },
      );

      await handleIosShortcutWebhook(req, res, {
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(res.end.mock.calls[0][0]);
      expect(payload.success).toBe(true);
      expect(payload.status).toBe('IGNORED_NON_PAYMENT');
      expect(mockWhatsappClient.sendPaymentAlert).not.toHaveBeenCalled();
    });

    it('debe deduplicar si el mismo SMS llega dos veces desde el iPhone', async () => {
      const smsText =
        'Bancolombia: recibiste una transferencia por $40.000 de PEDRO PEREZ en tu cuenta *5871.';

      // Primer envío
      const first = createMockReqRes(
        'POST',
        { text: smsText, sender: '85566' },
        { 'x-transferya-token': 'caja_1_iphone' },
      );
      await handleIosShortcutWebhook(first.req, first.res, {
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledTimes(1);

      // Segundo envío (duplicado)
      const second = createMockReqRes(
        'POST',
        { text: smsText, sender: '85566' },
        { 'x-transferya-token': 'caja_1_iphone' },
      );
      await handleIosShortcutWebhook(second.req, second.res, {
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now + 1000,
      });

      const payload2 = JSON.parse(second.res.end.mock.calls[0][0]);
      expect(payload2.status).toBe('DUPLICATE_PAYMENT');
      // No debe volver a disparar WhatsApp
      expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledTimes(1);
    });

    it('debe procesar SMS de Nequi Negocios o DaviPlata cuando Atajos solo envía { text } sin campo sender', async () => {
      const smsDaviplata = 'Recibiste una transferencia de $50.000 de MARIA GOMEZ';
      const { req, res } = createMockReqRes(
        'POST',
        { text: smsDaviplata },
        {},
        `/api/v1/webhooks/ios-shortcut?token=${testMerchant.id}`,
      );

      await handleIosShortcutWebhook(req, res, {
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(res.end.mock.calls[0][0]);
      expect(payload.success).toBe(true);
      expect(payload.status).toBe('PROCESSED');
      expect(payload.payment.amount).toBe(50000);
      expect(payload.payment.wallet).toBe('DAVIPLATA');
    });

    it('debe responder CONNECTION_OK ante PING_PRUEBA_CONEXION_TRANSFERYA sin disparar WhatsApp', async () => {
      const { req, res } = createMockReqRes(
        'POST',
        { text: 'PING_PRUEBA_CONEXION_TRANSFERYA' },
        {},
        `/api/v1/webhooks/ios-shortcut?token=${testMerchant.id}`,
      );

      await handleIosShortcutWebhook(req, res, {
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(res.end.mock.calls[0][0]);
      expect(payload.success).toBe(true);
      expect(payload.status).toBe('CONNECTION_OK');
      expect(mockWhatsappClient.sendPaymentAlert).not.toHaveBeenCalled();
    });
  });
});
