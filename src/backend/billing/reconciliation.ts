import type { ParsedPaymentReceipt } from '../../domain/parser/types.js';
import { normalizePhoneNumberE164 } from '../../domain/routing/phone-utils.js';
import type { Merchant } from '../../domain/routing/types.js';
import type { IWhatsAppCloudApiClient } from '../../whatsapp/types.js';
import type { StoredNotificationRecord } from '../webhook/types.js';
import type {
  BillingInvoiceRecord,
  BillingItemType,
  BillingReconciliationConfig,
  IBillingInvoicesRepository,
  ReconciliationResult,
  ReconciliationStrategy,
} from './types.js';
import {
  extractColombianPhoneNumbers,
  extractReferenceCodesFromText,
  generateInvoiceReferenceCode,
} from './utils.js';

export interface BillingReconciliationDependencies {
  config: BillingReconciliationConfig;
  repository: IBillingInvoicesRepository;
  whatsappClient: IWhatsAppCloudApiClient;
  nowProvider?: () => number;
}

/**
 * Servicio de Auto-Renovación por Dogfooding (Ticket 22 / Fase 5).
 *
 * Utiliza el Dispositivo Centinela propio de MurSat Solutions para interceptar
 * pagos entrantes al Nequi/Bancolombia de la compañía, reconciliarlos
 * automáticamente contra un comercio cliente y renovar planes o acreditar add-ons.
 */
export class BillingReconciliationService {
  private readonly config: BillingReconciliationConfig;
  private readonly repository: IBillingInvoicesRepository;
  private readonly whatsappClient: IWhatsAppCloudApiClient;
  private readonly nowProvider: () => number;

  constructor(deps: BillingReconciliationDependencies) {
    this.config = {
      billingSentinelDeviceId: deps.config.billingSentinelDeviceId,
      minPlanPriceCop: deps.config.minPlanPriceCop ?? 7_900,
      defaultPlanDays: deps.config.defaultPlanDays ?? 30,
    };
    this.repository = deps.repository;
    this.whatsappClient = deps.whatsappClient;
    this.nowProvider = deps.nowProvider ?? (() => Date.now());
  }

  get billingSentinelDeviceId(): string {
    return this.config.billingSentinelDeviceId;
  }

  get minPlanPriceCop(): number {
    return this.config.minPlanPriceCop!;
  }

  /**
   * Determina si una notificación capturada proviene del nodo Centinela de Facturación de MurSat.
   * Soporta identificador único, lista separada por comas (para permitir que convivan
   * el Centinela celular y el correo Cloud Inbound de MurSat), o identificadores con prefijo mursat.
   */
  isBillingSentinel(deviceId: string): boolean {
    if (!deviceId) return false;
    const target = deviceId.trim().toLowerCase();

    if (this.config.billingSentinelDeviceId) {
      const configuredSentinels = this.config.billingSentinelDeviceId
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (configuredSentinels.includes(target)) {
        return true;
      }
    }

    // Coincidencia por convención segura de MurSat Solutions
    if (target.includes('mursat') || target.startsWith('cloud_email_mursat')) {
      return true;
    }

    return false;
  }

