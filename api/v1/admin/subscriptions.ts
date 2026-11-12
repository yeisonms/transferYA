import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireSuperAdminSession } from '../../../src/backend/admin/auth.js';
import {
  applySubscriptionAction,
  listAdminMerchants,
} from '../../../src/backend/admin/subscriptions.js';
import type { AdminSubscriptionActionPayload } from '../../../src/backend/admin/types.js';
import {
  getSupabaseEnvConfig,
  getSupabaseRepository,
} from '../../../src/backend/supabase/client.js';

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405;
    res.end(
      JSON.stringify({
        success: false,
        error: 'METHOD_NOT_ALLOWED',
        message: 'Método HTTP no permitido. Use GET o POST.',
      }),
    );
    return;
  }

  const { supabaseUrl, anonKey } = getSupabaseEnvConfig();
  const authConfig = { supabaseUrl, supabaseKey: anonKey };

  // 1. Verificación de permisos de Super Admin (Mursat)
  const authResult = await requireSuperAdminSession(
    { headers: req.headers as Record<string, string | undefined> },
    authConfig,
  );

  if (!authResult.authorized) {
    res.statusCode = authResult.statusCode;
    res.end(
      JSON.stringify({
        success: false,
        error: authResult.error,
        message: authResult.message,
      }),
    );
    return;
  }

  const repo = getSupabaseRepository();

  try {
    if (req.method === 'GET') {
      const merchants = await listAdminMerchants(repo);
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          adminUser: {
            id: authResult.user.id,
            email: authResult.user.email,
          },
          merchants,
        }),
      );
      return;
    }

    // POST /api/v1/admin/subscriptions
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf-8');
    const payload = (rawBody ? JSON.parse(rawBody) : {}) as AdminSubscriptionActionPayload;

    if (!payload.merchantId || !payload.action) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          success: false,
          error: 'BAD_REQUEST',
          message: 'Se requieren merchantId y action en el cuerpo de la petición.',
        }),
      );
      return;
    }

    const { summary, message } = await applySubscriptionAction(repo, payload);

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        merchant: summary,
        message,
      }),
    );
  } catch (error: any) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        success: false,
        error: 'INTERNAL_SERVER_ERROR',
        message: error?.message ?? 'Error interno procesando acción administrativa.',
      }),
    );
  }
}
