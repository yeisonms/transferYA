import { beforeEach, describe, expect, it } from 'vitest';
import { DeviceEnrollmentHandler, InMemoryEnrollmentRepository, } from '../handler.js';
describe('Módulo de Enrolamiento Zero-Trust y Gestión de Dispositivos Centinela (Ticket 13)', () => {
    let repository;
    let handler;
    const now = 1715000000000;
    beforeEach(() => {
        repository = new InMemoryEnrollmentRepository();
        handler = new DeviceEnrollmentHandler({
            enrollmentRepository: repository,
            nowProvider: () => now,
            tokenTtlSeconds: 300, // 5 minutos
        });
    });
    describe('1. Generación de Token de Enrolamiento y QR (createEnrollmentToken)', () => {
        it('debe generar exitosamente un token efímero con TTL de 5 minutos y payload QR', async () => {
            const req = {
                headers: {},
                body: {
                    merchantId: 'merchant_minimarket_el_sol',
                    deviceId: 'dev_centinela_caja_1',
                    label: 'Caja Principal Mostrador',
                },
            };
            const res = await handler.createEnrollmentToken(req);
            expect(res.statusCode).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            const data = res.body.data;
            expect(data.deviceId).toBe('dev_centinela_caja_1');
            expect(data.token).toMatch(/^[a-f0-9]{64}$/); // 32 bytes hex
            expect(data.expiresAt).toBe(now + 300000); // exactly 5 min TTL
            expect(data.qrPayload).toBe(`transferya://enroll?token=${data.token}&deviceId=dev_centinela_caja_1`);
            // Verificar persistencia en repositorio
            const stored = await repository.getEnrollmentToken(data.token);
            expect(stored).toBeDefined();
            expect(stored?.merchantId).toBe('merchant_minimarket_el_sol');
            expect(stored?.isConsumed).toBe(false);
        });
        it('debe rechazar con 400 Bad Request si falta merchantId o deviceId', async () => {
            const resWithoutDevice = await handler.createEnrollmentToken({
                headers: {},
                body: { merchantId: 'merchant_1' },
            });
            expect(resWithoutDevice.statusCode).toBe(400);
            expect(resWithoutDevice.body.error).toBe('MISSING_FIELDS');
            const resWithoutMerchant = await handler.createEnrollmentToken({
                headers: {},
                body: { deviceId: 'dev_1' },
            });
            expect(resWithoutMerchant.statusCode).toBe(400);
            expect(resWithoutMerchant.body.error).toBe('MISSING_FIELDS');
        });
    });
    describe('2. Handshake de Enrolamiento Zero-Trust (enrollDevice)', () => {
        let validToken;
        beforeEach(async () => {
            const createRes = await handler.createEnrollmentToken({
                headers: {},
                body: {
                    merchantId: 'merchant_minimarket_el_sol',
                    deviceId: 'dev_centinela_caja_1',
                },
            });
            validToken = createRes.body.data.token;
        });
        it('debe completar el enrolamiento exitosamente, generar el deviceSecret y marcar el token como consumido', async () => {
            const enrollReq = {
                headers: {},
                body: {
                    token: validToken,
                    deviceId: 'dev_centinela_caja_1',
                },
            };
            const res = await handler.enrollDevice(enrollReq);
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            const data = res.body.data;
            expect(data.deviceId).toBe('dev_centinela_caja_1');
            expect(data.merchantId).toBe('merchant_minimarket_el_sol');
            expect(data.deviceSecret).toMatch(/^[a-f0-9]{64}$/); // 32 bytes hex secret
            // Verificar que el dispositivo quedó activo en la BD
            const status = await repository.getDeviceStatus('dev_centinela_caja_1');
            expect(status).toBe('ACTIVE');
            // Verificar que el token quedó consumido
            const storedToken = await repository.getEnrollmentToken(validToken);
            expect(storedToken?.isConsumed).toBe(true);
        });
        it('debe rechazar con 400 Bad Request si el token ya fue consumido (prevención de Replay)', async () => {
            const enrollReq = {
                headers: {},
                body: {
                    token: validToken,
                    deviceId: 'dev_centinela_caja_1',
                },
            };
            // Primer consumo exitoso
            await handler.enrollDevice(enrollReq);
            // Segundo intento con el mismo token
            const replayRes = await handler.enrollDevice(enrollReq);
            expect(replayRes.statusCode).toBe(400);
            expect(replayRes.body.error).toBe('TOKEN_INVALID_OR_CONSUMED');
            expect(replayRes.body.message).toMatch(/token de enrolamiento invalido o ya utilizado/i);
        });
        it('debe rechazar con 400 Bad Request si el token ha expirado (> 5 minutos)', async () => {
            const expiredHandler = new DeviceEnrollmentHandler({
                enrollmentRepository: repository,
                nowProvider: () => now + 301000, // 301 segundos después (1 segundo tras expirar)
                tokenTtlSeconds: 300,
            });
            const enrollReq = {
                headers: {},
                body: {
                    token: validToken,
                    deviceId: 'dev_centinela_caja_1',
                },
            };
            const res = await expiredHandler.enrollDevice(enrollReq);
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toBe('TOKEN_EXPIRED');
            expect(res.body.message).toMatch(/token de enrolamiento ha expirado/i);
        });
        it('debe rechazar con 400 Bad Request si el deviceId no coincide con el asignado al token', async () => {
            const enrollReq = {
                headers: {},
                body: {
                    token: validToken,
                    deviceId: 'dev_centinela_caja_HACKER',
                },
            };
            const res = await handler.enrollDevice(enrollReq);
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toBe('DEVICE_ID_MISMATCH');
            expect(res.body.message).toMatch(/dispositivo no coincide con el token/i);
        });
    });
    describe('3. Revocación Inmediata de Dispositivos (revokeDevice)', () => {
        beforeEach(async () => {
            // Registrar un dispositivo activo
            await repository.registerDeviceSecret('dev_centinela_caja_1', 'merchant_minimarket_el_sol', 'hash_previo_123', 'Caja 1');
        });
        it('debe revocar exitosamente un dispositivo Centinela y cambiar su estado a REVOKED', async () => {
            const revokeReq = {
                headers: {},
                body: {
                    merchantId: 'merchant_minimarket_el_sol',
                    deviceId: 'dev_centinela_caja_1',
                },
            };
            const res = await handler.revokeDevice(revokeReq);
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toMatch(/dispositivo centinela revocado exitosamente/i);
            const status = await repository.getDeviceStatus('dev_centinela_caja_1');
            expect(status).toBe('REVOKED');
        });
        it('debe retornar 404 Not Found si se intenta revocar un dispositivo inexistente', async () => {
            const revokeReq = {
                headers: {},
                body: {
                    merchantId: 'merchant_minimarket_el_sol',
                    deviceId: 'dev_inexistente',
                },
            };
            const res = await handler.revokeDevice(revokeReq);
            expect(res.statusCode).toBe(404);
            expect(res.body.error).toBe('DEVICE_NOT_FOUND');
        });
    });
});
