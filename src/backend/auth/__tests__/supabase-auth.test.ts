import { describe, expect, it, vi } from 'vitest';
import {
  extractBearerToken,
  requireMerchantOwner,
  verifySupabaseUserSession,
} from '../supabase-auth.js';

describe('Autenticación Supabase Auth y Aislamiento Multi-Comercio (Paso 4)', () => {
  const authConfig = {
    supabaseUrl: 'https://test-project.supabase.co',
    supabaseKey: 'anon_test_key',
  };

  it('1. extractBearerToken extrae tokens Bearer insensible a mayúsculas', () => {
    expect(extractBearerToken({ authorization: 'Bearer jwt_abc_123' })).toBe(
      'jwt_abc_123',
    );
    expect(extractBearerToken({ Authorization: 'bearer jwt_xyz_789' })).toBe(
      'jwt_xyz_789',
    );
    expect(extractBearerToken({})).toBeNull();
    expect(extractBearerToken({ authorization: 'Basic 1234' })).toBeNull();
  });

  it('2. verifySupabaseUserSession rechaza peticiones sin token Bearer con 401', async () => {
    const res = await verifySupabaseUserSession({ headers: {} }, authConfig);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.statusCode).toBe(401);
      expect(res.error).toBe('MISSING_AUTH_TOKEN');
    }
  });

  it('3. verifySupabaseUserSession rechaza tokens inválidos o expirados consultando /auth/v1/user', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
    } as any);

    const res = await verifySupabaseUserSession(
      { headers: { authorization: 'Bearer token_expirado' } },
      { ...authConfig, fetchImpl: mockFetch },
    );

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.statusCode).toBe(401);
      expect(res.error).toBe('INVALID_AUTH_TOKEN');
    }
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-project.supabase.co/auth/v1/user',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token_expirado',
        }),
      }),
    );
  });

  it('4. verifySupabaseUserSession retorna usuario autenticado cuando el JWT es válido', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'user-uuid-owner-1',
        email: 'dueno@tienda.co',
      }),
    } as any);

    const res = await verifySupabaseUserSession(
      { headers: { Authorization: 'Bearer valid_jwt_token' } },
      { ...authConfig, fetchImpl: mockFetch },
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.user.id).toBe('user-uuid-owner-1');
      expect(res.user.email).toBe('dueno@tienda.co');
      expect(res.accessToken).toBe('valid_jwt_token');
    }
  });

  it('5. requireMerchantOwner autoriza únicamente al propietario real y rechaza otro comercio con 403', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'owner-user-1',
        email: 'dueno1@tienda.co',
      }),
    } as any);

    // Intento legítimo sobre su propio comercio
    const okResult = await requireMerchantOwner(
      { headers: { authorization: 'Bearer valid_jwt' } },
      { ...authConfig, fetchImpl: mockFetch },
      async () => ({ id: 'merch_1', ownerId: 'owner-user-1' }),
      'merch_1',
    );
    expect(okResult.authorized).toBe(true);

    // Intento de acceso cruzado sobre comercio de otro dueño (debe fallar con 403 Forbidden)
    const crossTenantResult = await requireMerchantOwner(
      { headers: { authorization: 'Bearer valid_jwt' } },
      { ...authConfig, fetchImpl: mockFetch },
      async () => ({ id: 'merch_2', ownerId: 'otro-owner-999' }),
      'merch_2',
    );
    expect(crossTenantResult.authorized).toBe(false);
    if (!crossTenantResult.authorized) {
      expect(crossTenantResult.statusCode).toBe(403);
      expect(crossTenantResult.error).toBe('FORBIDDEN_MERCHANT_ACCESS');
    }
  });
});

