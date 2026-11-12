import type { IncomingMessage, ServerResponse } from 'node:http';
import { provisionMerchantForAuthenticatedUser } from '../../../src/backend/merchants/provision.js';
import {
  createUserScopedRepository,
  getSupabaseEnvConfig,
  getSupabaseRepository,
} from '../../../src/backend/supabase/client.js';

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
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

    const { supabaseUrl, anonKey } = getSupabaseEnvConfig();
    const result = await provisionMerchantForAuthenticatedUser(
      {
        authConfig: { supabaseUrl, supabaseKey: anonKey },
        createUserRepo: createUserScopedRepository,
        serviceRepo: getSupabaseRepository(),
      },
      {
        headers: req.headers as Record<string, string | string[] | undefined>,
        storeName: body?.storeName,
      },
    );

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

