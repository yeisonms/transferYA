import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import handler from '../../../../api/v1/devices/[action].js';

function createMockReq(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
}): IncomingMessage {
  const content = options.body ? [Buffer.from(JSON.stringify(options.body))] : [];
  const req = Readable.from(content) as any;
  req.method = options.method;
  req.url = options.url;
  req.headers = options.headers || {};
  return req;
}

function createMockRes(): { res: ServerResponse; getOutput: () => { status: number; json: any } } {
  let statusCode = 200;
  let responseData = '';
  const headers: Record<string, string> = {};

  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    end: (data?: string) => {
      if (data) responseData += data;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    get statusCode() {
      return statusCode;
    },
  } as any;

  return {
    res,
    getOutput: () => ({
      status: statusCode,
      json: responseData ? JSON.parse(responseData) : null,
    }),
  };
}

describe('API Serverless /api/v1/devices/delete', () => {
  it('debe rechazar métodos HTTP no permitidos', async () => {
    const req = createMockReq({
      method: 'GET',
      url: '/api/v1/devices/delete',
    });
    const { res, getOutput } = createMockRes();

    await handler(req, res);
    const output = getOutput();
    expect(output.status).toBe(405);
    expect(output.json.error).toBe('METHOD_NOT_ALLOWED');
  });

  it('debe rechazar peticiones sin deviceId o merchantId', async () => {
    const req = createMockReq({
      method: 'POST',
      url: '/api/v1/devices/delete',
      body: { deviceId: 'dev_123' }, // missing merchantId
    });
    const { res, getOutput } = createMockRes();

    await handler(req, res);
    const output = getOutput();
    expect(output.status).toBe(400);
    expect(output.json.error).toBe('MISSING_FIELDS');
  });

  it('debe exigir autenticación válida para eliminar una caja', async () => {
    const req = createMockReq({
      method: 'POST',
      url: '/api/v1/devices/delete',
      body: { deviceId: 'dev_123', merchantId: 'm_123' },
    });
    const { res, getOutput } = createMockRes();

    await handler(req, res);
    const output = getOutput();
    expect(output.status).toBe(401);
    expect(output.json.error).toBe('MISSING_AUTH_TOKEN');
  });
});
