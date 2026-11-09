import type { IncomingMessage, ServerResponse } from 'node:http';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      status: 'ONLINE',
      service: 'TransferYA Core API Engine',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      supportedWallets: ['com.nequi.MobileApp', 'com.davivienda.daviplata'],
    }),
  );
}

