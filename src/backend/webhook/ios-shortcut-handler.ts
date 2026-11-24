import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseBankingNotification } from '../../domain/parser/engine.js';
import { MerchantRoutingService } from '../../domain/routing/service.js';
import { WhatsAppCloudApiClient } from '../../whatsapp/client.js';
import { BillingReconciliationService } from '../billing/reconciliation.js';
import { PaymentProcessingPipeline } from '../pipeline/orchestrator.js';
import { WebPushService } from '../push/service.js';
import { getSupabaseRepository } from '../supabase/client.js';
import type { StoredNotificationRecord } from './types.js';

export interface IosShortcutHandlerOptions {
  repository?: any;
  fingerprintRepository?: any;
  whatsappClient?: any;
  nowProvider?: () => number;
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
      return { text: req.body };
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
            resolve(Object.keys(obj).length > 0 ? obj : { text: raw });
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
        resolve(Object.keys(obj).length > 0 ? obj : { text: raw });
      }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * Endpoint Receptor para Automatizaciones de Atajos de iOS (iPhone / SMS Bancolombia / Nequi).
 *
 * Permite que comerciantes que operan desde iPhone capturen SMS bancarios entrantes
 * y los despachen a través del Pipeline oficial de TransferYA con deduplicación y WhatsApp.
 */
