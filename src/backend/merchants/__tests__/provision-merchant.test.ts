import { describe, expect, it, vi } from 'vitest';
import {
  provisionMerchantForAuthenticatedUser,
  type IMerchantProvisionRepo,
} from '../provision.js';
import type { OwnedMerchantRecord } from '../../supabase/repository.js';

function createAuthFetchOk(userId = '44737b1c-254d-4814-9f24-34bcd9340768') {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: userId, email: 'yeisonm@unicauca.edu.co' }),
  })) as unknown as typeof fetch;
}

function createAuthFetchFail() {
  return vi.fn(async () => ({
    ok: false,
    json: async () => ({ error: 'invalid_token' }),
  })) as unknown as typeof fetch;
}

function makeMerchant(
  overrides: Partial<OwnedMerchantRecord> = {},
): OwnedMerchantRecord {
  return {
    id: 'b1111111-1111-1111-1111-111111111111',
    owner_id: '44737b1c-254d-4814-9f24-34bcd9340768',
    name: 'Mursat',
    status: 'ACTIVE',
    subscription_expires_at: null,
    created_at: '2026-11-12T04:00:00.000Z',
    ...overrides,
  };
}

function createMockRepo(
  overrides: Partial<IMerchantProvisionRepo> = {},
): IMerchantProvisionRepo {
  return {
    getMerchantsByOwner: vi.fn(async () => []),
    createMerchantForOwner: vi.fn(async () => ({
      data: makeMerchant(),
      status: 201,
    })),
    ...overrides,
  };
}

describe('Merchant Provisioning Handler (Onboarding Multi-Comercio)', () => {
  const baseAuthConfig = {
    supabaseUrl: 'https://example.supabase.co',
    supabaseKey: 'anon-key',
  };

  it('rechaza con 401 cuando falta el token Bearer', async () => {
    const res = await provisionMerchantForAuthenticatedUser(
      {
        authConfig: { ...baseAuthConfig, fetchImpl: createAuthFetchOk() },
        createUserRepo: () => createMockRepo(),
        serviceRepo: createMockRepo(),
      },
      { headers: {}, storeName: 'Mursat' },
    );

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rechaza con 401 cuando el JWT de Supabase Auth es inválido', async () => {
    const res = await provisionMerchantForAuthenticatedUser(
      {
        authConfig: { ...baseAuthConfig, fetchImpl: createAuthFetchFail() },
        createUserRepo: () => createMockRepo(),
        serviceRepo: createMockRepo(),
      },
      {
        headers: { authorization: 'Bearer forged-jwt' },
        storeName: 'Mursat',
      },
    );

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rechaza con 400 cuando el nombre comercial es vacío o muy corto', async () => {
    const res = await provisionMerchantForAuthenticatedUser(
      {
        authConfig: { ...baseAuthConfig, fetchImpl: createAuthFetchOk() },
        createUserRepo: () => createMockRepo(),
        serviceRepo: createMockRepo(),
      },
      {
        headers: { authorization: 'Bearer valid-jwt' },
        storeName: ' ',
      },
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('devuelve el comercio existente idempotente (200) sin crear duplicados', async () => {
    const existing = makeMerchant({ name: 'Mursat' });
    const createSpy = vi.fn(async () => ({ data: existing, status: 201 }));
    const userRepo = createMockRepo({
      getMerchantsByOwner: vi.fn(async () => [existing]),
      createMerchantForOwner: createSpy,
    });

    const res = await provisionMerchantForAuthenticatedUser(
      {
        authConfig: { ...baseAuthConfig, fetchImpl: createAuthFetchOk() },
        createUserRepo: () => userRepo,
        serviceRepo: createMockRepo(),
      },
      {
        headers: { authorization: 'Bearer valid-jwt' },
        storeName: 'Mursat',
      },
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      alreadyExisted: true,
      data: existing,
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('hace fallback al repositorio de servicio cuando RLS aún bloquea INSERT directo del usuario autenticado', async () => {
    const created = makeMerchant({ name: 'Mursat' });
    const userRepo = createMockRepo({
      createMerchantForOwner: vi.fn(async () => ({
        data: null,
        status: 403,
        errorMessage:
          'new row violates row-level security policy for table "merchants"',
      })),
    });
    const serviceRepo = createMockRepo({
      createMerchantForOwner: vi.fn(async (ownerId, name) => ({
        data: makeMerchant({ owner_id: ownerId, name }),
        status: 201,
      })),
    });

    const res = await provisionMerchantForAuthenticatedUser(
      {
        authConfig: { ...baseAuthConfig, fetchImpl: createAuthFetchOk() },
        createUserRepo: () => userRepo,
        serviceRepo,
      },
      {
        headers: { authorization: 'Bearer valid-jwt' },
        storeName: 'Mursat',
      },
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      success: true,
      alreadyExisted: false,
      data: created,
    });
    expect(serviceRepo.createMerchantForOwner).toHaveBeenCalledWith(
      '44737b1c-254d-4814-9f24-34bcd9340768',
      'Mursat',
    );
  });

  it('reporta 403 con detalle claro si tanto el usuario como el respaldo de servicio quedan bloqueados por RLS', async () => {
    const rlsBlocked = vi.fn(async () => ({
      data: null,
      status: 403,
      errorMessage:
        'new row violates row-level security policy for table "merchants"',
    }));

    const res = await provisionMerchantForAuthenticatedUser(
      {
        authConfig: { ...baseAuthConfig, fetchImpl: createAuthFetchOk() },
        createUserRepo: () =>
          createMockRepo({ createMerchantForOwner: rlsBlocked }),
        serviceRepo: createMockRepo({ createMerchantForOwner: rlsBlocked }),
      },
      {
        headers: { authorization: 'Bearer valid-jwt' },
        storeName: 'Mursat',
      },
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    if (!res.body.success) {
      expect(res.body.error).toBe('MERCHANT_PROVISION_RLS_BLOCKED');
      expect(res.body.message).toContain('row-level security');
    }
  });
});

