import type { IncomingMessage, ServerResponse } from 'node:http';
import { NotificationWebhookHandler } from '../../../src/backend/webhook/handler.js';
import { PaymentProcessingPipeline } from '../../../src/backend/pipeline/orchestrator.js';
import { MerchantRoutingService } from '../../../src/domain/routing/service.js';
import { BillingReconciliationService } from '../../../src/backend/billing/reconciliation.js';
import { getSupabaseRepository } from '../../../src/backend/supabase/client.js';
import { WhatsAppCloudApiClient } from '../../../src/whatsapp/client.js';
import { WebPushService } from '../../../src/backend/push/service.js';

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
              'EAAalAQFm5uEBTF5PTndwu9EPvlVg4SAb6pFzXECWCCUKmSnafqr6UiA0KHZCfq9R5WjYIr0z3b7ZCUHu5EPeaja9xj87NZBjQsRdDm9tDBxqxkbx8t4nOauzAJdVsaMPIq9U4CKfxA9HGHQjCtOTMvCyoLNkX6FZCEVZAc6otELlUyGEczzZAqyoj0WYLspwZDZD',
            phoneNumberId:
              process.env.META_PHONE_NUMBER_ID || '1541112255749953',
          });

          const billingReconciliationService = new BillingReconciliationService({
            config: {
              billingSentinelDeviceId:
                process.env.BILLING_SENTINEL_DEVICE_ID || '',
              minPlanPriceCop: Number(process.env.MIN_PLAN_PRICE_COP || 7900),
              defaultPlanDays: 30,
            },
            repository,
            whatsappClient,
          });

          const pipeline = new PaymentProcessingPipeline({
            notificationRepository: repository,
            fingerprintRepository: repository,
            routingService,
            whatsappClient,
            billingReconciliationService,
            webPushService: new WebPushService(repository),
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
