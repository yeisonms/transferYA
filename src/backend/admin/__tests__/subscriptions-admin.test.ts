import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  isSuperAdminUser,
  requireSuperAdminSession,
  DEFAULT_SUPER_ADMIN_IDS,
  DEFAULT_SUPER_ADMIN_EMAILS,
} from '../auth.js';
import {
  applySubscriptionAction,
  listAdminMerchants,
} from '../subscriptions.js';
import type {
  AdminDeviceRow,
  AdminMerchantRow,
  IAdminSubscriptionsRepository,
} from '../types.js';

class InMemoryAdminRepository implements IAdminSubscriptionsRepository {
  public merchants: AdminMerchantRow[] = [];
  public devices: AdminDeviceRow[] = [];

  async getAllMerchants(): Promise<AdminMerchantRow[]> {
    return [...this.merchants];
  }

  async getAllDevices(): Promise<AdminDeviceRow[]> {
    return [...this.devices];
  }

  async getMerchantById(merchantId: string): Promise<AdminMerchantRow | null> {
    const found = this.merchants.find((m) => m.id === merchantId);
    return found ? { ...found } : null;
  }

  async updateMerchantSubscription(
    merchantId: string,
    updates: Parameters<IAdminSubscriptionsRepository['updateMerchantSubscription']>[1],
  ): Promise<AdminMerchantRow | null> {
    const idx = this.merchants.findIndex((m) => m.id === merchantId);
    if (idx === -1) return null;

    const current = this.merchants[idx];
    const updated: AdminMerchantRow = {
      ...current,
      ...updates,
      updated_at: updates.updated_at ?? new Date().toISOString(),
    };
    this.merchants[idx] = updated;
    return { ...updated };
  }
}

describe('Ticket 20 — Super-Admin Authentication & Authorization', () => {
  it('reconoce el ID por defecto de Mursat Solutions como Super-Admin', () => {
    const user = {
      id: DEFAULT_SUPER_ADMIN_IDS[0],
      email: 'otro@correo.com',
    };
    expect(isSuperAdminUser(user)).toBe(true);
  });

  it('reconoce el Email por defecto de Mursat Solutions como Super-Admin', () => {
    const user = {
      id: 'un-id-cualquiera',
      email: DEFAULT_SUPER_ADMIN_EMAILS[0],
    };
    expect(isSuperAdminUser(user)).toBe(true);
  });

  it('soporta IDs y Emails adicionales configurados por entorno', () => {
    const user1 = { id: 'custom-admin-id', email: 'test@example.com' };
    const user2 = { id: 'other-id', email: 'admin2@mursat.com' };
    const regular = { id: 'regular-user', email: 'cajero@tienda.com' };

    const config = {
      adminOwnerIds: 'custom-admin-id,otro-id',
      adminEmails: 'admin2@mursat.com',
    };

    expect(isSuperAdminUser(user1, config)).toBe(true);
    expect(isSuperAdminUser(user2, config)).toBe(true);
    expect(isSuperAdminUser(regular, config)).toBe(false);
  });

  it('rechaza con 401 si no hay token de autenticación', async () => {
    const result = await requireSuperAdminSession(
      { headers: {} },
      { supabaseUrl: 'https://test.supabase.co', supabaseKey: 'anon-key' },
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe('MISSING_AUTH_TOKEN');
    }
  });

  it('rechaza con 403 si el usuario autenticado NO es Super-Admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'regular-merchant-user-123',
        email: 'tiendita@gmail.com',
      }),
    });

    const result = await requireSuperAdminSession(
      { headers: { authorization: 'Bearer valid-user-token' } },
      {
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'anon-key',
        fetchImpl: fetchMock as any,
      },
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.statusCode).toBe(403);
      expect(result.error).toBe('FORBIDDEN_SUPER_ADMIN_REQUIRED');
    }
  });

  it('autoriza exitosamente si el usuario es Super-Admin Mursat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: DEFAULT_SUPER_ADMIN_IDS[0],
        email: DEFAULT_SUPER_ADMIN_EMAILS[0],
      }),
    });

    const result = await requireSuperAdminSession(
      { headers: { authorization: 'Bearer super-admin-token' } },
      {
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'anon-key',
        fetchImpl: fetchMock as any,
      },
    );

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.user.id).toBe(DEFAULT_SUPER_ADMIN_IDS[0]);
    }
  });
});

