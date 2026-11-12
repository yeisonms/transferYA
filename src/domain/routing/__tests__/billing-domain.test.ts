import { describe, expect, it } from 'vitest';
import {
  evaluateEffectiveSubscriptionStatus,
  getRemainingSubscriptionDays,
  isSubscriptionAllowedToDispatch,
} from '../billing.js';
import type { Merchant } from '../types.js';

describe('Dominio Comercial y Ciclo de Suscripción (Ticket 18)', () => {
  const baseNow = 1_760_000_000_000;

  function makeMerchant(overrides: Partial<Merchant> = {}): Merchant {
    return {
      id: '5f38cd0c-7802-4cbf-98a3-e4fc71482dcb',
      name: 'Mursat Solutions',
      status: 'ACTIVE',
      subscriptionStatus: 'TRIAL',
      subscriptionEndsAt: baseNow + 7 * 86_400_000,
      billingPhone: '+573113654315',
      createdAt: baseNow - 86_400_000,
      ...overrides,
    };
  }

  it('debe mantener TRIAL y ACTIVE cuando subscriptionEndsAt es futuro o igual al instante actual', () => {
    expect(
      evaluateEffectiveSubscriptionStatus(
        makeMerchant({ subscriptionStatus: 'TRIAL' }),
        baseNow,
      ),
    ).toBe('TRIAL');

    expect(
      evaluateEffectiveSubscriptionStatus(
        makeMerchant({
          subscriptionStatus: 'ACTIVE',
          subscriptionEndsAt: baseNow,
        }),
        baseNow,
      ),
    ).toBe('ACTIVE');
  });

  it('debe devolver PAST_DUE automáticamente cuando now > subscriptionEndsAt aunque en BD diga TRIAL o ACTIVE', () => {
    expect(
      evaluateEffectiveSubscriptionStatus(
        makeMerchant({
          subscriptionStatus: 'TRIAL',
          subscriptionEndsAt: baseNow - 1,
        }),
        baseNow,
      ),
    ).toBe('PAST_DUE');

    expect(
      evaluateEffectiveSubscriptionStatus(
        makeMerchant({
          subscriptionStatus: 'ACTIVE',
          subscriptionEndsAt: baseNow - 5000,
        }),
        baseNow,
      ),
    ).toBe('PAST_DUE');
  });

  it('debe respetar compatibilidad retroactiva con subscriptionExpiresAt heredado', () => {
    const legacyExpired: Merchant = {
      id: 'legacy-1',
      name: 'Piloto',
      status: 'ACTIVE',
      subscriptionExpiresAt: baseNow - 1000,
      createdAt: baseNow - 86_400_000,
    };

    expect(evaluateEffectiveSubscriptionStatus(legacyExpired, baseNow)).toBe(
      'PAST_DUE',
    );
  });

  it('debe priorizar SUSPENDED sobre cualquier fecha vigente o vencida', () => {
    expect(
      evaluateEffectiveSubscriptionStatus(
        makeMerchant({
          status: 'ACTIVE',
          subscriptionStatus: 'SUSPENDED',
          subscriptionEndsAt: baseNow + 30 * 86_400_000,
        }),
        baseNow,
      ),
    ).toBe('SUSPENDED');

    expect(
      evaluateEffectiveSubscriptionStatus(
        makeMerchant({
          status: 'SUSPENDED',
          subscriptionStatus: 'ACTIVE',
          subscriptionEndsAt: baseNow + 30 * 86_400_000,
        }),
        baseNow,
      ),
    ).toBe('SUSPENDED');
  });

  it('isSubscriptionAllowedToDispatch solo autoriza ACTIVE y TRIAL', () => {
    expect(isSubscriptionAllowedToDispatch('TRIAL')).toBe(true);
    expect(isSubscriptionAllowedToDispatch('ACTIVE')).toBe(true);
    expect(isSubscriptionAllowedToDispatch('PAST_DUE')).toBe(false);
    expect(isSubscriptionAllowedToDispatch('SUSPENDED')).toBe(false);
  });

  it('getRemainingSubscriptionDays calcula días restantes hacia arriba y 0 cuando ya expiró', () => {
    expect(getRemainingSubscriptionDays(baseNow + 2.2 * 86_400_000, baseNow)).toBe(
      3,
    );
    expect(getRemainingSubscriptionDays(baseNow - 100, baseNow)).toBe(0);
    expect(getRemainingSubscriptionDays(null, baseNow)).toBe(0);
  });
});
