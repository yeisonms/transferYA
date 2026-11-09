import { verifyWebhookRequest } from '../../protocol/signer.js';
import type { CapturedNotificationPayload } from '../../protocol/types.js';
import type {
  HttpRequest,
  HttpResponse,
  StoredNotificationRecord,
  WebhookHandlerDependencies,
} from './types.js';

/**
 * Controlador de Ingesta de Notificaciones Capturadas (Ticket 02).
 * Implementa ADR-0001 (Stale Alerts) y ADR-0002 (HMAC + Anti-Replay).
 */
export class NotificationWebhookHandler {
  private nowProvider: () => number;

  constructor(private dependencies: WebhookHandlerDependencies) {
    this.nowProvider = dependencies.nowProvider ?? Date.now;
  }

  async handle(req: HttpRequest): Promise<HttpResponse> {
    const now = this.nowProvider();

    // 1. Normalizar cabeceras a minúsculas
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key.toLowerCase()] = value;
    }

    const deviceId = headers['x-device-id'];
    const timestamp = headers['x-timestamp'];
    const nonce = headers['x-nonce'];
    const signature = headers['x-signature'];

    // 2. Validar presencia de cabeceras obligatorias
    if (!deviceId || !timestamp || !nonce || !signature) {
      return {
        statusCode: 401,
        body: {
          success: false,
          error: 'UNAUTHORIZED',
          message:
            'Faltan cabeceras de autenticación obligatorias (x-device-id, x-timestamp, x-nonce, x-signature)',
        },
      };
    }

    // 3. Obtener el Device Secret asociado al Centinela
    const deviceSecret =
      await this.dependencies.deviceRepository.getDeviceSecret(deviceId);
    if (!deviceSecret) {
      return {
        statusCode: 401,
        body: {
          success: false,
          error: 'UNAUTHORIZED',
          message:
            'Dispositivo no reconocido o deshabilitado en la plataforma',
        },
      };
    }

    // 4. Validar integridad criptográfica y ventana de tiempo (ADR-0002)
    const verification = verifyWebhookRequest(
      req.headers,
      req.body as string | object,
      deviceSecret,
      {
        currentTimeMs: now,
        maxTimestampDriftMs: 30000,
      },
    );

    if (!verification.success) {
      return {
        statusCode: 401,
        body: {
          success: false,
          error: verification.error,
          message:
            verification.details ?? 'Fallo de autenticación criptográfica',
        },
      };
    }

    // 5. Prevenir ataques de repetición (Anti-Replay) mediante Nonce efímero con TTL de 60s
    const nonceAcquired = await this.dependencies.nonceCache.acquireNonce(
      deviceId,
      nonce,
      60,
    );

    if (!nonceAcquired) {
      return {
        statusCode: 409,
        body: {
          success: false,
          error: 'REPLAY_ATTACK_DETECTED',
          message:
            'Nonce ya utilizado en la ventana de tiempo activa. Posible ataque de repetición.',
        },
      };
    }

    // 6. Preparar y persistir registro de auditoría en la Base de Datos
    const payload = req.body as CapturedNotificationPayload;
    const notificationRecord: StoredNotificationRecord = {
      deviceId,
      walletPackage: payload.wallet_package,
      rawTitle: payload.raw_title,
      rawText: payload.raw_text,
      capturedAt: payload.captured_at,
      dispatchedAt: payload.dispatched_at,
      receivedAt: now,
      latencyMs: verification.latencyMs,
      isStale: verification.isStale,
      status: 'RECEIVED',
      amount: payload.amount ?? null,
      senderName: payload.sender_name ?? null,
      paymentReference: payload.payment_reference ?? null,
    };

    const savedRecord =
      await this.dependencies.notificationRepository.saveReceivedNotification(
        notificationRecord,
      );

    // 7. Retornar HTTP 202 (Accepted) para procesamiento asíncrono
    return {
      statusCode: 202,
      body: {
        success: true,
        message: 'Notificación aceptada para procesamiento y auditoría',
        data: { id: savedRecord.id },
      },
    };
  }
}