  /**
   * Intenta conciliar un pago capturado contra los comercios clientes y ejecutar
   * la renovación o acreditación de add-ons de forma atómica.
   */
  async reconcile(
    notification: StoredNotificationRecord,
    receipt: ParsedPaymentReceipt,
  ): Promise<ReconciliationResult> {
    const now = this.nowProvider();

    // 1. Criterio de Aislamiento Estricto: solo el Centinela de MurSat ejecuta dogfooding
    if (!this.isBillingSentinel(notification.deviceId)) {
      return {
        isBillingSentinel: false,
        isDogfooding: false,
        success: false,
        failureReason: 'NOT_BILLING_SENTINEL',
        details: `Dispositivo ${notification.deviceId} no corresponde al Centinela de Facturación de MurSat`,
      };
    }

    // 2. Criterio de Monto Mínimo: pagos inferiores al add-on más económico ($7.900) registran auditoría y no acreditan
    if (receipt.amount < this.minPlanPriceCop) {
      return {
        isBillingSentinel: true,
        isDogfooding: true,
        success: false,
        failureReason: 'INSUFFICIENT_AMOUNT',
        amountCop: receipt.amount,
        minRequiredCop: this.minPlanPriceCop,
        details: `Monto recibido ($${receipt.amount}) inferior al precio oficial del Plan Pro ($${this.minPlanPriceCop})`,
      };
    }

    let matchedMerchant: Merchant | null = null;
    let matchedInvoice: BillingInvoiceRecord | null = null;
    let strategy: ReconciliationStrategy | undefined;
    let matchedReference: string | undefined;
    let matchedPhone: string | undefined;

    // 3. Estrategia A: Conciliación por Código de Referencia Comercial (TYA-XXXXXX o Ref bancaria)
    const combinedReferenceCandidates = [
      ...(receipt.reference ? [receipt.reference.trim()] : []),
      ...extractReferenceCodesFromText(notification.rawText),
      ...extractReferenceCodesFromText(notification.rawTitle),
    ];

    for (const refCandidate of combinedReferenceCandidates) {
      const invoice = await this.repository.findInvoiceByReference(refCandidate);
      if (invoice) {
        if (invoice.status === 'PAID') {
          return {
            isBillingSentinel: true,
            isDogfooding: true,
            success: false,
            failureReason: 'ALREADY_PAID',
            matchedInvoice: invoice,
            matchedReference: refCandidate,
            amountCop: receipt.amount,
            details: `La factura con referencia ${refCandidate} ya fue acreditada previamente`,
          };
        }

        const merchant = await this.repository.findMerchantById(invoice.merchant_id);
        if (merchant) {
          matchedMerchant = merchant;
          matchedInvoice = invoice;
          matchedReference = refCandidate;
          strategy = 'REFERENCE_CODE';
          break;
        }
      }
    }

    // 4. Estrategia B: Conciliación por Teléfono del Dueño (billing_phone en formato E.164)
    if (!matchedMerchant) {
      const combinedPhoneCandidates = [
        ...extractColombianPhoneNumbers(notification.rawText),
        ...extractColombianPhoneNumbers(receipt.senderName),
        ...extractColombianPhoneNumbers(receipt.reference),
      ];

      for (const phoneCandidate of combinedPhoneCandidates) {
        const merchant = await this.repository.findMerchantByBillingPhone(phoneCandidate);
        if (merchant) {
          matchedMerchant = merchant;
          matchedPhone = phoneCandidate;
          strategy = 'BILLING_PHONE';

          // Buscar si el comercio tenía una factura pendiente
          const pendingInvoice = await this.repository.getPendingInvoiceForMerchant(merchant.id);
          if (pendingInvoice) {
            matchedInvoice = pendingInvoice;
          }
          break;
        }
      }
    }

    // 5. Si no se logró identificar al comercio remitente
    if (!matchedMerchant) {
      return {
        isBillingSentinel: true,
        isDogfooding: true,
        success: false,
        failureReason: 'UNMATCHED_MERCHANT',
        amountCop: receipt.amount,
        details: 'No se encontró ningún comercio cliente coincidente con la referencia o teléfono del pago',
      };
    }

    // 6. Clasificación del Item (Suscripción o Add-on) según monto y factura (Fase 5)
    let itemType: BillingItemType = matchedInvoice?.item_type || 'plan_subscription';
    let targetPlanId: string | undefined = undefined;
    let daysToAdd = this.config.defaultPlanDays ?? 30;
    let extraAlertsAdded = 0;
    let extraCashiersAdded = 0;

    const amt = receipt.amount;
    if (itemType === 'addon_alerts' || amt === 7900) {
      itemType = 'addon_alerts';
      extraAlertsAdded = 1000;
    } else if (itemType === 'addon_cashier' || amt === 12900) {
      itemType = 'addon_cashier';
      extraCashiersAdded = 1;
      extraAlertsAdded = 1200;
    } else {
      itemType = 'plan_subscription';
      if (amt === 299000 || amt === 499000 || amt === 899000) {
        daysToAdd = 365;
        if (amt === 299000) targetPlanId = 'emprendedor';
        else if (amt === 499000) targetPlanId = 'negocio';
        else targetPlanId = 'pro';
      } else {
        daysToAdd = 30;
        if (amt === 29900) targetPlanId = 'emprendedor';
        else if (amt === 49900) targetPlanId = 'negocio';
        else if (amt === 89900 || amt === 50000) targetPlanId = 'pro';
      }
    }

    let newEndsAtIso: string | undefined;
    let previousEndsAtIso: string | null = null;
    let daysRemaining: number | undefined;

    if (itemType === 'addon_alerts' || itemType === 'addon_cashier') {
      if (this.repository.applyAddonPurchase) {
        const addonRes = await this.repository.applyAddonPurchase(
          matchedMerchant.id,
          itemType,
          receipt.amount,
          notification.id,
          now,
        );
        extraAlertsAdded = addonRes.extraAlerts;
        extraCashiersAdded = addonRes.extraCashiers;
      }
    } else {
      // Renovación comercial del plan
      const renewalResult = await this.repository.extendMerchantSubscription(
        matchedMerchant.id,
        daysToAdd,
        now,
        targetPlanId,
      );
      newEndsAtIso = renewalResult.newEndsAt;
      previousEndsAtIso = renewalResult.previousEndsAt;
      daysRemaining = renewalResult.daysRemaining;
    }

    // 7. Ciclo de Vida de Factura (marcar como PAID o crear factura completada)
    let finalInvoice: BillingInvoiceRecord;
    if (matchedInvoice) {
      finalInvoice = await this.repository.markInvoicePaid(
        matchedInvoice.id,
        notification.id || '',
        now,
      );
    } else {
      finalInvoice = await this.repository.createInvoice({
        merchantId: matchedMerchant.id,
        amountCop: receipt.amount,
        referenceCode: generateInvoiceReferenceCode(),
        status: 'PAID',
        itemType,
        itemDescription:
          itemType === 'addon_alerts'
            ? 'Paquete 1.000 Alertas WhatsApp Extra'
            : itemType === 'addon_cashier'
              ? 'Add-on Cajero WhatsApp Extra (+1.200 alertas)'
              : `Renovación ${targetPlanId ? `Plan ${targetPlanId}` : 'Suscripción'} (${daysToAdd} días)`,
        notificationId: notification.id,
        paidAt: new Date(now).toISOString(),
      });
    }

    // 8. Despacho de WhatsApp de Confirmación al Dueño
    let whatsappSent = false;
    let whatsappMessageId: string | undefined;

    if (matchedMerchant.billingPhone) {
      try {
        const ownerPhone = normalizePhoneNumberE164(matchedMerchant.billingPhone);
        const sendResult = await this.whatsappClient.sendRenewalConfirmation(
          ownerPhone,
          {
            amountCop: receipt.amount,
            storeName: matchedMerchant.name,
            newEndsAtIso: newEndsAtIso || new Date(now + 30 * 86400000).toISOString(),
            daysRemaining: daysRemaining ?? 30,
            referenceCode: finalInvoice.reference_code,
          },
        );

        if (sendResult.success) {
          whatsappSent = true;
          whatsappMessageId = sendResult.messageId;
        }
      } catch (waErr) {
        console.error('Error despachando confirmación de renovación WhatsApp:', waErr);
      }
    }

    return {
      isBillingSentinel: true,
      isDogfooding: true,
      success: true,
      matchedMerchant,
      matchedInvoice: finalInvoice,
      strategy,
      matchedReference: matchedReference ?? finalInvoice.reference_code,
      matchedPhone,
      amountCop: receipt.amount,
      itemType,
      planId: targetPlanId,
      extraAlertsAdded,
      extraCashiersAdded,
      newEndsAtIso,
      previousEndsAtIso,
      daysRemaining,
      whatsappSent,
      whatsappMessageId,
    };
  }
}
