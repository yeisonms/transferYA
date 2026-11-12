import type { IncomingMessage, ServerResponse } from 'node:http';
import { NotificationWebhookHandler } from '../../../src/backend/webhook/handler.js';
import { PaymentProcessingPipeline } from '../../../src/backend/pipeline/orchestrator.js';
import { MerchantRoutingService } from '../../../src/domain/routing/service.js';
import { getSupabaseRepository } from '../../../src/backend/supabase/client.js';
import { WhatsAppCloudApiClient } from '../../../src/whatsapp/client.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
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
    const rawBody = Buffer.concat(chunks).toString('utf-8');
    const body = rawBody ? JSON.parse(rawBody) : {};

    const repository = getSupabaseRepository();
    const webhookHandler = new NotificationWebhookHandler({
      deviceRepository: repository,
      nonceCache: repository,
      notificationRepository: repository,
    });

    const result = await webhookHandler.handle({
      headers: req.headers as Record<string, string | undefined>,
      body,
      method: req.method,
      path: '/api/v1/webhooks/notifications',
    });

    // Si la notificación fue aceptada (202), procesar el pipeline de pagos y despacho a WhatsApp
    if (result.statusCode === 202) {
      const notificationId = (result.body.data as any)?.id;
      if (notificationId) {
        try {
          const routingService = new MerchantRoutingService({ repository });
          const whatsappClient = new WhatsAppCloudApiClient({
            accessToken:
              process.env.META_WHATSAPP_TOKEN ||
              'EAAaBHwM4MzYBSZBnq7g2sSzZAWTaoNbsLeSiB2yjZB8K7NyjJmUTCQd8L1TetbsPIbmiFWsf464BphHe88JvFwZBi2UGt1GspRa2pnr2G9Fyliar7yNMSjW14YT1HlAfdPi0L6R09ZAA9268t7zOdTqMXke7yEVvZAKZAZBv4e2pv1VhY6MOdgipv7IUYYkp4bfQv2quWBS7p3SeB0T9RT3Gw5s7znKAZABGqzzgzBahZBxAfLTUzunI3q9Y8esI4qDKUiSNykTV9MXZAQ2t69v7tL8PfCtzL5gtfoSZBAZDZD',
            phoneNumberId:
              process.env.META_PHONE_NUMBER_ID || '1404825876052179',
          });

          const pipeline = new PaymentProcessingPipeline({
            notificationRepository: repository,
            fingerprintRepository: repository,
            routingService,
            whatsappClient,
          });

          const pipelineResult = await pipeline.processCapturedNotification(notificationId);
          console.log('Resultado del Pipeline:', JSON.stringify(pipelineResult));
        } catch (pipelineErr) {
          console.error('Error en pipeline:', pipelineErr);
        }
      }
    }

    // Responder al cliente Centinela (HTTP 202)
    res.statusCode = result.statusCode;
    res.end(JSON.stringify(result.body));
  } catch (error: any) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        success: false,
        error: 'INTERNAL_SERVER_ERROR',
        message: error.message,
      }),
    );
  }
}
