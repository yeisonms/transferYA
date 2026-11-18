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
    console.log(`[EmailWorker] Correo entrante detectado: De: ${message.from} | Para: ${message.to}`);
    try {
      let subject = message.headers.get('subject') || '';
      let text = '';
      let html = '';

      try {
        // Opción 1: Pasar el stream nativo message.raw directamente a PostalMime
        const parsedEmail = await PostalMime.parse(message.raw);
        subject = parsedEmail.subject || subject;
        text = parsedEmail.text || '';
        html = parsedEmail.html || '';
      } catch (parseErr: any) {
        console.error('[EmailWorker] Error parseando MIME con PostalMime.parse(message.raw):', parseErr);
        try {
          // Opción 2: Leer el stream como texto sin procesar
          const rawText = await new Response(message.raw).text();
          text = rawText;
        } catch (rawErr: any) {
          console.error('[EmailWorker] Error leyendo raw stream como texto:', rawErr);
        }
      }

      console.log(`[EmailWorker] Asunto: "${subject}" | Texto: ${text.length} chars | HTML: ${html.length} chars`);

      const payload = {
        from: message.from,
        to: message.to,
        subject,
        text,
        html,
        receivedAt: Date.now(),
      };

      const webhookUrl =
        env.TRANSFERYA_WEBHOOK_URL ||
        'https://www.transferya.app/api/v1/webhooks/inbound-email';
      const secret = env.INBOUND_EMAIL_SECRET || 'transferya_secret_cloud_inbound_2026';

      console.log(`[EmailWorker] Despachando a webhook: ${webhookUrl}`);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-inbound-secret': secret,
        },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });

      const responseText = await response.text();
      console.log(`[EmailWorker] Respuesta webhook [${response.status}]:`, responseText);
    } catch (error: any) {
      console.error('[EmailWorker] Error procesando correo entrante:', error);
    }
  },

  /**
   * Manejador HTTP para diagnósticos y verificación de estado (Healthcheck).
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/test-webhook') {
      try {
        const webhookUrl =
          env.TRANSFERYA_WEBHOOK_URL ||
          'https://www.transferya.app/api/v1/webhooks/inbound-email';
        const secret =
          env.INBOUND_EMAIL_SECRET || 'transferya_secret_cloud_inbound_2026';

        const testPayload = {
          from: 'forwarding-noreply@google.com',
          to: 'pago+5f38cd0c-7802-4cbf-98a3-e4fc71482dcb@transferya.app',
          subject: 'Confirmación de reenvío de Gmail: prueba de conectividad edge',
          text: 'Código de confirmación: 777888999\nPara confirmar haz clic en https://mail.google.com/mail/vf-edge-test',
          receivedAt: Date.now(),
        };

        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-inbound-secret': secret,
          },
          body: JSON.stringify(testPayload),
          redirect: 'follow',
        });

        const status = res.status;
        const text = await res.text();
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }

        return new Response(
          JSON.stringify({
            target: webhookUrl,
            status,
            response: parsed,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ error: err.message, stack: err.stack }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

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
