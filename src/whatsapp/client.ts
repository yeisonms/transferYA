import type { ParsedPaymentReceipt } from '../domain/parser/types.js';
import {
  buildHumanizedPaymentAlertText,
  formatCapturedTime,
  formatCopCurrency,
  formatRecipientForMeta,
  formatWalletDisplayName,
} from './formatter.js';
import type {
  HttpResponseData,
  IHttpClient,
  IWhatsAppCloudApiClient,
  PaymentAlertOptions,
  RenewalConfirmationOptions,
  SubscriptionNoticeOptions,
  TemplateComponent,
  WhatsAppSendResult,
  WhatsAppTemplatePayload,
} from './types.js';

export class DefaultFetchHttpClient implements IHttpClient {
  async post<T = any>(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<HttpResponseData<T>> {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    let data: any;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  }
}

export interface WhatsAppCloudApiClientConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string; // Default: 'v21.0'
  httpClient?: IHttpClient;
  maxRetries?: number; // Default: 3
  initialBackoffMs?: number; // Default: 100ms
  sleepProvider?: (ms: number) => Promise<void>;
}

/**
 * Cliente para Meta WhatsApp Cloud API (Graph API) optimizado para alta concurrencia
 * y resiliencia ante rate limits (HTTP 429).
 */
export class WhatsAppCloudApiClient implements IWhatsAppCloudApiClient {
  private readonly apiVersion: string;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly httpClient: IHttpClient;

  constructor(private readonly config: WhatsAppCloudApiClientConfig) {
    this.apiVersion = config.apiVersion ?? 'v21.0';
    this.maxRetries = config.maxRetries ?? 3;
    this.initialBackoffMs = config.initialBackoffMs ?? 100;
    this.sleep =
      config.sleepProvider ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.httpClient = config.httpClient ?? new DefaultFetchHttpClient();
  }

