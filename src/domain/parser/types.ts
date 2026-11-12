/**
 * Billeteras digitales soportadas en Colombia.
 */
export type SupportedWallet = 'NEQUI' | 'DAVIPLATA';

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

