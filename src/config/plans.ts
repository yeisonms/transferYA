/**
 * Fuente única de verdad (Single Source of Truth) para planes, precios,
 * límites técnicos, add-ons y economía unitaria de TransferYA.
 *
 * Tarifa oficial de Utilidad de Meta WhatsApp Cloud API en Colombia: $2.95 COP/mensaje.
 */

export const META_UTILITY_RATE_COP = 2.95;

export type PlanId = 'emprendedor' | 'negocio' | 'pro';
export type AddonId = 'extra_cashier_wa' | 'extra_alerts_1000';
export type BillingType = 'monthly' | 'one_time';
export type BillingCycle = 'monthly' | 'annual';
export type TrafficLightStatus = 'NORMAL' | 'WARNING_80' | 'EXCEEDED_100';

export interface PlanLimits {
  /** Número máximo de cajeros con teléfono de WhatsApp registrados */
  maxWhatsappCashiers: number;
  /** Tope máximo de alertas mensuales enviadas a WhatsApp */
  monthlyAlertsCap: number;
  /** Número máximo de sedes físicas o celulares Centinela vinculados */
  maxBranchesOrDevices: number;
  /** Respaldo Cloud automático vía correo Gmail */
  cloudEmailFallback: boolean;
  /** Pantalla de Mostrador / Caja Web en vivo con voz alta */
  webPosLiveScreen: boolean;
  /** Compatibilidad con iPhone mediante Atajos de iOS */
  iosShortcutWebhook: boolean;
  /** Enrutamiento de alertas segmentado por sede/caja */
  branchRouting: boolean;
}

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  badge: string | null;
  highlighted: boolean;
  priceMonthlyCop: number;
  priceAnnualCop: number;
  annualEffectiveMonthlyCop: number;
  annualSavingsCop: number;
  limits: PlanLimits;
}

export interface PlanAddon {
  id: AddonId;
  name: string;
  billingType: BillingType;
  priceCop: number;
  addsWhatsappCashiers: number;
  addsMonthlyAlerts: number;
}

export interface TrialConfig {
  durationDays: number;
  maxAlerts: number;
  maxWhatsappCashiers: number;
  requiresCard: boolean;
  maxCostCop: number;
}

/** Configuración de la prueba gratuita de 7 días */
export const TRIAL_CONFIG: TrialConfig = {
  durationDays: 7,
  maxAlerts: 150,
  maxWhatsappCashiers: 2,
  requiresCard: false,
  maxCostCop: 150 * META_UTILITY_RATE_COP, // $442.50 COP
};

/** Catálogo oficial de planes de TransferYA */
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  {
    id: 'emprendedor',
    name: 'Emprendedor',
    badge: null,
    highlighted: false,
    priceMonthlyCop: 29900,
    priceAnnualCop: 299000,
    annualEffectiveMonthlyCop: 24917,
    annualSavingsCop: 59800,
    limits: {
      maxWhatsappCashiers: 1,
      monthlyAlertsCap: 1500,
      maxBranchesOrDevices: 1,
      cloudEmailFallback: true,
      webPosLiveScreen: true,
      iosShortcutWebhook: true,
      branchRouting: false,
    },
  },
  {
    id: 'negocio',
    name: 'Negocio',
    badge: 'Más popular',
    highlighted: true,
    priceMonthlyCop: 49900,
    priceAnnualCop: 499000,
    annualEffectiveMonthlyCop: 41583,
    annualSavingsCop: 99800,
    limits: {
      maxWhatsappCashiers: 2,
      monthlyAlertsCap: 3500,
      maxBranchesOrDevices: 1,
      cloudEmailFallback: true,
      webPosLiveScreen: true,
      iosShortcutWebhook: true,
      branchRouting: false,
    },
  },
  {
    id: 'pro',
    name: 'Pro Multi-Caja',
    badge: 'Multi-Sede',
    highlighted: false,
    priceMonthlyCop: 89900,
    priceAnnualCop: 899000,
    annualEffectiveMonthlyCop: 74917,
    annualSavingsCop: 179800,
    limits: {
      maxWhatsappCashiers: 4,
      monthlyAlertsCap: 7500,
      maxBranchesOrDevices: 3,
      cloudEmailFallback: true,
      webPosLiveScreen: true,
      iosShortcutWebhook: true,
      branchRouting: true,
    },
  },
] as const;

