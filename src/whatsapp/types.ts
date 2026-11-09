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
}

