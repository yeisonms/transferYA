import { generatePaymentFingerprint } from '../../domain/idempotency/fingerprint.js';
import { parseBankingNotification } from '../../domain/parser/engine.js';
import type {
  ParsedPaymentReceipt,
  ParseResult,
} from '../../domain/parser/types.js';
import { normalizePhoneNumberE164 } from '../../domain/routing/phone-utils.js';
import type { Merchant } from '../../domain/routing/types.js';
import type {
  DispatchSummary,
  PaymentPipelineDependencies,
  PipelineResult,
} from './types.js';

/**
 * Orquestador principal del pipeline de procesamiento de pagos y despacho a WhatsApp.
 *
 * Flujo secuencial:
 * 1. Cargar la notificación capturada (`captured_notifications`).
 * 2. Ejecutar el motor de parsing determinista (Nequi / Daviplata).
 * 3. Evaluar la Huella de Idempotencia para deduplicar ráfagas de red.
 * 4. Resolver el Comercio Suscriptor y sus destinatarios de caja autorizados.
 * 5. Despachar la plantilla de WhatsApp correspondiente (regular o Stale Alert).
 * 6. Actualizar el estado en base de datos (`PROCESSED`, etc.) para auditoría.
 */
export class PaymentProcessingPipeline {
  private readonly parser: (
    rawText: string,
    rawTitle?: string,
    walletPackage?: string,
  ) => ParseResult;
  private readonly fingerprintGenerator: (
    receipt: ParsedPaymentReceipt,
    captureTimestamp: number,
  ) => string;
  private readonly nowProvider: () => number;
  private readonly billingNoticeCooldownMs: number;
  private readonly renewalPriceCop: number;
  private readonly billingNoticeTimestamps = new Map<string, number>();

  constructor(private readonly deps: PaymentPipelineDependencies) {
    this.parser = deps.parser ?? parseBankingNotification;
    this.fingerprintGenerator =
      deps.fingerprintGenerator ?? generatePaymentFingerprint;
    this.nowProvider = deps.nowProvider ?? (() => Date.now());
    this.billingNoticeCooldownMs =
      deps.billingNoticeCooldownMs ?? 6 * 60 * 60 * 1000;
    this.renewalPriceCop = deps.renewalPriceCop ?? 50_000;
  }

  private async handleBlockedSubscription(
    notificationId: string,
    receipt: ParsedPaymentReceipt,
    merchant: Merchant,
    reason: 'SUBSCRIPTION_PAST_DUE' | 'SUBSCRIPTION_SUSPENDED',
    failureMessage: string,
    now: number,
  ): Promise<PipelineResult> {
    let billingNoticeSent = false;
    let noticeMessageId: string | undefined;

    const lastSentAt = this.billingNoticeTimestamps.get(merchant.id) ?? 0;
    const isWithinCooldown =
      lastSentAt > 0 && now - lastSentAt < this.billingNoticeCooldownMs;

    if (!isWithinCooldown && merchant.billingPhone) {
      try {
        const ownerPhone = normalizePhoneNumberE164(merchant.billingPhone);
        const sendRes = await this.deps.whatsappClient.sendSubscriptionNotice(
          ownerPhone,
          {
            amount: receipt.amount,
            wallet: receipt.wallet,
            storeName: merchant.name,
            isSuspended: reason === 'SUBSCRIPTION_SUSPENDED',
            renewalPriceCop: this.renewalPriceCop,
          },
        );
        if (sendRes.success) {
          this.billingNoticeTimestamps.set(merchant.id, now);
          billingNoticeSent = true;
          noticeMessageId = sendRes.messageId;
        }
      } catch {
        // Ignorar teléfono de facturación inválido sin interrumpir el Kill Switch
      }
    }

    await this.deps.notificationRepository.updateNotification(notificationId, {
      status: 'IGNORED_SUSPENDED_ACCOUNT',
      amount: receipt.amount,
      senderName: receipt.senderName,
      paymentReference: receipt.reference,
      failureReason: failureMessage,
      whatsappMessageIds: noticeMessageId ? [noticeMessageId] : undefined,
      processedAt: now,
    });

    return {
      status: 'IGNORED_SUSPENDED_ACCOUNT',
      notificationId,
      receipt,
      merchantId: merchant.id,
      reason,
      billingNoticeSent,
    };
  }

