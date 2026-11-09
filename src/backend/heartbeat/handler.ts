import { verifyWebhookRequest } from '../../protocol/signer.js';
import type { IDeviceRepository, INonceCache, HttpRequest, HttpResponse } from '../webhook/types.js';
import type { HeartbeatPayload, IDeviceHealthRepository } from './types.js';

export interface HeartbeatHandlerDependencies {
  deviceRepository: IDeviceRepository;
  deviceHealthRepository: IDeviceHealthRepository;
  nonceCache: INonceCache;
  nowProvider?: () => number;
}

/**
 * Controlador para la ingesta de telemetría Heartbeat y monitoreo de salud del Centinela (Ticket 07 / ADR-0003).
 */
export class DeviceHeartbeatHandler {
  private nowProvider: () => number;

  constructor(private dependencies: HeartbeatHandlerDependencies) {
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
          message: 'Faltan cabeceras de autenticación en la petición de Heartbeat',
        },
      };
    }

    // 3. Obtener el secreto criptográfico del Centinela
    const deviceSecret = await this.dependencies.deviceRepository.getDeviceSecret(deviceId);
    if (!deviceSecret) {
      return {
        statusCode: 401,
        body: {
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Dispositivo no reconocido o inactivo en la plataforma',
        },
      };
    }

    // 4. Validar firma criptográfica y ventana temporal (ADR-0002)
    const verification = verifyWebhookRequest(
      req.headers,
      req.body as string | object,
      deviceSecret,
      {
        currentTimeMs: now,
        maxTimestampDriftMs: 30000,
        path: req.path ?? '/api/v1/devices/heartbeat',
        method: req.method ?? 'POST',
      },
    );

    if (!verification.success) {
      return {
        statusCode: 401,
        body: {
          success: false,
          error: verification.error,
          message: verification.details ?? 'Firma HMAC de Heartbeat inválida',
        },
      };
    }

    // 5. Deduplicación de nonces (Anti-Replay)
    const nonceAcquired = await this.dependencies.nonceCache.acquireNonce(deviceId, nonce, 60);
    if (!nonceAcquired) {
      return {
        statusCode: 409,
        body: {
          success: false,
          error: 'REPLAY_ATTACK_DETECTED',
          message: 'Nonce de Heartbeat ya utilizado',
        },
      };
    }

    // 6. Actualizar registro de salud y marcar como ONLINE
    const payload = req.body as HeartbeatPayload;
    await this.dependencies.deviceHealthRepository.upsertDeviceHeartbeat({
      deviceId,
      lastSeenAt: now,
      batteryLevel: payload.battery_level,
      isCharging: payload.is_charging,
      networkType: payload.network_type,
      appVersion: payload.app_version,
      status: 'ONLINE',
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        message: 'Heartbeat recibido y registrado exitosamente',
      },
    };
  }

  async checkOfflineDevices(inactivityThresholdMs: number = 600000): Promise<string[]> {
    const now = this.nowProvider();
    const offlineDevices = await this.dependencies.deviceHealthRepository.findOfflineDevices(
      inactivityThresholdMs,
      now,
    );
    return offlineDevices.map((d) => d.deviceId);
  }
}
