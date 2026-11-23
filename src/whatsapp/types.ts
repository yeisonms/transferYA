import type { ParsedPaymentReceipt, SupportedWallet } from '../domain/parser/types.js';

/**
 * Resultado discriminado del envío de mensajes a través de Meta WhatsApp Cloud API.
 */
export type WhatsAppSendResult =
  | {
      success: true;
      messageId: string;
    }
  | {
      success: false;
      error:
        | 'BAD_REQUEST'
        | 'UNAUTHORIZED'
        | 'RATE_LIMITED'
        | 'NETWORK_ERROR'
        | 'TEMPLATE_NOT_FOUND'
        | 'UNKNOWN_ERROR';
      statusCode?: number;
      message: string;
      details?: unknown;
    };

/**
 * Parámetro dinámico dentro de una plantilla de WhatsApp.
 */
export interface TemplateTextParameter {
  type: 'text';
  text: string;
}

export type TemplateParameter = TemplateTextParameter;

/**
 * Componente de plantilla de WhatsApp (HEADER, BODY, BUTTON).
 */
export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'url' | 'quick_reply';
  index?: string;
  parameters: TemplateParameter[];
}

/**
 * Payload JSON canónico enviado al endpoint de Graph API de Meta.
 */
export interface WhatsAppTemplatePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'template';
  template: {
    name: string;
    language: {
      code: string;
    };
    components: TemplateComponent[];
  };
}

/**
 * Opciones para el formateo de alertas de confirmación de pago.
 */
export interface PaymentAlertOptions {
  isStale: boolean;
  capturedAt: number;
  latencyMs?: number;
  cashierName?: string;
  deviceLabel?: string;
}

/**
 * Parámetros para la notificación de cobro/retención comercial al dueño.
 */
export interface SubscriptionNoticeOptions {
  amount: number;
  wallet?: SupportedWallet;
  storeName?: string;
  isSuspended?: boolean;
  renewalPriceCop?: number;
}

/**
 * Parámetros para la confirmación de auto-renovación de suscripción (Dogfooding).
 */
export interface RenewalConfirmationOptions {
  amountCop: number;
  storeName?: string;
  newEndsAtIso: string;
  daysRemaining: number;
  referenceCode?: string;
}

/**
 * Parámetros para la bienvenida de prueba gratuita (Trial Day 1).
 */
export interface TrialWelcomeOptions {
  storeName?: string;
  trialDays?: number;
}

/**
 * Parámetros para recordatorios preventivos de expiración de prueba (Trial Day 5 / Day 7).
 */
export interface TrialReminderOptions {
  storeName?: string;
  daysRemaining: number;
  minPriceCop?: number;
}

/**
 * Abstracción de cliente HTTP para desacoplar de bibliotecas externas (fetch, axios, got).
 */
export interface HttpResponseData<T = any> {
  status: number;
  data: T;
}

export interface IHttpClient {
  post<T = any>(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<HttpResponseData<T>>;
}

/**
 * Contrato del cliente de WhatsApp Cloud API.
 */
export interface IWhatsAppCloudApiClient {
  /**
   * Envía una plantilla genérica pre-aprobada de WhatsApp.
   */
  sendTemplate(
    to: string,
    templateName: string,
    components: TemplateComponent[],
    languageCode?: string,
  ): Promise<WhatsAppSendResult>;

  /**
   * Envía la alerta de confirmación de pago al cajero, conmutando automáticamente
   * entre la plantilla regular y la plantilla de Stale Alert si hay retraso de red.
   */
  sendPaymentAlert(
    to: string,
    payment: ParsedPaymentReceipt,
    options: PaymentAlertOptions,
  ): Promise<WhatsAppSendResult>;

  /**
   * Envía la alerta de cobro/retención comercial directamente al WhatsApp del dueño
   * cuando un pago ingresa pero la suscripción está vencida (PAST_DUE) o pausada (SUSPENDED).
   */
  sendSubscriptionNotice(
    to: string,
    options: SubscriptionNoticeOptions,
  ): Promise<WhatsAppSendResult>;

  /**
   * Envía la confirmación de auto-renovación comercial al WhatsApp del dueño (Dogfooding)
   * tras acreditar el pago de mensualidad en la cuenta Nequi de MurSat.
   */
  sendRenewalConfirmation(
    to: string,
    options: RenewalConfirmationOptions,
  ): Promise<WhatsAppSendResult>;

  /**
   * Envía mensaje de bienvenida al dueño al vincular su primera caja durante el período de prueba (Trial Día 1).
   */
  sendTrialWelcome(
    to: string,
    options: TrialWelcomeOptions,
  ): Promise<WhatsAppSendResult>;

  /**
   * Envía recordatorio preventivo al dueño antes del vencimiento del período de prueba (Día 5 o Día 7).
   */
  sendTrialReminder(
    to: string,
    options: TrialReminderOptions,
  ): Promise<WhatsAppSendResult>;

  /**
   * Envía un mensaje de texto plano directamente por WhatsApp Cloud API.
   */
  sendTextMessage?(
    to: string,
    text: string,
  ): Promise<WhatsAppSendResult>;

  /**
   * Envía alerta de WhatsApp al dueño cuando el celular Centinela pierde conexión o se apaga (> 5 min).
   */
  sendOfflineSentinelAlert?(
    to: string,
    options: { deviceLabel: string; merchantName?: string; minutesOffline: number },
  ): Promise<WhatsAppSendResult>;
}

export type IWhatsAppClient = IWhatsAppCloudApiClient;

