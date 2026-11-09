import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceHeartbeatHandler } from '../handler.js';
import { buildCanonicalString, computeHmacSignature } from '../../../protocol/signer.js';
describe('DeviceHeartbeatHandler (Ticket 07 / ADR-0003)', () => {
    const mockSecret = 'heartbeat-secret-key-123';
    const mockDeviceId = 'centinela-device-bog-02';
    const fixedNow = 1700000000000;
    const validNonce = 'heartbeat-nonce-001';
    let mockDeviceRepo;
    let mockHealthRepo;
    let mockNonceCache;
    let handler;
    const validPayload = {
        device_id: mockDeviceId,
        battery_level: 85,
        is_charging: true,
        network_type: 'WIFI',
        app_version: '1.0.0',
        sent_at: fixedNow,
    };
    function createSignedRequest(payload, secret = mockSecret, timestamp = fixedNow, nonce = validNonce, path = '/api/v1/devices/heartbeat') {
        const canonical = buildCanonicalString({
            method: 'POST',
            path,
            timestamp,
            nonce,
            body: payload,
        });
        const signature = computeHmacSignature(secret, canonical);
        return {
            method: 'POST',
            path,
            headers: {
                'x-device-id': payload.device_id,
                'x-timestamp': timestamp.toString(),
                'x-nonce': nonce,
                'x-signature': signature,
            },
            body: payload,
        };
    }
    beforeEach(() => {
        mockDeviceRepo = {
            getDeviceSecret: vi.fn().mockResolvedValue(mockSecret),
        };
        mockHealthRepo = {
            upsertDeviceHeartbeat: vi.fn().mockResolvedValue(undefined),
            getDeviceHealth: vi.fn().mockResolvedValue(null),
            findOfflineDevices: vi.fn().mockResolvedValue([]),
        };
        mockNonceCache = {
            acquireNonce: vi.fn().mockResolvedValue(true),
        };
        handler = new DeviceHeartbeatHandler({
            deviceRepository: mockDeviceRepo,
            deviceHealthRepository: mockHealthRepo,
            nonceCache: mockNonceCache,
            nowProvider: () => fixedNow,
        });
    });
    it('debe rechazar con HTTP 401 si la firma HMAC del Heartbeat es invalida', async () => {
        const req = createSignedRequest(validPayload, 'invalid-attacker-key');
        const res = await handler.handle(req);
        expect(res.statusCode).toBe(401);
        expect(res.body.success).toBe(false);
        expect(mockHealthRepo.upsertDeviceHeartbeat).not.toHaveBeenCalled();
    });
    it('debe registrar exitosamente el Heartbeat y actualizar el estado a ONLINE (HTTP 200)', async () => {
        const req = createSignedRequest(validPayload);
        const res = await handler.handle(req);
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toContain('Heartbeat recibido');
        expect(mockHealthRepo.upsertDeviceHeartbeat).toHaveBeenCalledWith({
            deviceId: mockDeviceId,
            lastSeenAt: fixedNow,
            batteryLevel: 85,
            isCharging: true,
            networkType: 'WIFI',
            appVersion: '1.0.0',
            status: 'ONLINE',
        });
    });
    it('debe detectar dispositivos caídos con inactividad mayor a 10 minutos (ADR-0003)', async () => {
        const offlineRecord = {
            deviceId: 'centinela-offline-01',
            lastSeenAt: fixedNow - 700000, // Hace 11.6 minutos (> 10 min)
            batteryLevel: 15,
            isCharging: false,
            networkType: 'WIFI',
            appVersion: '1.0.0',
            status: 'ONLINE',
        };
        vi.mocked(mockHealthRepo.findOfflineDevices).mockResolvedValue([offlineRecord]);
        const offlineDeviceIds = await handler.checkOfflineDevices(600000); // 10 minutos = 600.000 ms
        expect(offlineDeviceIds).toContain('centinela-offline-01');
        expect(mockHealthRepo.findOfflineDevices).toHaveBeenCalledWith(600000, fixedNow);
    });
});
