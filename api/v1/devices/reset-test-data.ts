import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireMerchantOwner } from '../../../src/backend/auth/supabase-auth.js';
import {
  createUserScopedRepository,
  getSupabaseEnvConfig,
  getSupabaseRepository,
} from '../../../src/backend/supabase/client.js';

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

    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    const merchantId = typeof body.merchantId === 'string' ? body.merchantId.trim() : '';
    const confirmation = body.confirmation;

    if (!deviceId || !merchantId || confirmation !== 'FORMATEAR') {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          success: false,
          error: 'INVALID_RESET_REQUEST',
          message: 'Se requiere deviceId, merchantId y confirmation="FORMATEAR".',
        }),
      );
      return;
    }

    const { supabaseUrl, anonKey } = getSupabaseEnvConfig();
    const ownership = await requireMerchantOwner(
      { headers: req.headers as Record<string, string | undefined> },
      { supabaseUrl, supabaseKey: anonKey },
      async (accessToken) => {
        const userRepo = createUserScopedRepository(accessToken);
        return userRepo.getMerchantByDeviceWithOwner(deviceId);
      },
      merchantId,
    );

    if (!ownership.authorized) {
      res.statusCode = ownership.statusCode;
      res.end(
        JSON.stringify({
          success: false,
          error: ownership.error,
          message: ownership.message,
        }),
      );
      return;
    }

    const serviceRepo = getSupabaseRepository();
    const result = await serviceRepo.resetDeviceTestData(deviceId);

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        data: result,
      }),
    );
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
