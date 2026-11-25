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

    // Permite esperar unos segundos en servidor para que el usuario bloquee la pantalla del celular antes de disparar FCM
    const requestedDelay = Number(body.delayMs || 0);
    const safeDelayMs = Number.isFinite(requestedDelay)
      ? Math.max(0, Math.min(6000, Math.round(requestedDelay)))
      : 0;

    if (safeDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, safeDelayMs));
    }

    const repository = getSupabaseRepository();
    const pushService = new WebPushService(repository);

    const result = await pushService.broadcastToMerchant(merchantId, {
      title: '⚡ ¡Prueba en Pantalla Bloqueada Exitosa! · TransferYA',
      body: 'Las alertas Web Push en segundo plano están conectadas con Google FCM y listas para tus cobros.',
      tag: `ty-lockscreen-test-${Date.now()}`,
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