describe('Ticket 20 — Admin Subscriptions Service Logic', () => {
  const baseTime = 1_700_000_000_000; // Instante base fijado para pruebas

  it('lista comercios calculando estado efectivo, días restantes y telemetría de cajas', async () => {
    const repo = new InMemoryAdminRepository();
    repo.merchants = [
      {
        id: 'm1',
        name: 'Comercio Trial Activo',
        owner_id: 'o1',
        status: 'ACTIVE',
        subscription_status: 'TRIAL',
        subscription_ends_at: new Date(baseTime + 3 * 86_400_000).toISOString(),
        billing_phone: '+573001112233',
        created_at: new Date(baseTime - 10_000).toISOString(),
      },
      {
        id: 'm2',
        name: 'Comercio Vencido (Past Due)',
        owner_id: 'o2',
        status: 'ACTIVE',
        subscription_status: 'ACTIVE',
        subscription_ends_at: new Date(baseTime - 86_400_000).toISOString(), // Venció ayer
        billing_phone: '+573119998877',
        created_at: new Date(baseTime - 20_000).toISOString(),
      },
    ];

    repo.devices = [
      {
        id: 'dev_m1_caja1',
        merchant_id: 'm1',
        status: 'ACTIVE',
        last_heartbeat_at: new Date(baseTime - 60_000).toISOString(), // 1 min (ONLINE)
      },
      {
        id: 'dev_m1_caja2',
        merchant_id: 'm1',
        status: 'ACTIVE',
        last_heartbeat_at: new Date(baseTime - 600_000).toISOString(), // 10 min (OFFLINE)
      },
      {
        id: 'dev_m2_caja1',
        merchant_id: 'm2',
        status: 'ACTIVE',
        last_heartbeat_at: null,
      },
    ];

    const list = await listAdminMerchants(repo, baseTime);

    expect(list).toHaveLength(2);
    // m1
    const m1 = list.find((m) => m.id === 'm1')!;
    expect(m1.effectiveSubscriptionStatus).toBe('TRIAL');
    expect(m1.remainingDays).toBe(3);
    expect(m1.totalDevices).toBe(2);
    expect(m1.onlineDevices).toBe(1);

    // m2
    const m2 = list.find((m) => m.id === 'm2')!;
    expect(m2.effectiveSubscriptionStatus).toBe('PAST_DUE');
    expect(m2.remainingDays).toBe(0);
    expect(m2.totalDevices).toBe(1);
    expect(m2.onlineDevices).toBe(0);
  });

  it('ejecuta ACTIVATE_TRIAL fijando 7 días y estado TRIAL', async () => {
    const repo = new InMemoryAdminRepository();
    repo.merchants = [
      {
        id: 'm1',
        name: 'Tienda Nueva',
        owner_id: 'o1',
        status: 'ACTIVE',
        created_at: new Date(baseTime).toISOString(),
      },
    ];

    const { summary, message } = await applySubscriptionAction(
      repo,
      { merchantId: 'm1', action: 'ACTIVATE_TRIAL', days: 7 },
      baseTime,
    );

    expect(summary.subscriptionStatus).toBe('TRIAL');
    expect(summary.effectiveSubscriptionStatus).toBe('TRIAL');
    expect(summary.remainingDays).toBe(7);
    expect(message).toContain('7 días');

    const updated = await repo.getMerchantById('m1');
    expect(updated?.subscription_status).toBe('TRIAL');
    expect(updated?.subscription_ends_at).toBe(
      new Date(baseTime + 7 * 86_400_000).toISOString(),
    );
  });

  it('ejecuta EXTEND_30_DAYS sobre cuenta vigente preservando los días restantes', async () => {
    const repo = new InMemoryAdminRepository();
    const currentEndsAtMs = baseTime + 10 * 86_400_000; // Le quedan 10 días
    repo.merchants = [
      {
        id: 'm1',
        name: 'Tienda Pro Vigente',
        owner_id: 'o1',
        status: 'ACTIVE',
        subscription_status: 'ACTIVE',
        subscription_ends_at: new Date(currentEndsAtMs).toISOString(),
        created_at: new Date(baseTime).toISOString(),
      },
    ];

    const { summary } = await applySubscriptionAction(
      repo,
      { merchantId: 'm1', action: 'EXTEND_30_DAYS' },
      baseTime,
    );

    expect(summary.subscriptionStatus).toBe('ACTIVE');
    expect(summary.remainingDays).toBe(40); // 10 días restantes + 30 nuevos días
    expect(summary.subscriptionEndsAt).toBe(currentEndsAtMs + 30 * 86_400_000);
  });

  it('ejecuta EXTEND_30_DAYS sobre cuenta vencida fijando 30 días a partir de hoy', async () => {
    const repo = new InMemoryAdminRepository();
    const expiredMs = baseTime - 5 * 86_400_000; // Venció hace 5 días
    repo.merchants = [
      {
        id: 'm1',
        name: 'Tienda Vencida',
        owner_id: 'o1',
        status: 'ACTIVE',
        subscription_status: 'PAST_DUE',
        subscription_ends_at: new Date(expiredMs).toISOString(),
        created_at: new Date(baseTime).toISOString(),
      },
    ];

    const { summary } = await applySubscriptionAction(
      repo,
      { merchantId: 'm1', action: 'EXTEND_30_DAYS' },
      baseTime,
    );

    expect(summary.subscriptionStatus).toBe('ACTIVE');
    expect(summary.effectiveSubscriptionStatus).toBe('ACTIVE');
    expect(summary.remainingDays).toBe(30);
    expect(summary.subscriptionEndsAt).toBe(baseTime + 30 * 86_400_000);
  });

  it('ejecuta PAUSE activando el estado SUSPENDED sin alterar la fecha de corte', async () => {
    const repo = new InMemoryAdminRepository();
    const currentEndsAtIso = new Date(baseTime + 15 * 86_400_000).toISOString();
    repo.merchants = [
      {
        id: 'm1',
        name: 'Tienda a Pausar',
        owner_id: 'o1',
        status: 'ACTIVE',
        subscription_status: 'ACTIVE',
        subscription_ends_at: currentEndsAtIso,
        created_at: new Date(baseTime).toISOString(),
      },
    ];

    const { summary } = await applySubscriptionAction(
      repo,
      { merchantId: 'm1', action: 'PAUSE' },
      baseTime,
    );

    expect(summary.subscriptionStatus).toBe('SUSPENDED');
    expect(summary.effectiveSubscriptionStatus).toBe('SUSPENDED');
    expect(summary.subscriptionEndsAtIso).toBe(currentEndsAtIso); // No pierde su fecha
  });

  it('ejecuta RESUME reactivando como ACTIVE si no ha vencido, o PAST_DUE si expiró', async () => {
    const repo = new InMemoryAdminRepository();
    repo.merchants = [
      {
        id: 'm1',
        name: 'Pausado Vigente',
        owner_id: 'o1',
        status: 'SUSPENDED',
        subscription_status: 'SUSPENDED',
        subscription_ends_at: new Date(baseTime + 5 * 86_400_000).toISOString(),
        created_at: new Date(baseTime).toISOString(),
      },
      {
        id: 'm2',
        name: 'Pausado Expirado',
        owner_id: 'o2',
        status: 'SUSPENDED',
        subscription_status: 'SUSPENDED',
        subscription_ends_at: new Date(baseTime - 86_400_000).toISOString(),
        created_at: new Date(baseTime).toISOString(),
      },
    ];

    const res1 = await applySubscriptionAction(
      repo,
      { merchantId: 'm1', action: 'RESUME' },
      baseTime,
    );
    expect(res1.summary.effectiveSubscriptionStatus).toBe('ACTIVE');

    const res2 = await applySubscriptionAction(
      repo,
      { merchantId: 'm2', action: 'RESUME' },
      baseTime,
    );
    expect(res2.summary.effectiveSubscriptionStatus).toBe('PAST_DUE');
  });

  it('ejecuta UPDATE_BILLING_PHONE actualizando solo el teléfono sin alterar fechas', async () => {
    const repo = new InMemoryAdminRepository();
    const currentEndsAtIso = new Date(baseTime + 12 * 86_400_000).toISOString();
    repo.merchants = [
      {
        id: 'm1',
        name: 'Tienda Test',
        owner_id: 'o1',
        status: 'ACTIVE',
        subscription_status: 'ACTIVE',
        subscription_ends_at: currentEndsAtIso,
        billing_phone: '+573000000000',
        created_at: new Date(baseTime).toISOString(),
      },
    ];

    const { summary, message } = await applySubscriptionAction(
      repo,
      {
        merchantId: 'm1',
        action: 'UPDATE_BILLING_PHONE',
        billingPhone: '311 365 4315',
      },
      baseTime,
    );

    expect(summary.billingPhone).toBe('+3113654315');
    expect(summary.subscriptionEndsAtIso).toBe(currentEndsAtIso);
    expect(message).toContain('Teléfono de cobro actualizado');
  });

  it('permite actualizar el billing_phone del dueño', async () => {
    const repo = new InMemoryAdminRepository();
    repo.merchants = [
      {
        id: 'm1',
        name: 'Tienda Test',
        owner_id: 'o1',
        status: 'ACTIVE',
        created_at: new Date(baseTime).toISOString(),
      },
    ];

    const { summary } = await applySubscriptionAction(
      repo,
      {
        merchantId: 'm1',
        action: 'ACTIVATE_TRIAL',
        billingPhone: '311 365 4315',
      },
      baseTime,
    );

    expect(summary.billingPhone).toBe('+3113654315');
    const updated = await repo.getMerchantById('m1');
    expect(updated?.billing_phone).toBe('+3113654315');
  });
});

describe('Ticket 20 — api/v1/admin/subscriptions Handler HTTP Unit Tests', () => {
  it('rechaza métodos no permitidos como PUT o DELETE con 405', async () => {
    const apiPath = resolve(process.cwd(), 'api', 'v1', 'admin', 'subscriptions.ts');
    const module = await import(pathToFileURL(apiPath).href);
    const handler = module.default;

    let responseData = '';
    const res: any = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: (data: string) => {
        responseData = data;
      },
    };

    const req: any = {
      method: 'PUT',
      headers: {},
    };

    await handler(req, res);
    expect(res.statusCode).toBe(405);
    const parsed = JSON.parse(responseData);
    expect(parsed.error).toBe('METHOD_NOT_ALLOWED');
  });
});
