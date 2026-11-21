import type { IncomingMessage, ServerResponse } from 'node:http';

export interface MetaStatusUpdate {
  wamid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: number;
  recipientId?: string;
  errorCode?: number;
  errorMessage?: string;
}

export interface MetaWebhookOptions {
  onStatusUpdate?: (update: MetaStatusUpdate) => Promise<void> | void;
}

/**
 * Webhook oficial para Meta WhatsApp Cloud API (Graph API v21+ / Fase 5).
 *
 * Cumple con dos funciones:
 * 1. GET: Handshake de verificación de Meta (`hub.mode`, `hub.verify_token`, `hub.challenge`).
 * 2. POST: Recepción y actualización de estados de entrega (`sent`, `delivered`, `read`, `failed`).
 */
export async function handleMetaWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  options?: MetaWebhookOptions,
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
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });

    req.on('end', async () => {
      if (rawBody && options?.onStatusUpdate) {
        try {
          const payload = JSON.parse(rawBody);
          const entries = payload?.entry || [];
          for (const entry of entries) {
            const changes = entry?.changes || [];
            for (const change of changes) {
              const statuses = change?.value?.statuses || [];
              for (const st of statuses) {
                if (st?.id && st?.status) {
                  const update: MetaStatusUpdate = {
                    wamid: st.id,
                    status: st.status,
                    timestamp: Number(st.timestamp) || Math.floor(Date.now() / 1000),
                    recipientId: st.recipient_id,
                    errorCode: st.errors?.[0]?.code,
                    errorMessage: st.errors?.[0]?.title || st.errors?.[0]?.message,
                  };
                  try {
                    await options.onStatusUpdate(update);
                  } catch (updateErr) {
                    console.warn('Error en callback onStatusUpdate:', updateErr);
                  }
                }
              }
            }
          }
        } catch {
          // Ignorar payloads malformados en background
        }
      }
    });

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
