import { describe, expect, it } from 'vitest';
import { handleMetaWebhook } from '../webhook-handler.js';
import { EventEmitter } from 'node:events';

function createMockReqRes(method: string, url: string) {
  const req = new EventEmitter() as any;
  req.method = method;
  req.url = url;
  req.headers = { host: 'www.transferya.app' };

  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = '';

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
    end(data?: string) {
      if (data) body += data;
    },
    getBody() {
      return body;
    },
  } as any;

  return { req, res };
}

describe('Webhook de Meta WhatsApp Cloud API (src/whatsapp/webhook-handler)', () => {
  it('debe responder con el hub.challenge cuando el verify_token es correcto (GET handshake)', async () => {
    const { req, res } = createMockReqRes(
      'GET',
      '/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=transferya_meta_webhook_2026&hub.challenge=1158201444',
    );

    await handleMetaWebhook(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.getBody()).toBe('1158201444');
  });

  it('debe responder 403 Forbidden cuando el verify_token es incorrecto', async () => {
    const { req, res } = createMockReqRes(
      'GET',
      '/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token_invalido&hub.challenge=1158201444',
    );

    await handleMetaWebhook(req, res);

    expect(res.statusCode).toBe(403);
    const parsed = JSON.parse(res.getBody());
    expect(parsed.error).toBe('FORBIDDEN');
  });

  it('debe responder 200 EVENT_RECEIVED a los eventos entrantes POST de Meta', async () => {
    const { req, res } = createMockReqRes('POST', '/api/v1/webhooks/whatsapp');

    await handleMetaWebhook(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.getBody());
    expect(parsed.status).toBe('EVENT_RECEIVED');
  });

  it('debe procesar eventos de actualización de entrega (delivered, read) vía onStatusUpdate', async () => {
    const { req, res } = createMockReqRes('POST', '/api/v1/webhooks/whatsapp');
    const statusUpdates: any[] = [];

    const promise = handleMetaWebhook(req, res, {
      onStatusUpdate: async (st) => {
        statusUpdates.push(st);
      },
    });

    const metaPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456789',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                statuses: [
                  {
                    id: 'wamid.HBgLMjAyNjExMjAxM',
                    status: 'delivered',
                    timestamp: '1732140000',
                    recipient_id: '573113654315',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    req.emit('data', Buffer.from(JSON.stringify(metaPayload)));
    req.emit('end');

    await promise;

    expect(res.statusCode).toBe(200);
    expect(statusUpdates).toHaveLength(1);
    expect(statusUpdates[0].wamid).toBe('wamid.HBgLMjAyNjExMjAxM');
    expect(statusUpdates[0].status).toBe('delivered');
    expect(statusUpdates[0].recipientId).toBe('573113654315');
  });

  it('debe rechazar métodos no soportados con 405', async () => {
    const { req, res } = createMockReqRes('PUT', '/api/v1/webhooks/whatsapp');

    await handleMetaWebhook(req, res);

    expect(res.statusCode).toBe(405);
  });
});
