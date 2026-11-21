import type { IncomingMessage, ServerResponse } from 'node:http';
import { DeviceEnrollmentHandler } from '../../../src/backend/enrollment/handler.js';
import { DeviceHeartbeatHandler } from '../../../src/backend/heartbeat/handler.js';
import { TrialNurtureService } from '../../../src/backend/billing/trial-nurture.js';
import { WhatsAppCloudApiClient } from '../../../src/whatsapp/client.js';
import { requireMerchantOwner } from '../../../src/backend/auth/supabase-auth.js';
import {
  createUserScopedRepository,
  getSupabaseEnvConfig,
  getSupabaseRepository,
} from '../../../src/backend/supabase/client.js';

async function parseJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf-8');
  return rawBody ? JSON.parse(rawBody) : {};
}

/**
 * Serverless Function Consolidada para Dispositivos Centinela:
 * Maneja /api/v1/devices/enroll, enrollment-tokens, heartbeat y reset-test-data.
 * Reduce el número de funciones serverless en Vercel Hobby (< 12 funciones).
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  const url = new URL(req.url || '/', 'http://localhost');
  const pathSegments = url.pathname.replace(/\/+$/, '').split('/');
  const pathAction = pathSegments[pathSegments.length - 1];
  const queryAction = (req as any).query?.action as string | undefined;
  const action = queryAction || pathAction;

  if (action === 'enroll') {
    return handleEnroll(req, res);
  } else if (action === 'enrollment-tokens') {
    return handleEnrollmentTokens(req, res);
  } else if (action === 'heartbeat') {
    return handleHeartbeat(req, res);
  } else if (action === 'reset-test-data') {
    return handleResetTestData(req, res);
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, error: 'NOT_FOUND', message: `Acción desconocida en devices: ${action}` }));
  }
}

async function handleEnroll(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  try {
    const body = await parseJsonBody(req);
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

async function handleEnrollmentTokens(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  try {
    const body = await parseJsonBody(req);
    const merchantId = typeof body.merchantId === 'string' ? body.merchantId.trim() : '';
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';

    if (!merchantId || !deviceId) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          success: false,
          error: 'MISSING_FIELDS',
          message: 'merchantId y deviceId son obligatorios',
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
        return userRepo.getMerchantWithOwner(merchantId);
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

    const repository = getSupabaseRepository();
    const enrollmentHandler = new DeviceEnrollmentHandler({
      enrollmentRepository: repository,
    });

    const result = await enrollmentHandler.createEnrollmentToken({
      headers: req.headers as Record<string, string | undefined>,
      body,
      method: req.method,
      path: '/api/v1/devices/enrollment-tokens',
    });

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

async function handleHeartbeat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  try {
    const body = await parseJsonBody(req);
    const repository = getSupabaseRepository();
    const heartbeatHandler = new DeviceHeartbeatHandler({
      deviceRepository: repository,
      deviceHealthRepository: repository,
      merchantRoutingRepository: repository,
      nonceCache: repository,
    });

    const result = await heartbeatHandler.handle({
      headers: req.headers as Record<string, string | undefined>,
      body,
      method: req.method,
      path: '/api/v1/devices/heartbeat',
    });

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

async function handleResetTestData(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  try {
    const body = await parseJsonBody(req);
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
    const resetSummary = await serviceRepo.resetDeviceTestData(deviceId);

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        message: `Dispositivo ${deviceId} restablecido con éxito. Registros de prueba eliminados.`,
        data: resetSummary,
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
