import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseInboundEmail, stripHtml } from '../../domain/parser/email-parser.js';
import type { InboundEmailInput } from '../../domain/parser/types.js';
import { getSupabaseRepository } from '../supabase/client.js';
import { MerchantRoutingService } from '../../domain/routing/service.js';
import { WhatsAppCloudApiClient } from '../../whatsapp/client.js';
import { BillingReconciliationService } from '../billing/reconciliation.js';
import { PaymentProcessingPipeline } from '../pipeline/orchestrator.js';
import type { StoredNotificationRecord } from './types.js';

export interface InboundHandlerOptions {
  repository?: any;
  fingerprintRepository?: any;
  whatsappClient?: any;
  secret?: string;
  nowProvider?: () => number;
}

// Cache en memoria para código de verificación de Google (consultable en tiempo real)
const googleVerificationCache = new Map<
  string,
  { code: string; url?: string; receivedAt: number }
>();

/**
 * Consulta el último código de verificación de Google recibido para un comercio.
 */
export function getLatestGoogleVerificationCode(merchantId: string) {
  return googleVerificationCache.get(merchantId) ?? null;
}

/**
 * Extrae el identificador o slug del comercio a partir de la dirección del destinatario.
 * Soporta plus-addressing (pago+slug@...) y nombres directos (slug@...).
 */
export function extractMerchantIdentifierFromRecipient(
  recipient?: string,
): string | null {
  if (!recipient || typeof recipient !== 'string') return null;

  const emailMatch = recipient.match(/<([^>]+)>/) || [null, recipient];
  const email = (emailMatch[1] || recipient).trim().toLowerCase();
  const localPart = email.split('@')[0];
  if (!localPart) return null;

  if (localPart.includes('+')) {
    const parts = localPart.split('+');
    return parts[1]?.trim() || null;
  }

  return localPart.trim();
}

/**
 * Lee y parsea el cuerpo de la solicitud HTTP (JSON, Stream o pre-parseado).
 */
async function parseRequestBody(req: any): Promise<Record<string, any>> {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (req.body && typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];

    if (typeof req[Symbol.asyncIterator] === 'function') {
      (async () => {
        try {
          for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          }
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            const params = new URLSearchParams(raw);
            const obj: Record<string, any> = {};
            for (const [k, v] of params.entries()) obj[k] = v;
            resolve(obj);
          }
        } catch {
          resolve({});
        }
      })();
      return;
    }

    req.on('data', (chunk: any) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const params = new URLSearchParams(raw);
        const obj: Record<string, any> = {};
        for (const [k, v] of params.entries()) obj[k] = v;
        resolve(obj);
      }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * Manejador principal de Inbound Email para la Ruta Cloud de TransferYA.
 */
