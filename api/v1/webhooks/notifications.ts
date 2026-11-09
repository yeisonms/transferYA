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

    // Si la notificación fue aceptada (202), procesarla en el pipeline
    if (result.statusCode === 202) {
      const routingService = new MerchantRoutingService(repository);
      const whatsappClient = new WhatsAppCloudApiClient({
        accessToken: process.env.META_WHATSAPP_TOKEN || 'test_token',
        phoneNumberId: process.env.META_PHONE_NUMBER_ID || 'test_phone_id',
      });

      const pipeline = new PaymentProcessingPipeline({
        fingerprintRepository: repository,
        routingService,
        whatsAppClient,
        statusUpdater: {
          updateNotificationStatus: async () => {},
        },
      });

      // Procesamiento asíncrono
      pipeline
        .process({
          id: (result.body.data as any)?.id || 'unknown',
          deviceId: (req.headers['x-device-id'] as string) || '',
          walletPackage: body.wallet_package,
          rawTitle: body.raw_title,
          rawText: body.raw_text,
          capturedAt: body.captured_at,
          dispatchedAt: body.dispatched_at,
          receivedAt: Date.now(),
          isStale: false,
        })
        .catch((err) => {
          console.error('Error en pipeline de procesamiento:', err);
        });
    }

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
