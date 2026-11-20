/**
 * Billeteras y entidades financieras soportadas en Colombia.
 */
export type SupportedWallet = 'NEQUI' | 'DAVIPLATA' | 'BANCOLOMBIA';

/**
 * Entidad de dominio que representa un pago P2P confirmado extraído de una notificación.
 */
export interface ParsedPaymentReceipt {
  wallet: SupportedWallet;
  amount: number; // Monto exacto en pesos colombianos (COP), entero positivo
  senderName: string; // Nombre limpio y normalizado del remitente
  reference: string | null; // Referencia de transacción si está presente en el texto
  rawText: string; // Texto original para auditoría
}

/**
 * Resultado determinista del análisis del texto de la notificación.
 */
export type ParseResult =
  | { success: true; payment: ParsedPaymentReceipt }
  | {
      success: false;
      error: 'NOT_A_PAYMENT' | 'UNSUPPORTED_FORMAT' | 'DAVIPLATA_LLAVES_UNSPECIFIED_AMOUNT';
      reason: string;
    };

/**
 * Datos extraídos de un correo de verificación de reenvío de Google (Gmail Forwarding).
 */
export interface GoogleForwardingVerification {
  type: 'GOOGLE_FORWARDING_VERIFICATION';
  verificationCode: string;
  confirmationUrl?: string;
  requestedAddress?: string;
  rawText: string;
}

/**
 * Carga útil de un correo entrante recibido por webhook (Cloudflare / Mailgun / etc).
 */
export interface InboundEmailInput {
  from: string;
  to?: string;
  subject: string;
  text?: string;
  html?: string;
  receivedAt?: number;
}

/**
 * Resultado del parsing de un correo entrante para la Ruta Cloud de TransferYA.
 */
export type InboundEmailParseResult =
  | { success: true; type: 'PAYMENT'; payment: ParsedPaymentReceipt }
  | {
      success: true;
      type: 'GOOGLE_VERIFICATION';
      verification: GoogleForwardingVerification;
    }
  | {
      success: false;
      error: 'NOT_A_PAYMENT' | 'UNSUPPORTED_EMAIL_FORMAT';
      reason: string;
    };

