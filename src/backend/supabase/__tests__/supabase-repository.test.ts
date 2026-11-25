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

  it('debe persistir last_heartbeat_at y updated_at al recibir heartbeat', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'dev_5f38cd_caja_1' }],
      text: async () => '',
    } as any);

    await repository.upsertDeviceHeartbeat({
      deviceId: 'dev_5f38cd_caja_1',
      lastSeenAt: 1700000000000,
      batteryLevel: 88,
      isCharging: false,
      networkType: 'WIFI',
      appVersion: '0.2.2-beta',
      status: 'ONLINE',
    });

    const callUrl = String(fetchSpy.mock.calls[0]?.[0]);
    const callInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(callInit.body as string);
    expect(callUrl).toContain('/rest/v1/devices?id=eq.dev_5f38cd_caja_1');
    expect(callInit.method).toBe('PATCH');
    expect(body.last_heartbeat_at).toBe('2023-11-14T22:13:20.000Z');
    expect(body.updated_at).toBe('2023-11-14T22:13:20.000Z');
    expect(body.status).toBe('ACTIVE');
    fetchSpy.mockRestore();
  });

  describe('IBillingInvoicesRepository (Ticket 22)', () => {
    it('debe buscar comercio por billing_phone', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 'm_123',
            owner_id: 'o_123',
            name: 'Pizzería Napoles',
            status: 'ACTIVE',
            subscription_status: 'ACTIVE',
            subscription_ends_at: '2026-12-01T00:00:00Z',
            billing_phone: '+573113654315',
            created_at: '2026-11-01T00:00:00Z',
          },
        ],
      } as any);

      const merchant = await repository.findMerchantByBillingPhone('+573113654315');
      expect(merchant).not.toBeNull();
      expect(merchant?.id).toBe('m_123');
      expect(merchant?.name).toBe('Pizzería Napoles');
      expect(merchant?.billingPhone).toBe('+573113654315');

      const url = String(fetchSpy.mock.calls[0]?.[0]);
      expect(url).toContain('/rest/v1/merchants');
      fetchSpy.mockRestore();
    });

    it('debe buscar factura por reference_code', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 'inv_abc',
            merchant_id: 'm_123',
            amount_cop: 50000,
            reference_code: 'TYA-7B8K2M',
            status: 'PENDING',
          },
        ],
      } as any);

      const invoice = await repository.findInvoiceByReference('TYA-7B8K2M');
      expect(invoice).not.toBeNull();
      expect(invoice?.reference_code).toBe('TYA-7B8K2M');
      expect(invoice?.amount_cop).toBe(50000);

      const url = String(fetchSpy.mock.calls[0]?.[0]);
      expect(url).toContain('/rest/v1/billing_invoices');
      fetchSpy.mockRestore();
    });

    it('debe crear y marcar factura pagada', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: 'inv_new',
              merchant_id: 'm_123',
              amount_cop: 50000,
              reference_code: 'TYA-AUTOREF',
              status: 'PENDING',
            },
          ],
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: 'inv_new',
              merchant_id: 'm_123',
              amount_cop: 50000,
              reference_code: 'TYA-AUTOREF',
              status: 'PAID',
              notification_id: 'notif_1',
            },
          ],
        } as any);

      const created = await repository.createInvoice({
        merchantId: 'm_123',
        amountCop: 50000,
        referenceCode: 'TYA-AUTOREF',
      });
      expect(created.id).toBe('inv_new');

      const paid = await repository.markInvoicePaid('inv_new', 'notif_1', 1700000000000);
      expect(paid.status).toBe('PAID');
      expect(paid.notification_id).toBe('notif_1');

      fetchSpy.mockRestore();
    });

    it('debe extender suscripción +30 días atómicamente', async () => {
      const nowMs = new Date('2026-11-15T00:00:00Z').getTime();
      const currentEnds = new Date('2026-11-20T00:00:00Z').toISOString();

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        // 1. getMerchantById
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: 'm_123',
              name: 'Pizzería Napoles',
              subscription_status: 'ACTIVE',
              subscription_ends_at: currentEnds,
            },
          ],
        } as any)
        // 2. updateMerchantSubscription (PATCH)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: 'm_123',
              subscription_status: 'ACTIVE',
              subscription_ends_at: '2026-12-20T00:00:00.000Z',
            },
          ],
        } as any);

      const result = await repository.extendMerchantSubscription('m_123', 30, nowMs);
      expect(result.previousEndsAt).toBe(currentEnds);
      expect(result.newEndsAt).toBe('2026-12-20T00:00:00.000Z');
      expect(result.daysRemaining).toBe(35);

      fetchSpy.mockRestore();
    });

    it('debe eliminar un dispositivo y desvincular sus recursos asociados', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        // 1. DELETE enrollment_tokens
        .mockResolvedValueOnce({ ok: true, json: async () => [] } as any)
        // 2. PATCH cashier_recipients
        .mockResolvedValueOnce({ ok: true, json: async () => [] } as any)
        // 3. DELETE payment_fingerprints
        .mockResolvedValueOnce({ ok: true, json: async () => [] } as any)
        // 4. DELETE captured_notifications
        .mockResolvedValueOnce({ ok: true, json: async () => [] } as any)
        // 5. DELETE devices
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: 'dev_caja_3', merchant_id: 'm_123' }],
        } as any);

      const deleted = await repository.deleteDevice('dev_caja_3', 'm_123');
      expect(deleted).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(5);

      fetchSpy.mockRestore();
    });

    it('debe hacer fallback multi-caja en findByMerchantFingerprint cuando merchant_id no existe aún (HTTP 400)', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        // 1. Consulta por merchant_id falla con 400 (columna aún no migrada)
        .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'column merchant_id does not exist' } as any)
        // 2. getMerchantDevices devuelve las cajas del comercio
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { id: 'dev_bc8b5b_caja_1', status: 'ACTIVE', label: 'Caja 1' },
            { id: 'dev_bc8b5b_caja_2', status: 'ACTIVE', label: 'Caja 2' },
          ],
        } as any)
        // 3. Consulta fallback por device_id=in.(...) encuentra la huella de Caja 1
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: 'fp_caja_1',
              device_id: 'dev_bc8b5b_caja_1',
              payment_fingerprint: 'abc123fp',
              wallet: 'NEQUI',
              amount: 1000,
              sender_name: 'Transferencia Bre-B',
              captured_at: 1795561863802,
            },
          ],
        } as any);

      const found = await repository.findByMerchantFingerprint('m_pruebas', 'abc123fp');
      expect(found).not.toBeNull();
      expect(found?.deviceId).toBe('dev_bc8b5b_caja_1');
      expect(found?.amount).toBe(1000);

      fetchSpy.mockRestore();
    });

    it('debe detectar duplicados entre dos cajas físicas distintas del mismo comercio e incluso con nombre Bre-B enriquecido', async () => {
      const baseTime = 1795564633822;
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        // 1. devices del comercio
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { id: 'dev_bc8b5b_caja_1' },
            { id: 'dev_bc8b5b_caja_3' },
          ],
        } as any)
        // 2. captured_notifications filtradas por device_id=in.(...) y ventana de captured_at
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: 'orig_4d50bc10',
              device_id: 'dev_bc8b5b_caja_1',
              amount: 1000,
              sender_name: 'Yeison Stiven Murcia Calvo', // Enriquecido desde Gmail!
              payment_reference: 'BREB-9C04698E',
              captured_at: baseTime,
              raw_title: 'Te enviaron plata por Bre-B',
              raw_text: 'Te enviaron $1.000. Entra a tu app y revisa tu saldo.',
              wallet_package: 'com.nequi.MobileApp',
            },
          ],
        } as any);

      const dup = await repository.findRecentDuplicatePayment({
        merchantId: 'bc8b5b58-1514-4daf-836f-3bc36a9f61b1',
        amount: 1000,
        capturedAt: baseTime,
        currentDeviceId: 'dev_bc8b5b_caja_3', // Otra caja física del mismo comercio!
        currentNotificationId: 'new_dup_id',
        senderName: 'Transferencia Bre-B', // Nombre genérico del push original!
        rawTitle: 'Te enviaron plata por Bre-B',
        rawText: 'Te enviaron $1.000. Entra a tu app y revisa tu saldo.',
      });

      expect(dup).not.toBeNull();
      expect(dup?.id).toBe('orig_4d50bc10');
      // Verificar que el query SQL filtró directamente por device_id=in.(...) y captured_at
      const secondCallUrl = String(fetchSpy.mock.calls[1][0]);
      expect(secondCallUrl).toContain('device_id=in.');
      expect(secondCallUrl).toContain('captured_at=gte.');

      fetchSpy.mockRestore();
    });
  });
});

