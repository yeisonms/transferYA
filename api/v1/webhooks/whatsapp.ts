import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleMetaWebhook } from '../../../src/whatsapp/webhook-handler.js';

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  return handleMetaWebhook(req, res);
}
