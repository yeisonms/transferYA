import type { IncomingMessage, ServerResponse } from 'node:http';
import { provisionMerchantForAuthenticatedUser } from '../../../src/backend/merchants/provision.js';
import { handleMerchantCloudStatusRequest } from '../../../src/backend/merchants/cloud-status.js';
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
 * Serverless Function Consolidada para Comercios:
 * Maneja /api/v1/merchants/provision y /api/v1/merchants/cloud-status.
 * Reduce el número de funciones serverless en Vercel Hobby (< 12 funciones).
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  const url = new URL(req.url || '/', 'http://localhost');
  const pathSegments = url.pathname.replace(/\/+$/, '').split('/');
  const pathAction = pathSegments[pathSegments.length - 1];
  const queryAction = (req as any).query?.action as string | undefined;
  const action = queryAction || pathAction;

  if (action === 'provision') {
    return handleProvision(req, res);
  } else if (action === 'cloud-status') {
    return handleCloudStatus(req, res);
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, error: 'NOT_FOUND', message: `Acción desconocida en merchants: ${action}` }));
  }
}

async function handleProvision(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  try {
    const body = await parseJsonBody(req);
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

async function handleCloudStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      try {
        body = await parseJsonBody(req);
      } catch {
        body = {};
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