  /**
   * Procesa de extremo a extremo una notificación capturada por su ID.
   */
  async processCapturedNotification(
    notificationId: string,
  ): Promise<PipelineResult> {
    const now = this.nowProvider();

    const notification =
      await this.deps.notificationRepository.getNotificationById(
        notificationId,
      );

    if (!notification) {
      throw new Error(
        `Notificación capturada no encontrada: ${notificationId}`,
      );
    }

    try {
      // 1. Marcar como PROCESSING
      await this.deps.notificationRepository.updateNotification(notificationId, {
        status: 'PROCESSING',
      });

    // 2. Ejecutar motor de parsing
    const parseResult = this.parser(
      notification.rawText,
      notification.rawTitle,
      notification.walletPackage,
    );

    if (!parseResult.success) {
      await this.deps.notificationRepository.updateNotification(
        notificationId,
        {
          status: 'IGNORED_NON_PAYMENT',
          failureReason: parseResult.reason,
        },
      );

      return {
        status: 'IGNORED_NON_PAYMENT',
        notificationId,
        reason: parseResult.reason,
      };
    }

    const receipt = parseResult.payment;

    // 3. Generar y evaluar Huella de Idempotencia
    const fingerprint = this.fingerprintGenerator(
      receipt,
      notification.capturedAt,
    );

    const fpResult = await this.deps.fingerprintRepository.registerFingerprint({
      deviceId: notification.deviceId,
      fingerprint,
      wallet: receipt.wallet,
      amount: receipt.amount,
      senderName: receipt.senderName,
      capturedAt: notification.capturedAt,
      id: notification.id,
    });

    if (fpResult.isDuplicate) {
      await this.deps.notificationRepository.updateNotification(
        notificationId,
        {
          status: 'DUPLICATE_PAYMENT',
          amount: receipt.amount,
          senderName: receipt.senderName,
          paymentReference: receipt.reference,
        },
      );

      return {
        status: 'DUPLICATE_PAYMENT',
        notificationId,
        fingerprint,
        existingFingerprintRecord: fpResult.existingRecord ?? {
          id: notification.id,
          deviceId: notification.deviceId,
          fingerprint,
          wallet: receipt.wallet,
          amount: receipt.amount,
          senderName: receipt.senderName,
          capturedAt: notification.capturedAt,
        },
      };
    }

    // 3.5. Evaluación de Auto-Renovación por Dogfooding (Ticket 22)
    // Si la notificación proviene del Centinela de Facturación de MurSat, se concilia
    // directamente contra la cuenta de un comercio cliente para renovar su Plan Pro.
    if (this.deps.billingReconciliationService?.isBillingSentinel(notification.deviceId)) {
      const reconResult = await this.deps.billingReconciliationService.reconcile(
        notification,
        receipt,
      );

      if (reconResult.success && reconResult.matchedMerchant) {
        await this.deps.notificationRepository.updateNotification(
          notificationId,
          {
            status: 'PROCESSED',
            amount: receipt.amount,
            senderName: receipt.senderName,
            paymentReference: receipt.reference || reconResult.matchedReference,
            whatsappMessageIds: reconResult.whatsappMessageId
              ? [reconResult.whatsappMessageId]
              : undefined,
            processedAt: now,
          },
        );

        return {
          status: 'PROCESSED',
          notificationId,
          fingerprint,
          receipt,
          merchantId: reconResult.matchedMerchant.id,
          dispatches: [],
          isDogfooding: true,
          invoiceId: reconResult.matchedInvoice?.id,
          renewedUntilIso: reconResult.newEndsAtIso,
          daysRemaining: reconResult.daysRemaining,
        };
      }

      // Conciliación fallida (monto insuficiente, factura ya pagada o comercio no identificado)
      await this.deps.notificationRepository.updateNotification(
        notificationId,
        {
          status: 'ROUTING_FAILED',
          amount: receipt.amount,
          senderName: receipt.senderName,
          paymentReference: receipt.reference,
          failureReason: reconResult.details || reconResult.failureReason,
          processedAt: now,
        },
      );

      return {
        status: 'ROUTING_FAILED',
        notificationId,
        reason: reconResult.failureReason || 'DOGFOODING_RECONCILIATION_FAILED',
        details: reconResult.details,
        isDogfooding: true,
      };
    }

    // 4. Resolver enrutamiento Comercio-Centinela-Cajeros
    const routeResult = await this.deps.routingService.resolveRoute(
      notification.deviceId,
    );

    if (!routeResult.success) {
      if (
        (routeResult.reason === 'SUBSCRIPTION_PAST_DUE' ||
          routeResult.reason === 'SUBSCRIPTION_SUSPENDED') &&
        routeResult.merchant
      ) {
        return this.handleBlockedSubscription(
          notificationId,
          receipt,
          routeResult.merchant,
          routeResult.reason,
          routeResult.message,
          now,
        );
      }

      await this.deps.notificationRepository.updateNotification(
        notificationId,
        {
          status: 'ROUTING_FAILED',
          amount: receipt.amount,
          senderName: receipt.senderName,
          paymentReference: receipt.reference,
          failureReason: routeResult.message,
        },
      );

      return {
        status: 'ROUTING_FAILED',
        notificationId,
        reason: routeResult.reason,
        details: routeResult.message,
      };
    }

    // 5. Despachar a WhatsApp a los destinatarios de caja autorizados
    const dispatches: DispatchSummary[] = [];

    for (const recipient of routeResult.recipients) {
      const sendResult = await this.deps.whatsappClient.sendPaymentAlert(
        recipient.phoneNumber,
        receipt,
        {
          isStale: notification.isStale,
          capturedAt: notification.capturedAt,
          latencyMs: notification.latencyMs,
          cashierName: recipient.name,
          deviceLabel: recipient.name || 'Caja 1',
        },
      );

      dispatches.push({
        recipientId: recipient.id,
        phoneNumber: recipient.phoneNumber,
        success: sendResult.success,
        messageId: sendResult.success ? sendResult.messageId : undefined,
        error: !sendResult.success ? sendResult.message : undefined,
      });
    }

    const successfulDispatches = dispatches.filter((d) => d.success);

    // 6. Actualización en base de datos
    if (successfulDispatches.length > 0) {
      const messageIds = successfulDispatches
        .map((d) => d.messageId)
        .filter((id): id is string => Boolean(id));

      await this.deps.notificationRepository.updateNotification(
        notificationId,
        {
          status: 'PROCESSED',
          amount: receipt.amount,
          senderName: receipt.senderName,
          paymentReference: receipt.reference,
          whatsappMessageIds: messageIds,
          processedAt: now,
        },
      );

      return {
        status: 'PROCESSED',
        notificationId,
        fingerprint,
        receipt,
        merchantId: routeResult.merchant.id,
        dispatches,
      };
    }

    // Todos los despachos a WhatsApp fallaron
    await this.deps.notificationRepository.updateNotification(
      notificationId,
      {
        status: 'DISPATCH_FAILED',
        amount: receipt.amount,
        senderName: receipt.senderName,
        paymentReference: receipt.reference,
        failureReason: 'Todos los despachos a WhatsApp fallaron',
      },
    );

    return {
      status: 'DISPATCH_FAILED',
      notificationId,
      receipt,
      dispatches,
      error: 'Todos los despachos a WhatsApp fallaron',
    };
  } catch (err: any) {
    await this.deps.notificationRepository.updateNotification(notificationId, {
      status: 'DISPATCH_FAILED',
      failureReason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
}
