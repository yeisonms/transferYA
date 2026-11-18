import PostalMime from 'postal-mime';

export interface Env {
  TRANSFERYA_WEBHOOK_URL: string;
  INBOUND_EMAIL_SECRET: string;
}

export interface CloudflareEmailMessage {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}

export default {
  /**
   * Manejador de eventos de correo entrante vía Cloudflare Email Routing.
   */
  async email(
    message: CloudflareEmailMessage,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    try {
      // 1. Convertir el flujo crudo del correo a ArrayBuffer para parseo MIME
      const rawEmail = await new Response(message.raw).arrayBuffer();
      const parser = new PostalMime();
      const parsedEmail = await parser.parse(rawEmail);

      const payload = {
        from: message.from,
        to: message.to,
        subject: parsedEmail.subject || '',
        text: parsedEmail.text || '',
        html: parsedEmail.html || '',
        receivedAt: Date.now(),
      };

      const webhookUrl =
        env.TRANSFERYA_WEBHOOK_URL ||
        'https://transferya.app/api/v1/webhooks/inbound-email';
      const secret = env.INBOUND_EMAIL_SECRET || '';

      // 2. Disparar el webhook hacia Vercel (Edge a Vercel con baja latencia)
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-inbound-secret': secret,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[EmailWorker] Error entregando a TransferYA Webhook [${response.status}]:`,
          errorText,
        );
      } else {
        const resultText = await response.text();
        console.log(`[EmailWorker] Correo entregado exitosamente:`, resultText);
      }
    } catch (error: any) {
      console.error('[EmailWorker] Error procesando correo entrante:', error);
    }
  },

  /**
   * Manejador HTTP para diagnósticos y verificación de estado (Healthcheck).
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response(
      JSON.stringify({
        status: 'ok',
        service: 'transferya-email-router',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  },
};
