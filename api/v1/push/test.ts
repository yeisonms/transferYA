import type { IncomingMessage, ServerResponse } from 'node:http';
import { getSupabaseRepository } from '../../../src/backend/supabase/client.js';
import { WebPushService } from '../../../src/backend/push/service.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    const body = raw ? JSON.parse(raw) : {};

    const merchantId = body.merchantId;
    if (!merchantId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: 'MISSING_MERCHANT_ID' }));
      return;
    }

    const repository = getSupabaseRepository();
    const pushService = new WebPushService(repository);

    const result = await pushService.broadcastToMerchant(merchantId, {
      title: '🔔 ¡Prueba de Alerta Web Push!',
      body: 'TransferYA: Las notificaciones del sistema en segundo plano están funcionando perfectamente.',
      tag: 'transferya-test-alert',
      url: '/',
    });

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        message: 'Prueba despachada a suscripciones activas',
        result,
      }),
    );
  } catch (err: any) {
    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}
