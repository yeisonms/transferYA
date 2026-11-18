import { describe, expect, it, vi } from 'vitest';
import {
  handleMerchantCloudStatusRequest,
  type MerchantCloudStatusDeps,
} from '../cloud-status.js';

describe('Merchant Cloud Status (Ruta Cloud Gmail - Fase 4)', () => {
  const merchantId = 'merchant_don_camilo_123';
  const ownerId = 'user_owner_abc';
  const inboundDomain = 'inbound.transferya.app';

  function createMockDeps(overrides: Partial<MerchantCloudStatusDeps> = {}): MerchantCloudStatusDeps {
    const mockRepo = {
      getMerchantWithOwner: vi.fn().mockImplementation(async (id: string) => {
        if (id === merchantId) {
          return { id: merchantId, owner_id: ownerId, name: 'Don Camilo Cafe' };
        }
        return null;
      }),
      getDeviceStatus: vi.fn().mockResolvedValue('NOT_FOUND'),
      registerDevice: vi.fn().mockResolvedValue({ id: `cloud_email_${merchantId}` }),
      revokeDevice: vi.fn().mockResolvedValue(true),
    };

    return {
      authConfig: {
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test_anon_key',
      },
      createUserRepo: () => mockRepo as any,
      serviceRepo: mockRepo as any,
      inboundDomain,
      getVerificationCodeProvider: vi.fn().mockReturnValue(null),
      ...overrides,
    };
  }

  it('debe rechazar con 401 si no hay token de autorización', async () => {
    const deps = createMockDeps();
    const result = await handleMerchantCloudStatusRequest(
      deps,
      {
        method: 'GET',
        headers: {},
        query: { merchantId },
      },
    );

    expect(result.statusCode).toBe(401);
    expect(result.body.success).toBe(false);
  });

  it('debe rechazar con 400 si falta el merchantId', async () => {
    const deps = createMockDeps();
    const result = await handleMerchantCloudStatusRequest(
      deps,
      {
        method: 'GET',
        headers: { authorization: 'Bearer mock_token' },
        query: {},
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.success).toBe(false);
  });

  it('debe retornar estado PENDING_CONFIG y la dirección de correo cuando el comercio aún no tiene el dispositivo creado', async () => {
    const deps = createMockDeps();
    // Simular que el token es válido inyectando verificación mock o usando mock requireMerchantOwner
    deps.requireOwnerVerifier = vi.fn().mockResolvedValue({
      authorized: true,
      statusCode: 200,
      user: { id: ownerId, email: 'doncamilo@gmail.com' },
      merchant: { id: merchantId, owner_id: ownerId, name: 'Don Camilo Cafe' },
    });

    const result = await handleMerchantCloudStatusRequest(
      deps,
      {
        method: 'GET',
        headers: { authorization: 'Bearer mock_token' },
        query: { merchantId },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.success).toBe(true);
    if (result.body.success) {
      expect(result.body.data.merchantId).toBe(merchantId);
      expect(result.body.data.inboundEmail).toBe(`pago+${merchantId}@inbound.transferya.app`);
      expect(result.body.data.isConfigured).toBe(false);
      expect(result.body.data.status).toBe('PENDING_CONFIG');
      expect(result.body.data.cloudDeviceId).toBe(`cloud_email_${merchantId}`);
      expect(result.body.data.googleVerification).toBeNull();
    }
  });

  it('debe retornar el código de verificación de Google cuando está presente en cache', async () => {
    const deps = createMockDeps({
      getVerificationCodeProvider: vi.fn().mockReturnValue({
        code: '948201583',
        url: 'https://mail.google.com/mail/vf-confirm',
        receivedAt: 1700000000000,
      }),
    });
    deps.requireOwnerVerifier = vi.fn().mockResolvedValue({
      authorized: true,
      statusCode: 200,
      user: { id: ownerId, email: 'doncamilo@gmail.com' },
      merchant: { id: merchantId, owner_id: ownerId, name: 'Don Camilo Cafe' },
    });

    const result = await handleMerchantCloudStatusRequest(
      deps,
      {
        method: 'GET',
        headers: { authorization: 'Bearer mock_token' },
        query: { merchantId },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.success).toBe(true);
    if (result.body.success) {
      expect(result.body.data.googleVerification).toEqual({
        code: '948201583',
        url: 'https://mail.google.com/mail/vf-confirm',
        receivedAt: 1700000000000,
      });
    }
  });

  it('debe retornar ACTIVE cuando el dispositivo cloud_email_<id> ya está registrado en la base de datos', async () => {
    const deps = createMockDeps();
    deps.serviceRepo.getDeviceStatus = vi.fn().mockResolvedValue('ACTIVE');
    deps.requireOwnerVerifier = vi.fn().mockResolvedValue({
      authorized: true,
      statusCode: 200,
      user: { id: ownerId, email: 'doncamilo@gmail.com' },
      merchant: { id: merchantId, owner_id: ownerId, name: 'Don Camilo Cafe' },
    });

    const result = await handleMerchantCloudStatusRequest(
      deps,
      {
        method: 'GET',
        headers: { authorization: 'Bearer mock_token' },
        query: { merchantId },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.success).toBe(true);
    if (result.body.success) {
      expect(result.body.data.isConfigured).toBe(true);
      expect(result.body.data.status).toBe('ACTIVE');
    }
  });

  it('debe permitir pausar o activar la ruta cloud con POST', async () => {
    const deps = createMockDeps();
    deps.requireOwnerVerifier = vi.fn().mockResolvedValue({
      authorized: true,
      statusCode: 200,
      user: { id: ownerId, email: 'doncamilo@gmail.com' },
      merchant: { id: merchantId, owner_id: ownerId, name: 'Don Camilo Cafe' },
    });

    const result = await handleMerchantCloudStatusRequest(
      deps,
      {
        method: 'POST',
        headers: { authorization: 'Bearer mock_token' },
        body: { merchantId, action: 'ENABLE' },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(deps.serviceRepo.registerDevice).toHaveBeenCalledWith(
      `cloud_email_${merchantId}`,
      merchantId,
      'cloud_inbound_secret',
      'Respaldo Cloud (Gmail)',
    );
  });
});
