import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WebPushService } from '../service.js';
import type { IPushSubscriptionRepository, WebPushSubscription } from '../types.js';
import webpush from 'web-push';

vi.mock('web-push', () => {
  const mockSetVapidDetails = vi.fn();
  const mockSendNotification = vi.fn();
  return {
    setVapidDetails: mockSetVapidDetails,
    sendNotification: mockSendNotification,
    default: {
      setVapidDetails: mockSetVapidDetails,
      sendNotification: mockSendNotification,
    },
  };
});

describe('WebPushService (Fase 2 - Notificaciones Web Push)', () => {
  let mockRepository: IPushSubscriptionRepository;
  let service: WebPushService;

  const sampleSub: WebPushSubscription = {
    merchantId: 'merchant-uuid-123',
    endpoint: 'https://fcm.googleapis.com/fcm/send/fake-sub-token',
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK18WK2PtIg1z_Y37',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository = {
      saveSubscription: vi.fn().mockResolvedValue(undefined),
      deleteSubscription: vi.fn().mockResolvedValue(undefined),
      getSubscriptionsByMerchantId: vi.fn().mockResolvedValue([sampleSub]),
    };
    service = new WebPushService(mockRepository);
  });

  it('debe exponer la llave pública VAPID correctamente', () => {
    const key = service.getPublicKey();
    expect(key).toBeDefined();
    expect(key.length).toBeGreaterThan(20);
  });

  it('debe enviar la notificación formateada con éxito a una suscripción', async () => {
    vi.mocked(webpush.sendNotification).mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });

    const result = await service.sendToSubscription(sampleSub, {
      title: '⚡ ¡Pago Verificado en Caja 1!',
      body: 'Nequi · Recibiste $50.000 COP de Pedro Gómez',
    });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(201);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);

    const callArgs = vi.mocked(webpush.sendNotification).mock.calls[0];
    expect(callArgs[0].endpoint).toBe(sampleSub.endpoint);
    const parsedPayload = JSON.parse(callArgs[1] as string);
    expect(parsedPayload.title).toBe('⚡ ¡Pago Verificado en Caja 1!');
    expect(parsedPayload.body).toContain('$50.000 COP');
    expect(parsedPayload.icon).toBe('/icons/icon-192.png');
    expect(parsedPayload.badge).toBe('/icons/favicon-96x96.png');
    expect(callArgs[2]).toEqual({ TTL: 3600, urgency: 'high' });
  });

  it('debe eliminar automáticamente suscripciones caducadas cuando el push service retorna 410 Gone o 404', async () => {
    const expiredError = new Error('Subscription expired');
    (expiredError as any).statusCode = 410;
    vi.mocked(webpush.sendNotification).mockRejectedValue(expiredError);

    const result = await service.sendToSubscription(sampleSub, {
      title: 'Pago',
      body: 'Prueba',
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(410);
    expect(mockRepository.deleteSubscription).toHaveBeenCalledWith(sampleSub.endpoint);
  });

  it('debe hacer broadcast a todas las suscripciones activas del comercio', async () => {
    vi.mocked(webpush.sendNotification).mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });

    const broadcastResult = await service.broadcastToMerchant('merchant-uuid-123', {
      title: '⚡ ¡Pago Recibido!',
      body: '$100.000 COP',
    });

    expect(broadcastResult.total).toBe(1);
    expect(broadcastResult.sent).toBe(1);
    expect(broadcastResult.failed).toBe(0);
  });

  it('debe retornar conteo en 0 si el comercio no tiene dispositivos registrados para push', async () => {
    vi.mocked(mockRepository.getSubscriptionsByMerchantId).mockResolvedValue([]);

    const broadcastResult = await service.broadcastToMerchant('sin-subs', {
      title: 'Pago',
      body: '$10.000',
    });

    expect(broadcastResult.total).toBe(0);
    expect(broadcastResult.sent).toBe(0);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
});