/** Catálogo oficial de add-ons */
export const PLAN_ADDONS: readonly PlanAddon[] = [
  {
    id: 'extra_cashier_wa',
    name: 'Cajero WhatsApp adicional',
    billingType: 'monthly',
    priceCop: 12900,
    addsWhatsappCashiers: 1,
    addsMonthlyAlerts: 1200,
  },
  {
    id: 'extra_alerts_1000',
    name: 'Paquete de 1.000 alertas extra',
    billingType: 'one_time',
    priceCop: 7900,
    addsWhatsappCashiers: 0,
    addsMonthlyAlerts: 1000,
  },
] as const;

/**
 * Busca un plan por su identificador único.
 */
export function getPlanById(id: string | null | undefined): SubscriptionPlan | undefined {
  if (!id) return undefined;
  return SUBSCRIPTION_PLANS.find((p) => p.id === id);
}

/**
 * Busca un add-on por su identificador único.
 */
export function getAddonById(id: string | null | undefined): PlanAddon | undefined {
  if (!id) return undefined;
  return PLAN_ADDONS.find((a) => a.id === id);
}

/**
 * Calcula el cupo efectivo mensual de alertas de WhatsApp sumando la base del plan
 * y los paquetes de alertas o cajeros adicionales contratados.
 *
 * Fórmula: cupo_efectivo = plan.monthly_alerts_cap + sum(addon.adds_monthly_alerts * qty)
 */
export function calculateEffectiveMonthlyQuota(
  planId: string | null | undefined,
  activeAddons: Array<{ addonId: string; quantity?: number }> = [],
): number {
  const plan = getPlanById(planId) || SUBSCRIPTION_PLANS[0];
  const baseCap = plan.limits.monthlyAlertsCap;

  const extraAlerts = activeAddons.reduce((sum, item) => {
    const addon = getAddonById(item.addonId);
    if (!addon) return sum;
    const qty = Math.max(1, item.quantity ?? 1);
    return sum + addon.addsMonthlyAlerts * qty;
  }, 0);

  return baseCap + extraAlerts;
}

/**
 * Calcula el número máximo permitido de cajas físicas (celulares Centinela o Atajos iOS)
 * según el plan contratado.
 */
export function calculateMaxAllowedDevices(planId: string | null | undefined): number {
  const plan = getPlanById(planId) || SUBSCRIPTION_PLANS[0];
  return plan.limits.maxBranchesOrDevices;
}

/**
 * Calcula el número máximo permitido de cajeros de WhatsApp sumando la base del plan
 * más los cajeros adicionales contratados.
 */
export function calculateMaxAllowedCashiers(
  planId: string | null | undefined,
  activeAddons: Array<{ addonId: string; quantity?: number }> = [],
): number {
  const plan = getPlanById(planId) || SUBSCRIPTION_PLANS[0];
  const baseCashiers = plan.limits.maxWhatsappCashiers;

  const extraCashiers = activeAddons.reduce((sum, item) => {
    const addon = getAddonById(item.addonId);
    if (!addon) return sum;
    const qty = Math.max(1, item.quantity ?? 1);
    return sum + addon.addsWhatsappCashiers * qty;
  }, 0);

  return baseCashiers + extraCashiers;
}

/**
 * Evalúa el estado del semáforo de consumo de alertas de WhatsApp.
 * - NORMAL: < 80% del cupo
 * - WARNING_80: >= 80% y < 100% (dispara sugerencia de recarga o upgrade al dueño)
 * - EXCEEDED_100: >= 100% (pausa el despacho a WhatsApp para proteger presupuesto Meta)
 */
export function evaluateTrafficLightStatus(
  usedAlerts: number,
  totalQuota: number,
): TrafficLightStatus {
  if (totalQuota <= 0) return 'EXCEEDED_100';
  if (usedAlerts >= totalQuota) return 'EXCEEDED_100';
  if (usedAlerts >= totalQuota * 0.8) return 'WARNING_80';
  return 'NORMAL';
}

/**
 * Retorna el porcentaje consumido del cupo (0 a 100+).
 */
export function calculateAlertConsumptionPercentage(
  usedAlerts: number,
  totalQuota: number,
): number {
  if (totalQuota <= 0) return 100;
  return Math.min(100, Math.round((usedAlerts / totalQuota) * 100));
}
