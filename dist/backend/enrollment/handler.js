import { randomBytes } from 'node:crypto';
/**
 * Manejador HTTP desacoplado para la ceremonia de enrolamiento Zero-Trust (QR Handshake)
 * y revocación de Dispositivos Centinela.
 */
export class DeviceEnrollmentHandler {
    deps;
    nowProvider;
    tokenTtlSeconds;
    secretGenerator;
    constructor(deps) {
        this.deps = deps;
        this.nowProvider = deps.nowProvider ?? (() => Date.now());
        this.tokenTtlSeconds = deps.tokenTtlSeconds ?? 300;
        this.secretGenerator =
            deps.secretGenerator ?? (() => randomBytes(32).toString('hex'));
    }
    /**
     * Genera un nuevo token de enrolamiento efímero para proyectar en código QR (Panel Web).
     */
    async createEnrollmentToken(req) {
        const body = (req.body ?? {});
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
        const record = {
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
    async enrollDevice(req) {
        const body = (req.body ?? {});
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
        const stored = await this.deps.enrollmentRepository.getEnrollmentToken(body.token);
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
        const consumed = await this.deps.enrollmentRepository.consumeEnrollmentToken(body.token);
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
        await this.deps.enrollmentRepository.registerDeviceSecret(body.deviceId, stored.merchantId, deviceSecret, stored.label);
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
    async revokeDevice(req) {
        const body = (req.body ?? {});
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
        const revoked = await this.deps.enrollmentRepository.revokeDevice(body.deviceId, body.merchantId);
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
export class InMemoryEnrollmentRepository {
    tokens = new Map();
    devices = new Map();
    async createEnrollmentToken(record) {
        this.tokens.set(record.token, { ...record });
    }
    async getEnrollmentToken(token) {
        const existing = this.tokens.get(token);
        return existing ? { ...existing } : null;
    }
    async consumeEnrollmentToken(token) {
        const existing = this.tokens.get(token);
        if (!existing || existing.isConsumed) {
            return false;
        }
        existing.isConsumed = true;
        this.tokens.set(token, existing);
        return true;
    }
    async registerDeviceSecret(deviceId, merchantId, secretHash, label) {
        this.devices.set(deviceId, {
            merchantId,
            secretHash,
            label,
            status: 'ACTIVE',
        });
    }
    async revokeDevice(deviceId, merchantId) {
        const dev = this.devices.get(deviceId);
        if (!dev || dev.merchantId !== merchantId) {
            return false;
        }
        dev.status = 'REVOKED';
        this.devices.set(deviceId, dev);
        return true;
    }
    async getDeviceStatus(deviceId) {
        const dev = this.devices.get(deviceId);
        if (!dev) {
            return 'NOT_FOUND';
        }
        return dev.status;
    }
}
