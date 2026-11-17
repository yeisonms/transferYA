import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Webhook oficial para Meta WhatsApp Cloud API (Graph API v21+).
 *
 * Cumple con dos funciones:
 * 1. GET: Handshake de verificación de Meta (`hub.mode`, `hub.verify_token`, `hub.challenge`).
 * 2. POST: Recepción de estados de entrega (`sent`, `delivered`, `read`) y mensajes entrantes.
 */
export async function handleMetaWebhook(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? 'GET';

  if (method === 'GET') {
    try {
      const host = req.headers.host ?? 'localhost';
      const fullUrl = new URL(req.url ?? '', `https://${host}`);
      const mode = fullUrl.searchParams.get('hub.mode');
      const token = fullUrl.searchParams.get('hub.verify_token');
      const challenge = fullUrl.searchParams.get('hub.challenge');

      const expectedToken =
        process.env.META_WEBHOOK_VERIFY_TOKEN || 'transferya_meta_webhook_2026';

      if (mode === 'subscribe' && token === expectedToken) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end(challenge);
        return;
      }

      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: false,
          error: 'FORBIDDEN',
          message: 'Token de verificación de webhook no coincide',
        }),
      );
      return;
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: false,
          error: 'INTERNAL_SERVER_ERROR',
          message: err?.message ?? 'Error validando handshake de Meta',
        }),
      );
      return;
    }
  }

  if (method === 'POST') {
    // Confirmar recepción inmediata a Meta (HTTP 200 obligatorio en < 3 seg)
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'EVENT_RECEIVED' }));
    return;
  }

  res.statusCode = 405;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Método no soportado',
    }),
  );
}
