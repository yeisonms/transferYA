import { describe, expect, it, vi } from 'vitest';
import { SupabaseRepository } from '../repository.js';

describe('SupabaseRepository REST Adapter', () => {
  const repository = new SupabaseRepository({
    supabaseUrl: 'https://test-project.supabase.co',
    serviceKey: 'test_service_key',
  });

  it('debe registrar un nuevo enrollment token correctamente', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{}],
      text: async () => '',
    } as any);

    await repository.createEnrollmentToken({
      token: 'tok_123',
      merchantId: 'merch_1',
      deviceId: 'dev_1',
      expiresAt: 123456789,
      isConsumed: false,
      createdAt: 123450000,
    });

    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('debe consultar y parsear un enrollment token existente', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          token: 'tok_abc',
          merchant_id: 'merch_42',
          device_id: 'dev_caja_1',
          expires_at: '1700000000000',
          is_consumed: false,
          created_at: '1699999000000',
        },
      ],
    } as any);

    const token = await repository.getEnrollmentToken('tok_abc');
    expect(token).not.toBeNull();
    expect(token?.token).toBe('tok_abc');
    expect(token?.merchantId).toBe('merch_42');
    expect(token?.deviceId).toBe('dev_caja_1');

    fetchSpy.mockRestore();
  });

  it('debe adquirir nonces y prevenir ataques de repetición en memoria', async () => {
    const firstAcquire = await repository.acquireNonce('dev_1', 'nonce_1', 60);
    expect(firstAcquire).toBe(true);

    const replayAcquire = await repository.acquireNonce('dev_1', 'nonce_1', 60);
    expect(replayAcquire).toBe(false);

    const differentNonce = await repository.acquireNonce('dev_1', 'nonce_2', 60);
    expect(differentNonce).toBe(true);
  });

  it('debe omitir failure_reason en updateNotification para evitar rechazo 400 de PostgREST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [{}],
      text: async () => '',
    } as any);

    await repository.updateNotification('notif_1', {
      status: 'IGNORED_NON_PAYMENT',
      failureReason: 'Promoción',
    });

    const callOptions = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const sentBody = JSON.parse(callOptions.body as string);
    expect(sentBody.status).toBe('IGNORED_NON_PAYMENT');
    expect(sentBody.failure_reason).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it('debe formatear huellas y notificaciones de un dispositivo en resetDeviceTestData', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'fp1' }],
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'n1' }, { id: 'n2' }],
        text: async () => '',
      } as any);

    const result = await repository.resetDeviceTestData('dev_centinela_caja_1');
    expect(result.deletedFingerprints).toBe(1);
    expect(result.deletedNotifications).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });
});

