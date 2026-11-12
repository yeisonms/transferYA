import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceHeartbeatHandler, DEFAULT_NEQUI_BILLING_QR_PAYLOAD, DEFAULT_PLAN_PRO_AMOUNT_COP } from '../handler.js';
import type { IDeviceHealthRepository, HeartbeatPayload, DeviceHealthRecord } from '../types.js';
import type { IDeviceRepository, INonceCache, HttpRequest } from '../../webhook/types.js';
import type { IMerchantRoutingRepository } from '../../../domain/routing/types.js';
import { buildCanonicalString, computeHmacSignature } from '../../../protocol/signer.js';

describe('DeviceHeartbeatHandler (Ticket 07 / ADR-0003)', () => {
  const mockSecret = 'heartbeat-secret-key-123';
  const mockDeviceId = 'centinela-device-bog-02';
  const fixedNow = 1700000000000;
  const validNonce = 'heartbeat-nonce-001';

  let mockDeviceRepo: IDeviceRepository;
  let mockHealthRepo: IDeviceHealthRepository;
  let mockNonceCache: INonceCache;
  let handler: DeviceHeartbeatHandler;

  const validPayload: HeartbeatPayload = {
    device_id: mockDeviceId,
    battery_level: 85,
    is_charging: true,
    network_type: 'WIFI',
    app_version: '1.0.0',
    sent_at: fixedNow,
  };

  function createSignedRequest(
    payload: HeartbeatPayload,
    secret: string = mockSecret,
    timestamp: number = fixedNow,
    nonce: string = validNonce,
    path: string = '/api/v1/devices/heartbeat',
  ): HttpRequest {
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
    const offlineRecord: DeviceHealthRecord = {
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

  it('debe retornar estado comercial y payload de cobro QR Nequi en HTTP 200 (Ticket 21)', async () => {
    const mockMerchantRepo: IMerchantRoutingRepository = {
      getMerchantByDeviceId: vi.fn().mockResolvedValue({
        id: 'merchant-alpha',
        name: 'Tienda Alpha',
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        subscriptionEndsAt: fixedNow + 10 * 86_400_000, // 10 días restantes
        createdAt: fixedNow - 100_000,
      }),
      getCashierRecipients: vi.fn().mockResolvedValue([]),
    };

    const commercialHandler = new DeviceHeartbeatHandler({
      deviceRepository: mockDeviceRepo,
      deviceHealthRepository: mockHealthRepo,
      merchantRoutingRepository: mockMerchantRepo,
      nonceCache: mockNonceCache,
      nowProvider: () => fixedNow,
    });

    const req = createSignedRequest(validPayload);
    const res = await commercialHandler.handle(req);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.subscription_status).toBe('ACTIVE');
    expect(res.body.remaining_days).toBe(10);
    expect(res.body.billing_amount_cop).toBe(DEFAULT_PLAN_PRO_AMOUNT_COP);
    expect(res.body.billing_qr_payload).toBe(DEFAULT_NEQUI_BILLING_QR_PAYLOAD);
  });

  it('debe retornar PAST_DUE cuando la fecha de corte vencio (Ticket 21)', async () => {
    const mockMerchantRepo: IMerchantRoutingRepository = {
      getMerchantByDeviceId: vi.fn().mockResolvedValue({
        id: 'merchant-vencido',
        name: 'Tienda Vencida',
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        subscriptionEndsAt: fixedNow - 86_400_000, // Venció ayer
        createdAt: fixedNow - 100_000,
      }),
      getCashierRecipients: vi.fn().mockResolvedValue([]),
    };

    const commercialHandler = new DeviceHeartbeatHandler({
      deviceRepository: mockDeviceRepo,
      deviceHealthRepository: mockHealthRepo,
      merchantRoutingRepository: mockMerchantRepo,
      nonceCache: mockNonceCache,
      nowProvider: () => fixedNow,
    });

    const req = createSignedRequest(validPayload);
    const res = await commercialHandler.handle(req);

    expect(res.statusCode).toBe(200);
    expect(res.body.subscription_status).toBe('PAST_DUE');
    expect(res.body.remaining_days).toBe(0);
    expect(res.body.billing_amount_cop).toBe(50000);
  });
});

