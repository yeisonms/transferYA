import type { ParsedPaymentReceipt } from '../../domain/parser/types.js';
import { normalizePhoneNumberE164 } from '../../domain/routing/phone-utils.js';
import type { Merchant } from '../../domain/routing/types.js';
import type { IWhatsAppCloudApiClient } from '../../whatsapp/types.js';
import type { StoredNotificationRecord } from '../webhook/types.js';
import type {
  BillingInvoiceRecord,
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
 * Servicio de Auto-Renovación por Dogfooding (Ticket 22).
 *
 * Utiliza el Dispositivo Centinela propio de MurSat Solutions para interceptar
 * pagos de suscripción entrantes al Nequi de la compañía, reconciliarlos
 * automáticamente contra un comercio cliente y renovar su Plan Pro (+30 Días).
 */
export class BillingReconciliationService {
  private readonly config: BillingReconciliationConfig;
  private readonly repository: IBillingInvoicesRepository;
  private readonly whatsappClient: IWhatsAppCloudApiClient;
  private readonly nowProvider: () => number;

  constructor(deps: BillingReconciliationDependencies) {
    this.config = {
      billingSentinelDeviceId: deps.config.billingSentinelDeviceId,
      minPlanPriceCop: deps.config.minPlanPriceCop ?? 50_000,
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
   */
  isBillingSentinel(deviceId: string): boolean {
    if (!deviceId || !this.config.billingSentinelDeviceId) return false;
    return deviceId.trim() === this.config.billingSentinelDeviceId.trim();
  }

  /**
   * Intenta conciliar un pago capturado contra los comercios clientes y ejecutar
   * la renovación comercial de forma atómica.
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

    // 2. Criterio de Monto Mínimo: pagos inferiores al valor del plan registran auditoría y no renuevan
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

    // 6. Ejecución Atómica de Renovación Comercial (+30 Días Pro)
    const renewalResult = await this.repository.extendMerchantSubscription(
      matchedMerchant.id,
      this.config.defaultPlanDays ?? 30,
      now,
    );

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
        notificationId: notification.id,
        paidAt: new Date(now).toISOString(),
      });
    }

    // 8. Despacho de WhatsApp de Confirmación de Renovación al Dueño
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
            newEndsAtIso: renewalResult.newEndsAt,
            daysRemaining: renewalResult.daysRemaining,
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
      newEndsAtIso: renewalResult.newEndsAt,
      previousEndsAtIso: renewalResult.previousEndsAt,
      daysRemaining: renewalResult.daysRemaining,
      whatsappSent,
      whatsappMessageId,
    };
  }
}
