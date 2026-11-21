import type { IncomingMessage, ServerResponse } from 'node:http';
import { TrialNurtureService } from '../../../src/backend/billing/trial-nurture.js';
import { WhatsAppCloudApiClient } from '../../../src/whatsapp/client.js';
import { getSupabaseRepository } from '../../../src/backend/supabase/client.js';

/**
 * Tarea Cron programada para la evaluación y despacho diario de recordatorios
 * preventivos a comercios en prueba gratuita (Trial Day 5 y Day 7).
 *
 * Configurado en vercel.json para ejecutarse automáticamente cada mañana a las 9:00 AM COL.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  // Protección de seguridad opcional mediante CRON_SECRET de Vercel
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '', `https://${host}`);
    const querySecret = url.searchParams.get('secret');

    if (bearerToken !== expectedSecret && querySecret !== expectedSecret) {
      res.statusCode = 401;
      res.end(JSON.stringify({ success: false, error: 'UNAUTHORIZED' }));
      return;
    }
  }

  try {
    const repository = getSupabaseRepository();
    const whatsappClient = new WhatsAppCloudApiClient({
      accessToken:
        process.env.META_WHATSAPP_TOKEN ||
        'EAAalAQFm5uEBTF5PTndwu9EPvlVg4SAb6pFzXECWCCUKmSnafqr6UiA0KHZCfq9R5WjYIr0z3b7ZCUHu5EPeaja9xj87NZBjQsRdDm9tDBxqxkbx8t4nOauzAJdVsaMPIq9U4CKfxA9HGHQjCtOTMvCyoLNkX6FZCEVZAc6otELlUyGEczzZAqyoj0WYLspwZDZD',
      phoneNumberId: process.env.META_PHONE_NUMBER_ID || '1541112255749953',
    });

    const nurtureService = new TrialNurtureService({
      repository,
      whatsappClient,
    });

    const result = await nurtureService.evaluateAllTrialMerchants();

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        message: 'Recordatorios de prueba evaluados exitosamente',
        ...result,
      }),
    );
  } catch (error: any) {
    console.error('Error ejecutando cron de recordatorios de trial:', error);
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
