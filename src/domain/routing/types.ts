/**
 * Estados del ciclo de vida del Comercio Suscriptor.
 */
export type MerchantStatus =
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'PENDING_VERIFICATION';

/**
 * Estados del ciclo comercial / facturación de la suscripción (Fase 3).
 */
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';

/**
 * Entidad de dominio que representa un Comercio Suscriptor de TransferYA.
 */
export interface Merchant {
  id: string; // UUID
  name: string; // Nombre comercial
  status: MerchantStatus;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionEndsAt?: number | null; // Timestamp epoch ms (Fase 3)
  subscriptionExpiresAt?: number | null; // Timestamp epoch ms (heredado)
  billingPhone?: string | null; // WhatsApp E.164 del dueño para cobros
  createdAt: number;
}

/**
 * Destinatario de caja autorizado para recibir alertas de WhatsApp.
 */
export interface CashierRecipient {
  id: string;
  merchantId: string;
  deviceId?: string | null; // Centinela específico o null si aplica a todas las cajas
  name: string; // Identificador legible (ej. "Caja Principal", "Turno Mañana")
  phoneNumber: string; // Número internacional E.164 (ej. +573001234567)
  isActive: boolean;
}

/**
 * Razones por las que el enrutamiento puede fallar o denegar el despacho.
 */
export type RoutingFailureReason =
  | 'DEVICE_NOT_MAPPED'
  | 'MERCHANT_NOT_FOUND'
  | 'MERCHANT_INACTIVE'
  | 'NO_ACTIVE_RECIPIENTS';

/**
 * Resultado discriminado de la resolución de enrutamiento para una notificación.
 */
export type RoutingResult =
  | {
      success: true;
      merchant: Merchant;
      recipients: CashierRecipient[];
    }
  | {
      success: false;
      reason: RoutingFailureReason;
      message: string;
      merchant?: Merchant;
    };

/**
 * Contrato de persistencia y consulta para la resolución de rutas de despacho.
 */
export interface IMerchantRoutingRepository {
  /**
   * Obtiene el Comercio Suscriptor vinculado al Dispositivo Centinela dado.
   */
  getMerchantByDeviceId(deviceId: string): Promise<Merchant | null>;

  /**
   * Obtiene todos los destinatarios de caja registrados para un comercio,
   * opcionalmente filtrados por el dispositivo centinela específico de la caja.
   */
  getCashierRecipients(
    merchantId: string,
    deviceId?: string,
  ): Promise<CashierRecipient[]>;
}