  async sendTemplate(
    to: string,
    templateName: string,
    components: TemplateComponent[],
    languageCode = 'es',
  ): Promise<WhatsAppSendResult> {
    const formattedTo = formatRecipientForMeta(to);
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.config.phoneNumberId}/messages`;

    const payload: WhatsAppTemplatePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedTo,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        components,
      },
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.accessToken}`,
      'Content-Type': 'application/json',
    };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.httpClient.post(url, payload, headers);

        if (response.status === 200) {
          const messageId =
            response.data?.messages?.[0]?.id ?? 'UNKNOWN_MESSAGE_ID';
          return {
            success: true,
            messageId,
          };
        }

        if (response.status === 400) {
          return {
            success: false,
            error: 'BAD_REQUEST',
            statusCode: 400,
            message:
              response.data?.error?.message ??
              'Error en los parámetros de la plantilla',
            details: response.data,
          };
        }

        if (response.status === 401) {
          return {
            success: false,
            error: 'UNAUTHORIZED',
            statusCode: 401,
            message:
              response.data?.error?.message ??
              'Token de acceso de Meta expirado o inválido',
            details: response.data,
          };
        }

        if (response.status === 404) {
          return {
            success: false,
            error: 'TEMPLATE_NOT_FOUND',
            statusCode: 404,
            message:
              response.data?.error?.message ??
              'Plantilla no encontrada o aún en revisión por Meta',
            details: response.data,
          };
        }

        if (response.status === 429) {
          if (attempt < this.maxRetries) {
            const delay = this.initialBackoffMs * Math.pow(2, attempt - 1);
            await this.sleep(delay);
            continue;
          }
          return {
            success: false,
            error: 'RATE_LIMITED',
            statusCode: 429,
            message:
              response.data?.error?.message ??
              'Límite de tasa excedido en Meta Cloud API',
            details: response.data,
          };
        }

        // Otros códigos de error HTTP
        if (attempt < this.maxRetries) {
          const delay = this.initialBackoffMs * Math.pow(2, attempt - 1);
          await this.sleep(delay);
          continue;
        }

        return {
          success: false,
          error: 'UNKNOWN_ERROR',
          statusCode: response.status,
          message: response.data?.error?.message ?? `Error HTTP ${response.status}`,
          details: response.data,
        };
      } catch (error) {
        if (attempt < this.maxRetries) {
          const delay = this.initialBackoffMs * Math.pow(2, attempt - 1);
          await this.sleep(delay);
          continue;
        }

        return {
          success: false,
          error: 'NETWORK_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Error de conexión de red con Meta Cloud API',
          details: error,
        };
      }
    }

    return {
      success: false,
      error: 'UNKNOWN_ERROR',
      message: 'Reintentos agotados sin respuesta concluyente',
    };
  }

  async sendTextMessage(to: string, text: string): Promise<WhatsAppSendResult> {
    const formattedTo = formatRecipientForMeta(to);
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.config.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedTo,
      type: 'text',
      text: { body: text },
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.accessToken}`,
      'Content-Type': 'application/json',
    };

    try {
      const response = await this.httpClient.post(url, payload, headers);
      if (response.status === 200) {
        const messageId =
          response.data?.messages?.[0]?.id ?? 'UNKNOWN_MESSAGE_ID';
        return {
          success: true,
          messageId,
        };
      }

      return {
        success: false,
        error: 'UNKNOWN_ERROR',
        statusCode: response.status,
        message:
          response.data?.error?.message ?? `Error HTTP ${response.status}`,
        details: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: 'NETWORK_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'Error de conexión de red con Meta Cloud API',
      };
    }
  }

  async sendPaymentAlert(
    to: string,
    payment: ParsedPaymentReceipt,
    options: PaymentAlertOptions,
  ): Promise<WhatsAppSendResult> {
    const formattedAmount = formatCopCurrency(payment.amount);
    const formattedWallet = formatWalletDisplayName(payment.wallet);
    const formattedTime = formatCapturedTime(options.capturedAt);

    let templateResult: WhatsAppSendResult;

    if (!options.isStale) {
      // Plantilla regular de confirmación de pago
      const components: TemplateComponent[] = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: formattedAmount },
            { type: 'text', text: payment.senderName },
            { type: 'text', text: formattedWallet },
            { type: 'text', text: formattedTime },
          ],
        },
      ];

      // Probar con es_CO (Spanish COL) y fallback a es
      templateResult = await this.sendTemplate(to, 'transferya_payment_alert_v1', components, 'es_CO');
      if (!templateResult.success) {
        templateResult = await this.sendTemplate(to, 'transferya_payment_alert_v1', components, 'es');
      }
    } else {
      // Plantilla con advertencia visual de retraso de red (Stale Alert)
      const latencySeconds = Math.round((options.latencyMs ?? 0) / 1000);
      const latencyParam = `${latencySeconds}s de retraso`;

      const components: TemplateComponent[] = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: formattedAmount },
            { type: 'text', text: payment.senderName },
            { type: 'text', text: formattedWallet },
            { type: 'text', text: formattedTime },
            { type: 'text', text: latencyParam },
          ],
        },
      ];

      templateResult = await this.sendTemplate(to, 'transferya_stale_alert_v1', components, 'es_CO');
      if (!templateResult.success) {
        templateResult = await this.sendTemplate(to, 'transferya_stale_alert_v1', components, 'es');
      }
    }

    if (templateResult.success) {
      return templateResult;
    }

    // Fallback de alta resiliencia: si la plantilla está en revisión o no aprobada aún en Meta,
    // enviar mensaje directo humanizado para que el cajero entregue la mercancía con total tranquilidad
    const fallbackText = buildHumanizedPaymentAlertText(payment, options);

    const textResult = await this.sendTextMessage(to, fallbackText);
    if (textResult.success) {
      return textResult;
    }

    return templateResult;
  }

  async sendSubscriptionNotice(
    to: string,
    options: SubscriptionNoticeOptions,
  ): Promise<WhatsAppSendResult> {
    const formattedAmount = formatCopCurrency(options.amount);
    const renewalPrice = options.renewalPriceCop ?? 50000;
    const formattedRenewal = formatCopCurrency(renewalPrice);
    const storeLabel = options.storeName ? ` (${options.storeName})` : '';

    const text = options.isSuspended
      ? `⚠️ TransferYA detectó un pago de ${formattedAmount} en tu caja${storeLabel}, pero tu comercio se encuentra pausado. Reactiva tu servicio en el panel para que tus cajeros sigan recibiendo las confirmaciones.`
      : `⚠️ TransferYA detectó un pago de ${formattedAmount} en tu caja${storeLabel}, pero tu suscripción está vencida. Renueva tu plan por ${formattedRenewal} para que tus cajeros sigan recibiendo las confirmaciones.`;

    const templateName = options.isSuspended
      ? 'transferya_account_suspended_notice_v1'
      : 'transferya_subscription_past_due_v1';

    const components: TemplateComponent[] = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: formattedAmount },
          { type: 'text', text: formattedRenewal },
        ],
      },
    ];

    let templateResult = await this.sendTemplate(to, templateName, components, 'es_CO');
    if (!templateResult.success) {
      templateResult = await this.sendTemplate(to, templateName, components, 'es');
    }

    if (templateResult.success) {
      return templateResult;
    }

    const textResult = await this.sendTextMessage(to, text);
    if (textResult.success) {
      return textResult;
    }

    return templateResult;
  }

  async sendRenewalConfirmation(
    to: string,
    options: RenewalConfirmationOptions,
  ): Promise<WhatsAppSendResult> {
    const formattedAmount = formatCopCurrency(options.amountCop);
    const dateStr = options.newEndsAtIso.split('T')[0];
    const storeLabel = options.storeName ? ` (${options.storeName})` : '';
    const refLabel = options.referenceCode ? `\nRef: ${options.referenceCode}` : '';

    const text = `🎉 *¡Pago Confirmado y Plan Renovado!*${storeLabel}\n\nConfirmamos la recepción de tu pago por *${formattedAmount}*. Tu suscripción a *TransferYA Pro* ha sido extendida +30 días con éxito.\n\n📅 Nueva vigencia: *${dateStr}* (*${options.daysRemaining} días restantes*)${refLabel}\n\n¡Tus cajas y cajeros continuarán recibiendo las notificaciones en tiempo real! ⚡`;

    const templateName = 'transferya_subscription_renewed_v1';
    const components: TemplateComponent[] = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: formattedAmount },
          { type: 'text', text: `${options.daysRemaining} días` },
          { type: 'text', text: dateStr },
        ],
      },
    ];

    let templateResult = await this.sendTemplate(to, templateName, components, 'es_CO');
    if (!templateResult.success) {
      templateResult = await this.sendTemplate(to, templateName, components, 'es');
    }

    if (templateResult.success) {
      return templateResult;
    }

    const textResult = await this.sendTextMessage(to, text);
    if (textResult.success) {
      return textResult;
    }

    return templateResult;
  }
}
