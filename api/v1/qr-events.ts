import type { IncomingMessage, ServerResponse } from 'node:http';
import { getSupabaseEnvConfig } from '../../src/backend/supabase/client.js';

async function parseJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf-8');
  return rawBody ? JSON.parse(rawBody) : {};
}

/**
 * Serverless Function para métricas no bloqueantes de la página puente QR (/go).
 * Registra page_view y clicks (click_install, click_advisor, click_landing)
 * con soporte para zonas de volanteo (?z=zona1).
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  try {
    const body = await parseJsonBody(req);
    const eventType = String(body.event_type || 'unknown').trim();
    const zone = String(body.zone || 'general').trim();
    const userAgent = String(body.user_agent || req.headers['user-agent'] || '').slice(0, 500);

    const { supabaseUrl, serviceOrFallbackKey } = getSupabaseEnvConfig();

    const response = await fetch(`${supabaseUrl}/rest/v1/qr_hub_events`, {
      method: 'POST',
      headers: {
        'apikey': serviceOrFallbackKey,
        'Authorization': `Bearer ${serviceOrFallbackKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        event_type: eventType,
        zone: zone,
        user_agent: userAgent,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn('[QR Hub Events] Supabase insert warning:', response.status, errText);
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, recorded: { eventType, zone } }));
  } catch (err: any) {
    console.error('[QR Hub Events] Error recording event:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, error: 'INTERNAL_ERROR', message: err?.message }));
  }
}
