import type { IncomingMessage, ServerResponse } from 'node:http';
import { getSupabaseRepository } from '../../../src/backend/supabase/client.js';
import { WebPushService } from '../../../src/backend/push/service.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  const repository = getSupabaseRepository();
  const pushService = new WebPushService(repository);

  // GET: Obtener Llave Pública VAPID y opcionalmente verificar estado real en BD
  if (req.method === 'GET') {
    const reqUrl = new URL(req.url || '/api/v1/push/subscribe', 'http://localhost');
    const merchantId = reqUrl.searchParams.get('merchantId');
    const endpoint = reqUrl.searchParams.get('endpoint');

    let deviceCount: number | undefined;
    let isEndpointRegistered: boolean | undefined;

    if (merchantId) {
      try {
        const subs = await repository.getSubscriptionsByMerchantId(merchantId);
        deviceCount = subs.length;
        if (endpoint) {
          isEndpointRegistered = subs.some((s) => s.endpoint === endpoint);
        }
      } catch {
        deviceCount = 0;
        if (endpoint) isEndpointRegistered = false;
      }
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        publicKey: pushService.getPublicKey(),
        ...(deviceCount !== undefined ? { deviceCount } : {}),
        ...(isEndpointRegistered !== undefined ? { isEndpointRegistered } : {}),
      }),
    );
    return;
  }

  // DELETE: Cancelar suscripción
  if (req.method === 'DELETE') {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? JSON.parse(raw) : {};

      if (!body.endpoint) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: 'MISSING_ENDPOINT' }));
        return;
      }

      await repository.deleteSubscription(body.endpoint);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true }));
      return;
    } catch (err: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: err.message }));
      return;
    }
  }

  // POST: Registrar nueva suscripción
  if (req.method === 'POST') {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? JSON.parse(raw) : {};

      const { merchantId, subscription, userAgent } = body;

      if (!merchantId || !subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            success: false,
            error: 'INVALID_SUBSCRIPTION_PAYLOAD',
            message: 'merchantId, subscription.endpoint y subscription.keys (p256dh, auth) son requeridos.',
          }),
        );
        return;
      }

      await repository.saveSubscription({
        merchantId,
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        userAgent: userAgent || (req.headers['user-agent'] as string) || undefined,
      });

      res.statusCode = 201;
      res.end(
        JSON.stringify({
          success: true,
          message: 'Suscripción Web Push registrada con éxito',
        }),
      );
      return;
    } catch (err: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: err.message }));
      return;
    }
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }));
}