export async function handleIosShortcutWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  options: IosShortcutHandlerOptions = {},
): Promise<void> {
  const method = req.method ?? 'POST';
  const now = options.nowProvider ? options.nowProvider() : Date.now();

  // Responder rápido ante pre-flight OPTIONS de navegadores o clientes HTTP
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-transferya-token');
    res.end();
    return;
  }

  if (method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: false,
        error: 'METHOD_NOT_ALLOWED',
        message: 'Solo se permiten solicitudes POST para el webhook de Atajos iOS',
      }),
    );
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  try {
    const host = req.headers.host ?? 'localhost';
    const fullUrl = new URL(req.url ?? '', `https://${host}`);
    const body = await parseRequestBody(req);

    // 1. Extraer el Token de Vinculación del Comercio
    // Soporta:
    // a) Header: x-transferya-token
    // b) Header: Authorization: Bearer <token>
    // c) Query param: ?token=... o ?merchantId=...
    // d) Body: body.token o body.merchantId
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    const rawToken =
      (req.headers['x-transferya-token'] as string) ||
      bearerToken ||
      fullUrl.searchParams.get('token') ||
      fullUrl.searchParams.get('merchant') ||
      fullUrl.searchParams.get('merchantId') ||
      body.token ||
      body.merchantId ||
      body.merchant;

    const token = typeof rawToken === 'string' ? rawToken.trim() : null;

    if (!token) {
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          success: false,
          error: 'UNAUTHORIZED',
          message:
            'Falta el token de vinculación de tu comercio en la cabecera x-transferya-token, Authorization o parámetro ?token=...',
        }),
      );
      return;
    }

    // 2. Extraer el Texto del SMS / Mensaje
    let rawText =
      body.text ||
      body.rawText ||
      body.message ||
      body.body ||
      (typeof body === 'string' ? body : '');

    // Si iOS envió el objeto Mensaje estructurado dentro de body.text
    if (typeof rawText === 'object' && rawText !== null) {
      rawText =
        rawText.content ||
        rawText.body ||
        rawText.text ||
        rawText.message ||
        rawText.value ||
        '';
    }

    // Fallback de tolerancia para Atajos de iOS:
    // Si el usuario colocó la variable del mensaje por error en la columna "Clave" en vez del campo "Valor",
    // el JSON enviado es { "<texto del sms>": "" }
    if (!rawText && typeof body === 'object' && body !== null) {
      const keys = Object.keys(body);
      if (keys.length === 1 && typeof keys[0] === 'string' && keys[0].trim().length > 10) {
        rawText = keys[0];
      }
    }

    const text = typeof rawText === 'string' ? rawText.trim() : '';

    if (!text) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          success: false,
          error: 'BAD_REQUEST',
          message: 'El texto del mensaje no puede estar vacío (campo text o message requerido)',
        }),
      );
      return;
    }

    const sender = (typeof body.sender === 'string' ? body.sender : body.from) || 'Bancolombia';

    // 3. Resolver el Comercio Suscriptor en la Base de Datos
    const repository = options.repository ?? getSupabaseRepository();

    let merchant: any = null;
    let effectiveDeviceId: string | null = null;

    // A) Verificar si el token es un device_id existente
    try {
      if (repository.getMerchantByDeviceId) {
        const found = await repository.getMerchantByDeviceId(token);
        if (found) {
          merchant = found;
          effectiveDeviceId = token;
        }
      }
    } catch {}

    // B) Verificar si el token es un merchant_id directo (UUID o slug)
    if (!merchant) {
      try {
        if (repository.getMerchantById) {
          const found = await repository.getMerchantById(token);
          if (found) merchant = found;
        }
        if (!merchant && repository.getMerchantWithOwner) {
          const found = await repository.getMerchantWithOwner(token);
          if (found) merchant = found;
        }
      } catch {}
    }

    // C) Verificar si el token es el teléfono del dueño (billing_phone)
    if (!merchant && repository.findMerchantByBillingPhone) {
      try {
        const found = await repository.findMerchantByBillingPhone(token);
        if (found) merchant = found;
      } catch {}
    }

    if (!merchant) {
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          success: false,
          error: 'UNAUTHORIZED',
          message: `Comercio no reconocido o token inválido (${token})`,
        }),
      );
      return;
    }

    // Asignar o asegurar el dispositivo virtual de iPhone
    const merchantId = merchant.id;
    if (!effectiveDeviceId) {
      effectiveDeviceId = `ios_shortcut_${merchantId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`;
      try {
        if (repository.registerDevice) {
          await repository.registerDevice(
            effectiveDeviceId,
            merchantId,
            'ios_shortcut_secret',
            'iPhone Atajos (SMS)',
          );
        }
      } catch {}
    }

    // 4. Parsear Notificación Bancaria con el motor determinista de TransferYA
    const parseResult = parseBankingNotification(text, sender);

    if (!parseResult.success) {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          status: 'IGNORED_NON_PAYMENT',
          message:
            parseResult.reason ||
            'El mensaje recibido no corresponde a una transferencia entrante monetaria',
        }),
      );
      return;
    }

    // 5. Registrar Notificación Capturada en Base de Datos
    const payment = parseResult.payment;
    const storedRecord: StoredNotificationRecord = {
      deviceId: effectiveDeviceId,
      walletPackage:
        payment.wallet === 'BANCOLOMBIA'
          ? 'com.bancolombia.sms'
          : payment.wallet === 'DAVIPLATA'
            ? 'com.daviplata.sms'
            : 'com.nequi.sms',
      rawTitle: sender,
      rawText: text,
      capturedAt: now,
      dispatchedAt: now,
      receivedAt: now,
      latencyMs: 0,
      isStale: false,
      status: 'RECEIVED',
      amount: payment.amount,
      senderName: payment.senderName,
      paymentReference: payment.reference ?? null,
    };

    const saved = await repository.saveReceivedNotification(storedRecord);
    const notificationId = saved.id;

    // 6. Despachar a través del Pipeline Oficial (Deduplicación + WhatsApp + Cuotas)
    const routingService = new MerchantRoutingService({
      repository,
      nowProvider: options.nowProvider,
    });

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
        minPlanPriceCop: Number(process.env.MIN_PLAN_PRICE_COP || 7900),
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
      usageRepository: repository,
      webPushService: new WebPushService(repository),
      nowProvider: options.nowProvider,
    });

    const pipelineResult = await pipeline.processCapturedNotification(notificationId);

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        status: pipelineResult.status,
        notificationId,
        payment: {
          amount: payment.amount,
          senderName: payment.senderName,
          reference: payment.reference,
          wallet: payment.wallet,
        },
        pipelineResult,
      }),
    );
  } catch (error: any) {
    console.error('Error procesando webhook de Atajos iOS:', error);
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        success: false,
        error: 'INTERNAL_SERVER_ERROR',
        message: error.message || 'Error interno procesando mensaje de Atajo iOS',
      }),
    );
  }
}
