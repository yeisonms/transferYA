import { describe, expect, it, vi, beforeEach } from 'vitest';
import handler from '../../../../api/v1/push/subscribe.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

vi.mock('../../../../src/backend/supabase/client.js', () => {
  return {
    getSupabaseRepository: vi.fn().mockReturnValue({
      saveSubscription: vi.fn().mockResolvedValue(undefined),
      deleteSubscription: vi.fn().mockResolvedValue(undefined),
      getSubscriptionsByMerchantId: vi.fn().mockResolvedValue([]),
    }),
  };
});

function createMockReqRes(method: string, bodyObj?: any, headers: Record<string, string> = {}) {
  const req = new Readable({
    read() {
      if (bodyObj) {
        this.push(JSON.stringify(bodyObj));
      }
      this.push(null);
    },
  }) as unknown as IncomingMessage;

  req.method = method;
  req.headers = headers;

  let statusCode = 200;
  let responseData = '';
  const resHeaders: Record<string, string> = {};

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader: vi.fn((k: string, v: string) => {
      resHeaders[k] = v;
    }),
    end: vi.fn((data: string) => {
      responseData = data;
    }),
    _getData: () => (responseData ? JSON.parse(responseData) : null),
  } as unknown as ServerResponse & { _getData: () => any };

  return { req, res };
}

describe('API: /api/v1/push/subscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET debe retornar la llave pública VAPID', async () => {
    const { req, res } = createMockReqRes('GET');
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const data = (res as any)._getData();
    expect(data.success).toBe(true);
    expect(data.publicKey).toBeDefined();
    expect(typeof data.publicKey).toBe('string');
  });

  it('GET con merchantId y endpoint debe verificar si el endpoint sigue registrado en BD', async () => {
    const { getSupabaseRepository } = await import('../../../../src/backend/supabase/client.js');
    vi.mocked(getSupabaseRepository().getSubscriptionsByMerchantId).mockResolvedValueOnce([
      {
        merchantId: 'm-check-1',
        endpoint: 'https://fcm.googleapis.com/fcm/send/live-token',
        keys: { p256dh: 'k1', auth: 'k2' },
      },
    ]);

    const { req, res } = createMockReqRes('GET');
    req.url = '/api/v1/push/subscribe?merchantId=m-check-1&endpoint=' + encodeURIComponent('https://fcm.googleapis.com/fcm/send/dead-token');
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const data = (res as any)._getData();
    expect(data.deviceCount).toBe(1);
    expect(data.isEndpointRegistered).toBe(false);
  });

  it('POST debe rechazar payload incompleto con 400', async () => {
    const { req, res } = createMockReqRes('POST', { merchantId: 'm1' }); // falta subscription
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    const data = (res as any)._getData();
    expect(data.success).toBe(false);
    expect(data.error).toBe('INVALID_SUBSCRIPTION_PAYLOAD');
  });

  it('POST debe registrar la suscripción exitosamente con 201', async () => {
    const { req, res } = createMockReqRes('POST', {
      merchantId: 'merchant-test-123',
      subscription: {
        endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/fake',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK18WK2PtIg1z_Y37',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    const data = (res as any)._getData();
    expect(data.success).toBe(true);
  });

  it('DELETE debe eliminar suscripción existente con 200', async () => {
    const { req, res } = createMockReqRes('DELETE', {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/fake',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const data = (res as any)._getData();
    expect(data.success).toBe(true);
  });
});
