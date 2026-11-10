import { createHash, randomBytes } from 'node:crypto';
import type { HttpRequest, HttpResponse } from '../webhook/types.js';
import type {
  DeviceEnrollmentHandlerDependencies,
  EnrollmentTokenRecord,
  IEnrollmentRepository,
} from './types.js';

/**
 * Manejador HTTP desacoplado para la ceremonia de enrolamiento Zero-Trust (QR Handshake)
 * y revocación de Dispositivos Centinela.
 */
export class DeviceEnrollmentHandler {
  private readonly nowProvider: () => number;
  private readonly tokenTtlSeconds: number;
  private readonly secretGenerator: () => string;

  constructor(private readonly deps: DeviceEnrollmentHandlerDependencies) {
    this.nowProvider = deps.nowProvider ?? (() => Date.now());
    this.tokenTtlSeconds = deps.tokenTtlSeconds ?? 300;
    this.secretGenerator =
      deps.secretGenerator ?? (() => randomBytes(32).toString('hex'));
  }

  /**
   * Genera un nuevo token de enrolamiento efímero para proyectar en código QR (Panel Web).
   */
  async createEnrollmentToken(req: HttpRequest): Promise<HttpResponse> {
    const body = (req.body ?? {}) as {
      merchantId?: string;
      deviceId?: string;
      label?: string;
      ttlSeconds?: number;
    };

    if (!body.merchantId || !body.deviceId) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: 'MISSING_FIELDS',
          message: 'merchantId y deviceId son obligatorios',
        },
      };
    }

    const now = this.nowProvider();
    const token = randomBytes(32).toString('hex');
    const ttlSeconds = body.ttlSeconds ?? this.tokenTtlSeconds;
    const expiresAt = now + ttlSeconds * 1000;

    const record: EnrollmentTokenRecord = {
      token,
      merchantId: body.merchantId,
      deviceId: body.deviceId,
      label: body.label,
      expiresAt,
      isConsumed: false,
      createdAt: now,
    };

    await this.deps.enrollmentRepository.createEnrollmentToken(record);

    return {
      statusCode: 201,
      body: {
        success: true,
        data: {
          token,
          deviceId: body.deviceId,
          expiresAt,
          qrPayload: `transferya://enroll?token=${token}&deviceId=${body.deviceId}`,
        },
      },
    };
  }

  /**
   * Endpoint de intercambio Zero-Trust consumido por el APK de Android para recibir el Device Secret.
   */
  async enrollDevice(req: HttpRequest): Promise<HttpResponse> {
    const body = (req.body ?? {}) as {
      token?: string;
      deviceId?: string;
    };

    if (!body.token || !body.deviceId) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: 'MISSING_FIELDS',
          message: 'token y deviceId son obligatorios',
        },
      };
    }

    const stored =
      await this.deps.enrollmentRepository.getEnrollmentToken(body.token);

    if (!stored || stored.isConsumed) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: 'TOKEN_INVALID_OR_CONSUMED',
          message: 'Token de enrolamiento invalido o ya utilizado',
        },
      };
    }

    if (stored.deviceId !== body.deviceId) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: 'DEVICE_ID_MISMATCH',
          message: 'El dispositivo no coincide con el token de enrolamiento',
        },
      };
    }

    const now = this.nowProvider();
    if (stored.expiresAt < now) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: 'TOKEN_EXPIRED',
          message: 'El token de enrolamiento ha expirado',
        },
      };
    }

    const consumed =
      await this.deps.enrollmentRepository.consumeEnrollmentToken(body.token);

    if (!consumed) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: 'TOKEN_INVALID_OR_CONSUMED',
          message: 'Token de enrolamiento invalido o ya utilizado',
        },
      };
    }

    const deviceSecret = this.secretGenerator();

    await this.deps.enrollmentRepository.registerDeviceSecret(
      body.deviceId,
      stored.merchantId,
      deviceSecret,
      stored.label,
    );

    return {
      statusCode: 200,
      body: {
        success: true,
        data: {
          deviceId: body.deviceId,
          deviceSecret,
          merchantId: stored.merchantId,
        },
      },
    };
  }

  /**
   * Revoca de forma inmediata el secreto de un Dispositivo Centinela.
   */
  async revokeDevice(req: HttpRequest): Promise<HttpResponse> {
    const body = (req.body ?? {}) as {
      merchantId?: string;
      deviceId?: string;
    };

    if (!body.merchantId || !body.deviceId) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: 'MISSING_FIELDS',
          message: 'merchantId y deviceId son obligatorios',
        },
      };
    }

    const revoked = await this.deps.enrollmentRepository.revokeDevice(
      body.deviceId,
      body.merchantId,
    );

    if (!revoked) {
      return {
        statusCode: 404,
        body: {
          success: false,
          error: 'DEVICE_NOT_FOUND',
          message: 'Dispositivo no encontrado para este comercio',
        },
      };
    }

    return {
      statusCode: 200,
      body: {
        success: true,
        message: 'Dispositivo Centinela revocado exitosamente',
      },
    };
  }
}

/**
 * Implementación en memoria del repositorio de enrolamiento para tests unitarios.
 */
export class InMemoryEnrollmentRepository implements IEnrollmentRepository {
  private tokens = new Map<string, EnrollmentTokenRecord>();
  private devices = new Map<
    string,
    {
      merchantId: string;
      secretHash: string;
      label?: string;
      status: 'ACTIVE' | 'REVOKED';
    }
  >();

  async createEnrollmentToken(record: EnrollmentTokenRecord): Promise<void> {
    this.tokens.set(record.token, { ...record });
  }

  async getEnrollmentToken(
    token: string,
  ): Promise<EnrollmentTokenRecord | null> {
    const existing = this.tokens.get(token);
    return existing ? { ...existing } : null;
  }

  async consumeEnrollmentToken(token: string): Promise<boolean> {
    const existing = this.tokens.get(token);
    if (!existing || existing.isConsumed) {
      return false;
    }
    existing.isConsumed = true;
    this.tokens.set(token, existing);
    return true;
  }

  async registerDeviceSecret(
    deviceId: string,
    merchantId: string,
    secretHash: string,
    label?: string,
  ): Promise<void> {
    this.devices.set(deviceId, {
      merchantId,
      secretHash,
      label,
      status: 'ACTIVE',
    });
  }

  async revokeDevice(deviceId: string, merchantId: string): Promise<boolean> {
    const dev = this.devices.get(deviceId);
    if (!dev || dev.merchantId !== merchantId) {
      return false;
    }
    dev.status = 'REVOKED';
    this.devices.set(deviceId, dev);
    return true;
  }

  async getDeviceStatus(
    deviceId: string,
  ): Promise<'ACTIVE' | 'REVOKED' | 'NOT_FOUND'> {
    const dev = this.devices.get(deviceId);
    if (!dev) {
      return 'NOT_FOUND';
    }
    return dev.status;
  }
}
