import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleIosShortcutWebhook } from '../../../src/backend/webhook/ios-shortcut-handler.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleIosShortcutWebhook(req, res);
}
