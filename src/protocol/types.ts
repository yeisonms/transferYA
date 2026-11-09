/**
 * Billeteras digitales soportadas en Colombia para verificación P2P.
 */
export type SupportedWalletPackage =
  | 'com.nequi.MobileApp'
  | 'com.davivienda.daviplata';

export type SupportedWallet = 'NEQUI' | 'DAVIPLATA';

/**
 * Payload completo de la Notificación Capturada enviada desde el Dispositivo Centinela.
 */
export interface CapturedNotificationPayload {
  device_id: string;
  wallet_package: SupportedWalletPackage;
  raw_title: string;
  raw_text: string;
  captured_at: number; // Unix timestamp ms registrado por Android OS
  dispatched_at: number; // Unix timestamp ms al salir por red
  // Campos extraídos de forma opcional/preliminar (auditables)
  amount?: number | null;
  sender_name?: string | null;
  payment_reference?: string | null;
}

/**
 * Parámetros requeridos para construir la cadena canónica que será firmada con HMAC.
 */
export interface CanonicalRequestParams {
  method: string;
  path: string;
  timestamp: number | string;
  nonce: string;
  body: string | object;
}

/**
 * Cabeceras HTTP obligatorias exigidas por el Webhook de ingesta (ADR-0002).
 */
export interface WebhookAuthHeaders {
  'x-device-id': string;
  'x-timestamp': string;
  'x-nonce': string;
  'x-signature': string;
}

/**
 * Opciones para la validación de la firma y ventana temporal.
 */
export interface VerificationOptions {
  currentTimeMs?: number;
  maxTimestampDriftMs?: number; // Por defecto 30.000 ms (30 segundos según ADR-0002)
  method?: string;
  path?: string;
}

/**
 * Resultado de la verificación criptográfica en el Webhook.
 */
export type VerificationResult =
  | { success: true; isStale: boolean; latencyMs: number }
  | {
      success: false;
      error:
        | 'MISSING_HEADERS'
        | 'TIMESTAMP_DRIFT_EXCEEDED'
        | 'INVALID_NONCE'
        | 'INVALID_SIGNATURE';
      details?: string;
    };

