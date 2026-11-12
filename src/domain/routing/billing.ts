import type { Merchant, SubscriptionStatus } from './types.js';

const MS_PER_DAY = 86_400_000;

/**
 * Resuelve la fecha límite de suscripción unificando `subscriptionEndsAt` (Fase 3)
 * con la columna heredada `subscriptionExpiresAt` (Ticket 10).
 */
export function resolveSubscriptionEndsAt(
  merchant: Pick<Merchant, 'subscriptionEndsAt' | 'subscriptionExpiresAt'>,
): number | null {
  return merchant.subscriptionEndsAt ?? merchant.subscriptionExpiresAt ?? null;
}

/**
 * Evalúa el estado comercial efectivo de un comercio en un instante dado.
 * Si la fecha límite venció (`nowMs > endsAt`), el estado efectivo pasa a `PAST_DUE`
 * aunque en base de datos aún figure `ACTIVE` o `TRIAL`.
 */
export function evaluateEffectiveSubscriptionStatus(
  merchant: Pick<
    Merchant,
    'status' | 'subscriptionStatus' | 'subscriptionEndsAt' | 'subscriptionExpiresAt'
  >,
  nowMs: number = Date.now(),
): SubscriptionStatus {
  if (
    merchant.status === 'SUSPENDED' ||
    merchant.status === 'CANCELLED' ||
    merchant.subscriptionStatus === 'SUSPENDED'
  ) {
    return 'SUSPENDED';
  }

  if (merchant.subscriptionStatus === 'PAST_DUE') {
    return 'PAST_DUE';
  }

  const endsAt = resolveSubscriptionEndsAt(merchant);
  if (endsAt !== null && endsAt < nowMs) {
    return 'PAST_DUE';
  }

  return merchant.subscriptionStatus ?? 'ACTIVE';
}

/**
 * Indica si un comercio está habilitado para despachar alertas de cobro a cajeros.
 */
export function isSubscriptionAllowedToDispatch(
  status: SubscriptionStatus,
): boolean {
  return status === 'ACTIVE' || status === 'TRIAL';
}

/**
 * Calcula los días restantes de suscripción (0 si ya venció o no tiene fecha).
 */
export function getRemainingSubscriptionDays(
  endsAtMs: number | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (endsAtMs === null || endsAtMs === undefined) {
    return 0;
  }
  const diff = endsAtMs - nowMs;
  if (diff <= 0) {
    return 0;
  }
  return Math.ceil(diff / MS_PER_DAY);
}
