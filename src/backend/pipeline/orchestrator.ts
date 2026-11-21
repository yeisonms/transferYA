import { getPlanById } from '../../config/plans.js';
import {
  generateCanonicalPaymentFingerprint,
  generatePaymentFingerprint,
} from '../../domain/idempotency/fingerprint.js';
import { parseBankingNotification } from '../../domain/parser/engine.js';
import { parseNequiEmailReceipt, parseBancolombiaEmailReceipt } from '../../domain/parser/email-parser.js';
import type {
  ParsedPaymentReceipt,
  ParseResult,
} from '../../domain/parser/types.js';
import { normalizePhoneNumberE164 } from '../../domain/routing/phone-utils.js';
import type { Merchant } from '../../domain/routing/types.js';
import type {
  DispatchSummary,
  MerchantUsageRecord,
  PaymentPipelineDependencies,
  PipelineResult,
} from './types.js';

// Cola de promesas en memoria para serializar solicitudes concurrentes del mismo monto y comercio
const inFlightDeduplicationLocks = new Map<string, Promise<void>>();

async function acquireDeduplicationLock(key: string): Promise<() => void> {
  while (inFlightDeduplicationLocks.has(key)) {
    try {
      await inFlightDeduplicationLocks.get(key);
    } catch { }
  }
  let release: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  inFlightDeduplicationLocks.set(key, promise);
  return () => {
    if (inFlightDeduplicationLocks.get(key) === promise) {
      inFlightDeduplicationLocks.delete(key);
    }
    release();
  };
}

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
      deps.fingerprintGenerator ?? generateCanonicalPaymentFingerprint;
    this.nowProvider = deps.nowProvider ?? (() => Date.now());
    this.billingNoticeCooldownMs =
      deps.billingNoticeCooldownMs ?? 6 * 60 * 60 * 1000;
    this.renewalPriceCop = deps.renewalPriceCop ?? 49_900;
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

        // Resolver precio de renovación dinámico según el plan del comercio (o Plan Negocio por defecto)
        let effectiveRenewalPrice = this.renewalPriceCop;
        if (merchant.planId) {
          const plan = getPlanById(merchant.planId);
          if (plan) {
            effectiveRenewalPrice = plan.priceMonthlyCop;
          }
        }

        const sendRes = await this.deps.whatsappClient.sendSubscriptionNotice(
          ownerPhone,
          {
            amount: receipt.amount,
            wallet: receipt.wallet,
            storeName: merchant.name,
            isSuspended: reason === 'SUBSCRIPTION_SUSPENDED',
            renewalPriceCop: effectiveRenewalPrice,
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

    // 1. Ejecutar motor de parsing (soporta notificaciones push locales y comprobantes de correo inbound)
    const parseResult =
      notification.walletPackage === 'com.nequi.inbound.email'
        ? parseNequiEmailReceipt({
          from: '',
          subject: notification.rawTitle,
          text: notification.rawText,
        })
        : notification.walletPackage === 'com.bancolombia.inbound.email'
          ? parseBancolombiaEmailReceipt({
            from: '',
            subject: notification.rawTitle,
            text: notification.rawText,
          })
          : this.parser(
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

    // Determinar o generar Referencia de Transferencia para auditoría y trazabilidad
    const hasOfficialRef = Boolean(receipt.reference && receipt.reference.trim());
    const finalReference = hasOfficialRef
      ? receipt.reference!.trim().toUpperCase()
      : (() => {
        const isBreB =
          /bre-b/i.test(notification.rawTitle || '') ||
          /bre-b/i.test(notification.rawText || '') ||
          notification.walletPackage === 'com.nequi.inbound.email' ||
          receipt.senderName === 'Transferencia Bre-B';
        const prefix = isBreB ? 'BREB' : 'TRF';
        const rawId = (notification.id || notificationId).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const shortId = rawId.length > 8 ? rawId.slice(-8) : rawId;
        return `${prefix}-${shortId}`;
      })();

    if (hasOfficialRef) {
      receipt.reference = finalReference;
    }

    // Intentar resolver merchantId para habilitar deduplicación multicanal híbrida por comercio
    let merchantId: string | undefined;
    try {
      const earlyRoute = await this.deps.routingService.resolveRoute(notification.deviceId);
      if (earlyRoute.merchant) {
        merchantId = earlyRoute.merchant.id;
      }
    } catch {
      // Si la resolución de ruta falla tempranamente, continúa sin merchantId
    }

    // Serializar el procesamiento de pagos del mismo comercio y monto para evitar condiciones de carrera concurrentes
    const lockKey = `${merchantId || 'global'}:${receipt.amount}`;
    const releaseLock = await acquireDeduplicationLock(lockKey);

    try {
      // Inmediatamente marcar como PROCESSING e incluir monto, remitente y referencia para auditoría en tiempo real
      await this.deps.notificationRepository.updateNotification(notificationId, {
        status: 'PROCESSING',
        amount: receipt.amount,
        senderName: receipt.senderName,
        paymentReference: finalReference,
      });

      // 3. Evaluar duplicados cruzados multicanal (Centinela vs Gmail) e Idempotencia previa
      if (this.deps.notificationRepository.findRecentDuplicatePayment && merchantId) {
        const recentDup = await this.deps.notificationRepository.findRecentDuplicatePayment({
          merchantId,
          amount: receipt.amount,
          capturedAt: notification.capturedAt,
          currentDeviceId: notification.deviceId,
          currentNotificationId: notification.id || notificationId,
          reference: hasOfficialRef ? finalReference : null,
          senderName: receipt.senderName,
          rawTitle: notification.rawTitle,
        });

        if (recentDup) {
          const canonicalRef = recentDup.paymentReference || finalReference;
          await this.deps.notificationRepository.updateNotification(
            notificationId,
            {
              status: 'DUPLICATE_PAYMENT',
              amount: receipt.amount,
              senderName: receipt.senderName,
              paymentReference: canonicalRef,
              failureReason: `Pago duplicado multicanal (coincide con notificación ${recentDup.id})`,
            },
          );

          // Si el registro original tenía nombre genérico 'Transferencia Bre-B' y el nuevo tiene nombre real, enriquecer
          if (
            recentDup.senderName === 'Transferencia Bre-B' &&
            receipt.senderName &&
            receipt.senderName !== 'Transferencia Bre-B'
          ) {
            try {
              await this.deps.notificationRepository.updateNotification(recentDup.id, {
                status: 'PROCESSED',
                senderName: receipt.senderName,
              });
            } catch { }
          }

          return {
            status: 'DUPLICATE_PAYMENT',
            notificationId,
            fingerprint: `dup:${recentDup.id}`,
            existingFingerprintRecord: {
              id: recentDup.id,
              deviceId: recentDup.deviceId || notification.deviceId,
              fingerprint: `dup:${recentDup.id}`,
              wallet: receipt.wallet,
              amount: receipt.amount,
              senderName: receipt.senderName,
              capturedAt: recentDup.capturedAt || notification.capturedAt,
            },
          };
        }
      }

      // 4. Generar y evaluar Huella de Idempotencia estándar
      const fingerprint = this.fingerprintGenerator(
        receipt,
        notification.capturedAt,
      );

      const fpResult = await this.deps.fingerprintRepository.registerFingerprint({
        deviceId: notification.deviceId,
        merchantId,
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
            paymentReference: receipt.reference || finalReference,
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

      // 5. Control de cuota mensual de WhatsApp (Fase 4: Reglas de Negocio)
      let isQuotaExceeded = false;
      let merchantUsage: MerchantUsageRecord | null = null;

      if (this.deps.usageRepository && typeof this.deps.usageRepository.getMerchantUsage === 'function') {
        try {
          merchantUsage = await this.deps.usageRepository.getMerchantUsage(routeResult.merchant.id);
          if (merchantUsage && merchantUsage.usedAlerts >= merchantUsage.quotaAlerts) {
            isQuotaExceeded = true;
          }
        } catch (usageErr) {
          console.warn('Advertencia consultando cuota de alertas del comercio:', usageErr);
        }
      }

      // Si el comercio alcanzó el 100% de su cupo mensual:
      // Se pausa el despacho a WhatsApp para proteger presupuesto Meta,
      // pero la transacción se procesa con éxito en la base de datos, Panel Web y Pantalla POS
      if (isQuotaExceeded) {
        await this.deps.notificationRepository.updateNotification(
          notificationId,
          {
            status: 'PROCESSED',
            amount: receipt.amount,
            senderName: receipt.senderName,
            paymentReference: receipt.reference || finalReference,
            whatsappMessageIds: [],
            failureReason: 'WhatsApp pausado: cupo mensual de alertas alcanzado (100%)',
            processedAt: now,
          },
        );

        // Evaluar oportunamente nutrición de prueba (Trial Day 5 / Day 7) si aplica
        if (
          routeResult.merchant.subscriptionStatus === 'TRIAL' &&
          this.deps.trialNurtureService &&
          typeof this.deps.trialNurtureService.evaluateMerchantTrial === 'function'
        ) {
          this.deps.trialNurtureService
            .evaluateMerchantTrial(routeResult.merchant)
            .catch((err: any) => {
              console.warn('Advertencia evaluando recordatorio de trial en pipeline:', err);
            });
        }

        return {
          status: 'PROCESSED',
          notificationId,
          fingerprint,
          receipt,
          merchantId: routeResult.merchant.id,
          dispatches: [],
          whatsappQuotaExceeded: true,
        };
      }

      // 6. Despachar a WhatsApp a los destinatarios de caja autorizados
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

        const dispatchItem: DispatchSummary = {
          recipientId: recipient.id,
          phoneNumber: recipient.phoneNumber,
          success: sendResult.success,
          messageId: sendResult.success ? sendResult.messageId : undefined,
          error: !sendResult.success ? sendResult.message : undefined,
        };
        dispatches.push(dispatchItem);

        // Registro de auditoría financiera individual y descuento de cuota
        if (sendResult.success && this.deps.usageRepository && typeof this.deps.usageRepository.recordWhatsAppDispatch === 'function') {
          try {
            await this.deps.usageRepository.recordWhatsAppDispatch({
              merchantId: routeResult.merchant.id,
              cashierPhone: recipient.phoneNumber,
              wamid: sendResult.messageId,
              category: 'utility',
              estimatedCostCop: 2.95,
              notificationId,
            });
          } catch (logErr) {
            console.warn('Error registrando auditoría en whatsapp_usage_logs:', logErr);
          }
        }
      }

      // Evaluar semáforo de advertencia al 80% si aún no se ha alertado al dueño este mes
      if (
        this.deps.usageRepository &&
        merchantUsage &&
        !merchantUsage.warning80SentAt
      ) {
        const successfulCount = dispatches.filter((d) => d.success).length;
        const newUsed = merchantUsage.usedAlerts + successfulCount;
        if (newUsed >= merchantUsage.quotaAlerts * 0.8 && newUsed < merchantUsage.quotaAlerts) {
          try {
            if (this.deps.usageRepository.recordQuotaWarningSent) {
              await this.deps.usageRepository.recordQuotaWarningSent(routeResult.merchant.id, now);
            }
          } catch (warnErr) {
            console.warn('Error registrando semáforo 80%:', warnErr);
          }
        }
      }

      const successfulDispatches = dispatches.filter((d) => d.success);

      // 7. Actualización en base de datos
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
            paymentReference: receipt.reference || finalReference,
            whatsappMessageIds: messageIds,
            processedAt: now,
          },
        );

        // Evaluar oportunamente nutrición de prueba (Trial Day 5 / Day 7) si aplica
        if (
          routeResult.merchant.subscriptionStatus === 'TRIAL' &&
          this.deps.trialNurtureService &&
          typeof this.deps.trialNurtureService.evaluateMerchantTrial === 'function'
        ) {
          this.deps.trialNurtureService
            .evaluateMerchantTrial(routeResult.merchant)
            .catch((err: any) => {
              console.warn('Advertencia evaluando recordatorio de trial en pipeline:', err);
            });
        }

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
    } finally {
      releaseLock();
    }
  }
}
