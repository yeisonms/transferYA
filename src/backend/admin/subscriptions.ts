import {
  evaluateEffectiveSubscriptionStatus,
  getRemainingSubscriptionDays,
  resolveSubscriptionEndsAt,
} from '../../domain/routing/billing.js';
import type { SubscriptionStatus } from '../../domain/routing/types.js';
import type {
  AdminDeviceRow,
  AdminMerchantRow,
  AdminMerchantSummary,
  AdminSubscriptionActionPayload,
  IAdminSubscriptionsRepository,
} from './types.js';

const ONLINE_HEARTBEAT_THRESHOLD_MS = 300_000; // 5 minutos

function mapRowToSummary(
  row: AdminMerchantRow,
  devices: AdminDeviceRow[],
  nowMs: number,
): AdminMerchantSummary {
  const merchantDevices = devices.filter((d) => d.merchant_id === row.id);
  const totalDevices = merchantDevices.length;

  const onlineDevices = merchantDevices.filter((d) => {
    if (d.status !== 'ACTIVE' || !d.last_heartbeat_at) return false;
    const lastSeen = new Date(d.last_heartbeat_at).getTime();
    return nowMs - lastSeen <= ONLINE_HEARTBEAT_THRESHOLD_MS;
  }).length;

  let lastHeartbeatAt: number | null = null;
  for (const d of merchantDevices) {
    if (d.last_heartbeat_at) {
      const hb = new Date(d.last_heartbeat_at).getTime();
      if (lastHeartbeatAt === null || hb > lastHeartbeatAt) {
        lastHeartbeatAt = hb;
      }
    }
  }

  const endsAtParsed = row.subscription_ends_at
    ? new Date(row.subscription_ends_at).getTime()
    : null;
  const legacyExpiresAtParsed = row.subscription_expires_at
    ? new Date(row.subscription_expires_at).getTime()
    : null;

  const rawSubStatus = (row.subscription_status ?? 'TRIAL') as SubscriptionStatus;

  const effectiveStatus = evaluateEffectiveSubscriptionStatus(
    {
      status: (row.status ?? 'ACTIVE') as any,
      subscriptionStatus: rawSubStatus,
      subscriptionEndsAt: endsAtParsed,
      subscriptionExpiresAt: legacyExpiresAtParsed,
    },
    nowMs,
  );

  const resolvedEndsAt = resolveSubscriptionEndsAt({
    subscriptionEndsAt: endsAtParsed,
    subscriptionExpiresAt: legacyExpiresAtParsed,
  });

  const remainingDays = getRemainingSubscriptionDays(resolvedEndsAt, nowMs);

  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    status: row.status,
    subscriptionStatus: rawSubStatus,
    subscriptionEndsAt: resolvedEndsAt,
    subscriptionEndsAtIso: resolvedEndsAt ? new Date(resolvedEndsAt).toISOString() : null,
    effectiveSubscriptionStatus: effectiveStatus,
    remainingDays,
    billingPhone: row.billing_phone ?? null,
    totalDevices,
    onlineDevices,
    lastHeartbeatAt,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * Lista todos los comercios registrados en TransferYA con sus estados comerciales,
 * vencimientos calculados y telemetría de cajas activas.
 */
export async function listAdminMerchants(
  repo: IAdminSubscriptionsRepository,
  nowMs: number = Date.now(),
): Promise<AdminMerchantSummary[]> {
  const [merchants, devices] = await Promise.all([
    repo.getAllMerchants(),
    repo.getAllDevices(),
  ]);

  return merchants
    .map((m) => mapRowToSummary(m, devices, nowMs))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Aplica una acción comercial sobre un comercio (Activar Trial, +30 Días Pro, Pausar o Reactivar)
 * y actualiza la base de datos de forma atómica.
 */
export async function applySubscriptionAction(
  repo: IAdminSubscriptionsRepository,
  payload: AdminSubscriptionActionPayload,
  nowMs: number = Date.now(),
): Promise<{ summary: AdminMerchantSummary; message: string }> {
  if (!payload.merchantId) {
    throw new Error('merchantId es obligatorio.');
  }

  const merchant = await repo.getMerchantById(payload.merchantId);
  if (!merchant) {
    throw new Error(`Comercio con ID ${payload.merchantId} no encontrado.`);
  }

  const updates: Parameters<IAdminSubscriptionsRepository['updateMerchantSubscription']>[1] = {
    updated_at: new Date(nowMs).toISOString(),
  };

  let message = '';
  const currentEndsAtMs = resolveSubscriptionEndsAt({
    subscriptionEndsAt: merchant.subscription_ends_at
      ? new Date(merchant.subscription_ends_at).getTime()
      : null,
    subscriptionExpiresAt: merchant.subscription_expires_at
      ? new Date(merchant.subscription_expires_at).getTime()
      : null,
  });

  switch (payload.action) {
    case 'ACTIVATE_TRIAL': {
      const days = payload.days ?? 7;
      const endsAtMs = nowMs + days * 86_400_000;
      const iso = new Date(endsAtMs).toISOString();

      updates.subscription_status = 'TRIAL';
      updates.subscription_ends_at = iso;
      updates.subscription_expires_at = iso;
      updates.status = 'ACTIVE';
      message = `Período de prueba activado por ${days} días (vence el ${iso.split('T')[0]}).`;
      break;
    }

    case 'EXTEND_30_DAYS': {
      const days = payload.days ?? 30;
      // Si la cuenta aún está vigente, extiende sumando a la fecha actual de corte.
      // Si ya venció o no tiene fecha, fija los días a partir de ahora.
      const baseMs = currentEndsAtMs && currentEndsAtMs > nowMs ? currentEndsAtMs : nowMs;
      const endsAtMs = baseMs + days * 86_400_000;
      const iso = new Date(endsAtMs).toISOString();

      updates.subscription_status = 'ACTIVE';
      updates.subscription_ends_at = iso;
      updates.subscription_expires_at = iso;
      updates.status = 'ACTIVE';
      message = `Plan Pro extendido +${days} días con éxito (nuevo vencimiento: ${iso.split('T')[0]}).`;
      break;
    }

    case 'PAUSE': {
      updates.subscription_status = 'SUSPENDED';
      updates.status = 'SUSPENDED';
      message = 'Comercio pausado administrativamente (Kill Switch activo).';
      break;
    }

    case 'RESUME': {
      updates.status = 'ACTIVE';
      if (currentEndsAtMs && currentEndsAtMs > nowMs) {
        updates.subscription_status = 'ACTIVE';
        message = 'Comercio reactivado con plan vigente.';
      } else {
        updates.subscription_status = 'PAST_DUE';
        message = 'Comercio reanudado pero su período está vencido (requiere renovación).';
      }
      break;
    }

    case 'UPDATE_BILLING_PHONE': {
      message = 'Teléfono de cobro actualizado correctamente.';
      break;
    }

    default:
      throw new Error(`Acción administrativa no soportada: ${(payload as any).action}`);
  }

  if (payload.billingPhone !== undefined) {
    const raw = payload.billingPhone.trim();
    if (raw === '') {
      updates.billing_phone = undefined;
    } else {
      let formatted = raw.replace(/[^\d+]/g, '');
      if (!formatted.startsWith('+')) {
        formatted = `+${formatted}`;
      }
      updates.billing_phone = formatted;
    }
  }

  const updatedRow = await repo.updateMerchantSubscription(payload.merchantId, updates);
  if (!updatedRow) {
    throw new Error('No se pudo actualizar el comercio en Supabase.');
  }

  const allDevices = await repo.getAllDevices();
  const summary = mapRowToSummary(updatedRow, allDevices, nowMs);

  return { summary, message };
}
