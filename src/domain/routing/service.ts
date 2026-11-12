import {
  evaluateEffectiveSubscriptionStatus,
  isSubscriptionAllowedToDispatch,
} from './billing.js';
import { normalizePhoneNumberE164 } from './phone-utils.js';
import type {
  CashierRecipient,
  IMerchantRoutingRepository,
  Merchant,
  RoutingResult,
} from './types.js';

export interface MerchantRoutingServiceOptions {
  repository: IMerchantRoutingRepository;
  nowProvider?: () => number;
}

/**
 * Servicio de dominio para la resolución de rutas de notificación Comercio-Centinela-Cajeros.
 */
export class MerchantRoutingService {
  constructor(private readonly options: MerchantRoutingServiceOptions) {}

  /**
   * Resuelve el Comercio Suscriptor y los cajeros activos asociados a un Dispositivo Centinela.
   */
  async resolveRoute(deviceId: string): Promise<RoutingResult> {
    const now = this.options.nowProvider ? this.options.nowProvider() : Date.now();

    const merchant = await this.options.repository.getMerchantByDeviceId(deviceId);

    if (!merchant) {
      return {
        success: false,
        reason: 'DEVICE_NOT_MAPPED',
        message: 'Dispositivo Centinela no vinculado a ningún Comercio Suscriptor',
      };
    }

    const effectiveSubStatus = evaluateEffectiveSubscriptionStatus(merchant, now);
    if (!isSubscriptionAllowedToDispatch(effectiveSubStatus)) {
      const isSuspended =
        merchant.status === 'SUSPENDED' ||
        merchant.status === 'CANCELLED' ||
        effectiveSubStatus === 'SUSPENDED';
      return {
        success: false,
        reason: isSuspended
          ? 'SUBSCRIPTION_SUSPENDED'
          : 'SUBSCRIPTION_PAST_DUE',
        message: isSuspended
          ? 'El comercio se encuentra pausado o suspendido'
          : 'Suscripcion del comercio expirada o en mora',
        merchant,
      };
    }

    const recipients = await this.options.repository.getCashierRecipients(
      merchant.id,
      deviceId,
    );

    const validActiveRecipients: CashierRecipient[] = [];

    for (const recipient of recipients) {
      if (!recipient.isActive) {
        continue;
      }

      try {
        const normalizedPhone = normalizePhoneNumberE164(recipient.phoneNumber);
        validActiveRecipients.push({
          ...recipient,
          phoneNumber: normalizedPhone,
        });
      } catch {
        // Ignorar cajeros con número telefónico malformado o irrecuperable
      }
    }

    if (validActiveRecipients.length === 0) {
      return {
        success: false,
        reason: 'NO_ACTIVE_RECIPIENTS',
        message: 'No hay destinatarios de caja activos con números telefónicos válidos',
        merchant,
      };
    }

    return {
      success: true,
      merchant,
      recipients: validActiveRecipients,
    };
  }
}

/**
 * Implementación en memoria del repositorio de enrutamiento para tests unitarios y decoupling.
 */
export class InMemoryMerchantRoutingRepository
  implements IMerchantRoutingRepository
{
  private merchantsByDevice = new Map<string, Merchant>();
  private recipientsByMerchant = new Map<string, CashierRecipient[]>();

  registerDeviceMerchant(deviceId: string, merchant: Merchant): void {
    this.merchantsByDevice.set(deviceId, merchant);
  }

  registerCashierRecipient(recipient: CashierRecipient): void {
    const list = this.recipientsByMerchant.get(recipient.merchantId) ?? [];
    list.push(recipient);
    this.recipientsByMerchant.set(recipient.merchantId, list);
  }

  async getMerchantByDeviceId(deviceId: string): Promise<Merchant | null> {
    return this.merchantsByDevice.get(deviceId) ?? null;
  }

  async getCashierRecipients(
    merchantId: string,
    deviceId?: string,
  ): Promise<CashierRecipient[]> {
    const list = this.recipientsByMerchant.get(merchantId) ?? [];
    if (!deviceId) {
      return list;
    }
    // Incluir cajeros vinculados específicamente a este dispositivo o globales (sin deviceId asignado)
    return list.filter(
      (recipient) => !recipient.deviceId || recipient.deviceId === deviceId,
    );
  }
}
