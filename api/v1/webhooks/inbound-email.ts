import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleInboundEmail } from '../../../src/backend/webhook/inbound-email-handler.js';

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  return handleInboundEmail(req, res);
}