export async function handleInboundEmail(
  req: IncomingMessage,
  res: ServerResponse,
  options: InboundHandlerOptions = {},
): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  // 1. Verificación de Seguridad (x-inbound-secret o Bearer)
  const expectedSecret = options.secret ?? process.env.INBOUND_EMAIL_SECRET;
  if (expectedSecret) {
    const inboundSecretHeader =
      req.headers['x-inbound-secret'] ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '');

    if (inboundSecretHeader !== expectedSecret) {
      res.statusCode = 401;
      res.end(JSON.stringify({ success: false, error: 'UNAUTHORIZED_SECRET' }));
      return;
    }
  }

  try {
    const body = await parseRequestBody(req);

    // Normalizar campos universales compatibles con Cloudflare Workers, Mailgun y SendGrid
    const from = String(body.from || body.sender || '').trim();
    const to = String(body.to || body.recipient || '').trim();
    const subject = String(body.subject || '').trim();
    const text = String(
      body.text || body['body-plain'] || body['stripped-text'] || '',
    ).trim();
    const html = String(body.html || body['body-html'] || '').trim();
    const receivedAt = Number(body.receivedAt || Date.now());

    if (!from && !subject && !text && !html) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          success: false,
          error: 'BAD_REQUEST',
          message: 'Carga útil de correo vacía o sin campos requeridos',
        }),
      );
      return;
    }

    const emailInput: InboundEmailInput = {
      from,
      to,
      subject,
      text,
      html,
      receivedAt,
    };

    // 2. Ejecutar motor de análisis de correos (Fase 2)
    const parseResult = parseInboundEmail(emailInput);

    if (!parseResult.success) {
      // Respondemos 200 para evitar reintentos infinitos de SMTP en correos no relevantes (spam, publicidad)
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          status: 'IGNORED_NON_PAYMENT',
          reason: parseResult.reason,
        }),
      );
      return;
    }

    const repository = options.repository ?? getSupabaseRepository();
    const now = options.nowProvider ? options.nowProvider() : Date.now();

    // 3. Extraer o resolver el Comercio Destino
    let merchantIdentifier =
      extractMerchantIdentifierFromRecipient(to) ||
      (req.url ? new URL(req.url, 'http://localhost').searchParams.get('merchantId') : null);

    // Si no vino en el destinatario, intentar extraer de headers personalizados
    if (!merchantIdentifier && req.headers['x-merchant-id']) {
      merchantIdentifier = String(req.headers['x-merchant-id']).trim();
    }

    // 4. Caso A: Verificación de Reenvío de Google (Gmail Forwarding Handshake)
    if (parseResult.type === 'GOOGLE_VERIFICATION') {
      const { verification } = parseResult;
      const targetMerchantId = merchantIdentifier || 'global';

      googleVerificationCache.set(targetMerchantId, {
        code: verification.verificationCode,
        url: verification.confirmationUrl,
        receivedAt: now,
      });

      // Si conocemos el comercio, registrar evento para auditoría
      if (merchantIdentifier) {
        try {
          const cloudDeviceId = `cloud_email_${merchantIdentifier}`;
          if (typeof repository.registerDevice === 'function') {
            await repository.registerDevice(
              cloudDeviceId,
              merchantIdentifier,
              'cloud_inbound_secret',
              'Respaldo Cloud (Gmail)',
            );
          } else if (typeof repository.registerDeviceSecret === 'function') {
            await repository.registerDeviceSecret(
              cloudDeviceId,
              merchantIdentifier,
              'cloud_inbound_secret',
              'Respaldo Cloud (Gmail)',
            );
          }

          if (typeof repository.saveReceivedNotification === 'function') {
            await repository.saveReceivedNotification({
              deviceId: cloudDeviceId,
              walletPackage: 'com.google.android.gm',
              rawTitle: 'VERIFICACION_GMAIL',
              rawText: JSON.stringify({
                code: verification.verificationCode,
                url: verification.confirmationUrl,
                requestedAddress: verification.requestedAddress,
              }),
              capturedAt: receivedAt,
              dispatchedAt: now,
              receivedAt: now,
              latencyMs: 0,
              isStale: false,
              status: 'PROCESSED',
            });
          }
        } catch (err: any) {
          console.error('[InboundEmailHandler] Error persistiendo verificación Google en DB:', err);
        }
      }

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          type: 'GOOGLE_VERIFICATION',
          verificationCode: verification.verificationCode,
          confirmationUrl: verification.confirmationUrl,
          merchantId: merchantIdentifier,
        }),
      );
      return;
    }

    // 5. Caso B: Comprobante de Pago Confirmado de Nequi
    if (parseResult.type === 'PAYMENT') {
      if (!merchantIdentifier) {
        res.statusCode = 422;
        res.end(
          JSON.stringify({
            success: false,
            error: 'MERCHANT_NOT_IDENTIFIED',
            message:
              'No se pudo asociar el correo a ningún comercio. Asegúrate de usar la dirección pago+merchantId@...',
          }),
        );
        return;
      }

      // Resolver comercio en base de datos
      let merchant = await repository.getMerchantWithOwner?.(merchantIdentifier);
      if (!merchant) {
        // Intentar resolver si vino como deviceId
        merchant = await repository.getMerchantByDeviceId?.(merchantIdentifier);
      }

      const merchantId = merchant ? merchant.id : merchantIdentifier;
      const cloudDeviceId = `cloud_email_${merchantId}`;

      // Asegurar que el dispositivo virtual de la nube exista en base de datos
      try {
        await repository.registerDevice?.(
          cloudDeviceId,
          merchantId,
          'cloud_inbound_secret',
          'Respaldo Cloud (Gmail)',
        );
      } catch { }

      // Guardar notificación capturada en base de datos (con texto limpio legible sin etiquetas HTML)
      const cleanBody = (text || stripHtml(html)).trim();
      const storedRecord: StoredNotificationRecord = {
        deviceId: cloudDeviceId,
        walletPackage: 'com.nequi.inbound.email',
        rawTitle: subject || 'Transferencia Nequi recibida por Correo',
        rawText: cleanBody || subject || '',
        capturedAt: receivedAt,
        dispatchedAt: now,
        receivedAt: now,
        latencyMs: Math.max(0, now - receivedAt),
        isStale: false,
        status: 'RECEIVED',
      };

      const saved = await repository.saveReceivedNotification(storedRecord);
      const notificationId = saved.id;

      // Despachar a través del Orquestador de Pagos
      const routingService = new MerchantRoutingService({ repository, nowProvider: options.nowProvider });
      const whatsappClient =
        options.whatsappClient ??
        new WhatsAppCloudApiClient({
          accessToken:
            process.env.META_WHATSAPP_TOKEN ||
            'EAAalAQFm5uEBTF5PTndwu9EPvlVg4SAb6pFzXECWCCUKmSnafqr6UiA0KHZCfq9R5WjYIr0z3b7ZCUHu5EPeaja9xj87NZBjQsRdDm9tDBxqxkbx8t4nOauzAJdVsaMPIq9U4CKfxA9HGHQjCtOTMvCyoLNkX6FZCEVZAc6otELlUyGEczzZAqyoj0WYLspwZDZD',
          phoneNumberId: process.env.META_PHONE_NUMBER_ID || '1541112255749953',
        });

      const billingReconciliationService = new BillingReconciliationService({
        config: {
          billingSentinelDeviceId: process.env.BILLING_SENTINEL_DEVICE_ID || '',
          minPlanPriceCop: Number(process.env.PLAN_PRO_PRICE_COP || 50000),
          defaultPlanDays: 30,
        },
        repository,
        whatsappClient,
      });

      const pipeline = new PaymentProcessingPipeline({
        notificationRepository: repository,
        fingerprintRepository: options.fingerprintRepository ?? repository,
        routingService,
        whatsappClient,
        billingReconciliationService,
        nowProvider: options.nowProvider,
      });

      const pipelineResult = await pipeline.processCapturedNotification(notificationId);

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          type: 'PAYMENT',
          notificationId,
          pipelineResult,
        }),
      );
      return;
    }
  } catch (error: any) {
    console.error('Inbound Email Error:', error);
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
