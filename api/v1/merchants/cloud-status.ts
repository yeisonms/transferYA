import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createUserScopedRepository,
  getSupabaseEnvConfig,
  getSupabaseRepository,
} from '../../../src/backend/supabase/client.js';
import { handleMerchantCloudStatusRequest } from '../../../src/backend/merchants/cloud-status.js';

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) {
      query[k] = v;
    }

    let body: Record<string, any> = {};
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = {};
        }
      }
    }

    const { supabaseUrl, anonKey } = getSupabaseEnvConfig();
    const result = await handleMerchantCloudStatusRequest(
      {
        authConfig: { supabaseUrl, supabaseKey: anonKey },
        createUserRepo: createUserScopedRepository,
        serviceRepo: getSupabaseRepository(),
      },
      {
        method: req.method,
        headers: req.headers as Record<string, string | string[] | undefined>,
        query,
        body,
      },
    );

    res.statusCode = result.statusCode;
    res.end(JSON.stringify(result.body));
  } catch (error: any) {
    console.error('Error en cloud-status endpoint:', error);
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
