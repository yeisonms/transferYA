import type { IncomingMessage, ServerResponse } from 'node:http';
import { DeviceEnrollmentHandler } from '../../../src/backend/enrollment/handler.js';
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

