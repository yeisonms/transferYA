import { generatePaymentFingerprint } from '../../domain/idempotency/fingerprint.js';
import { parseBankingNotification } from '../../domain/parser/engine.js';
import type {
  ParsedPaymentReceipt,
  ParseResult,
} from '../../domain/parser/types.js';
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

  constructor(private readonly deps: PaymentPipelineDependencies) {
    this.parser = deps.parser ?? parseBankingNotification;
    this.fingerprintGenerator =
      deps.fingerprintGenerator ?? generatePaymentFingerprint;
    this.nowProvider = deps.nowProvider ?? (() => Date.now());
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

    // 4. Resolver enrutamiento Comercio-Centinela-Cajeros
    const routeResult = await this.deps.routingService.resolveRoute(
      notification.deviceId,
    );

    if (!routeResult.success) {
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
