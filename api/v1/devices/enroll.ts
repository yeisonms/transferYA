import type { IncomingMessage, ServerResponse } from 'node:http';
import { DeviceEnrollmentHandler } from '../../../src/backend/enrollment/handler.js';
import { TrialNurtureService } from '../../../src/backend/billing/trial-nurture.js';
import { WhatsAppCloudApiClient } from '../../../src/whatsapp/client.js';
import { getSupabaseRepository } from '../../../src/backend/supabase/client.js';

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
    const enrollmentHandler = new DeviceEnrollmentHandler({
      enrollmentRepository: repository,
    });

    const result = await enrollmentHandler.enrollDevice({
      headers: req.headers as Record<string, string | undefined>,
      body,
      method: req.method,
      path: '/api/v1/devices/enroll',
    });

    // Enviar bienvenida de trial por WhatsApp de forma asíncrona sin bloquear la respuesta de enrolamiento
    if (result.statusCode === 200 && (result.body as any)?.data?.merchantId) {
      const merchantId = (result.body as any).data.merchantId;
      const whatsappClient = new WhatsAppCloudApiClient({
        accessToken:
          process.env.META_WHATSAPP_TOKEN ||
          'EAAalAQFm5uEBTF5PTndwu9EPvlVg4SAb6pFzXECWCCUKmSnafqr6UiA0KHZCfq9R5WjYIr0z3b7ZCUHu5EPeaja9xj87NZBjQsRdDm9tDBxqxkbx8t4nOauzAJdVsaMPIq9U4CKfxA9HGHQjCtOTMvCyoLNkX6FZCEVZAc6otELlUyGEczzZAqyoj0WYLspwZDZD',
        phoneNumberId: process.env.META_PHONE_NUMBER_ID || '1541112255749953',
      });
      const nurture = new TrialNurtureService({
        repository,
        whatsappClient,
      });
      nurture.sendWelcomeIfEligible(merchantId).catch((nurtureErr) => {
        console.warn('Advertencia despachando bienvenida de trial WhatsApp:', nurtureErr);
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

