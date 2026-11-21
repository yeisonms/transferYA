import { describe, expect, it } from 'vitest';
import {
  calculateAlertConsumptionPercentage,
  calculateEffectiveMonthlyQuota,
  calculateMaxAllowedCashiers,
  evaluateTrafficLightStatus,
  getAddonById,
  getPlanById,
  META_UTILITY_RATE_COP,
  PLAN_ADDONS,
  SUBSCRIPTION_PLANS,
  TRIAL_CONFIG,
} from '../plans.js';

describe('src/config/plans.ts — Especificación Comercial y Fuente de Verdad', () => {
  describe('1. Catálogo Oficial de Planes', () => {
    it('debe contener exactamente los 3 planes oficiales', () => {
      expect(SUBSCRIPTION_PLANS).toHaveLength(3);
      const planIds = SUBSCRIPTION_PLANS.map((p) => p.id);
      expect(planIds).toEqual(['emprendedor', 'negocio', 'pro']);
    });

    it('debe tener precios y descuentos anuales exactos (10x mensual = 2 meses gratis)', () => {
      for (const plan of SUBSCRIPTION_PLANS) {
        expect(plan.priceAnnualCop).toBe(plan.priceMonthlyCop * 10);
        const regularAnnual = plan.priceMonthlyCop * 12;
        expect(plan.annualSavingsCop).toBe(regularAnnual - plan.priceAnnualCop);
        expect(plan.annualEffectiveMonthlyCop).toBe(Math.round(plan.priceAnnualCop / 12));
      }
    });

    it('Plan Emprendedor debe tener los límites de 1 caja y 1.500 alertas', () => {
      const plan = getPlanById('emprendedor');
      expect(plan).toBeDefined();
      expect(plan?.priceMonthlyCop).toBe(29900);
      expect(plan?.limits.maxWhatsappCashiers).toBe(1);
      expect(plan?.limits.monthlyAlertsCap).toBe(1500);
      expect(plan?.limits.cloudEmailFallback).toBe(false);
      expect(plan?.limits.webPosLiveScreen).toBe(false);
    });

    it('Plan Negocio debe ser el plan ancla resaltado con Respaldo Cloud y 3.500 alertas', () => {
      const plan = getPlanById('negocio');
      expect(plan).toBeDefined();
      expect(plan?.highlighted).toBe(true);
      expect(plan?.badge).toBe('Más popular');
      expect(plan?.priceMonthlyCop).toBe(49900);
      expect(plan?.limits.maxWhatsappCashiers).toBe(2);
      expect(plan?.limits.monthlyAlertsCap).toBe(3500);
      expect(plan?.limits.cloudEmailFallback).toBe(true);
      expect(plan?.limits.webPosLiveScreen).toBe(true);
      expect(plan?.limits.iosShortcutWebhook).toBe(true);
    });

    it('Plan Pro Multi-Caja debe permitir hasta 4 cajeros, 3 sedes y 7.500 alertas', () => {
      const plan = getPlanById('pro');
      expect(plan).toBeDefined();
      expect(plan?.badge).toBe('Multi-Sede');
      expect(plan?.priceMonthlyCop).toBe(89900);
      expect(plan?.limits.maxWhatsappCashiers).toBe(4);
      expect(plan?.limits.monthlyAlertsCap).toBe(7500);
      expect(plan?.limits.maxBranchesOrDevices).toBe(3);
      expect(plan?.limits.branchRouting).toBe(true);
    });
  });

  describe('2. Add-ons Oficiales', () => {
    it('debe definir los 2 add-ons comerciales', () => {
      expect(PLAN_ADDONS).toHaveLength(2);
      const addonIds = PLAN_ADDONS.map((a) => a.id);
      expect(addonIds).toEqual(['extra_cashier_wa', 'extra_alerts_1000']);
    });

    it('Cajero WhatsApp extra debe costar $12.900 COP y sumar +1.200 alertas', () => {
      const addon = getAddonById('extra_cashier_wa');
      expect(addon).toBeDefined();
      expect(addon?.priceCop).toBe(12900);
      expect(addon?.billingType).toBe('monthly');
      expect(addon?.addsWhatsappCashiers).toBe(1);
      expect(addon?.addsMonthlyAlerts).toBe(1200);
    });

    it('Paquete de 1.000 alertas debe costar $7.900 COP como recarga única', () => {
      const addon = getAddonById('extra_alerts_1000');
      expect(addon).toBeDefined();
      expect(addon?.priceCop).toBe(7900);
      expect(addon?.billingType).toBe('one_time');
      expect(addon?.addsWhatsappCashiers).toBe(0);
      expect(addon?.addsMonthlyAlerts).toBe(1000);
    });
  });

  describe('3. Prueba Gratuita Protegida (Trial)', () => {
    it('debe limitar el trial a 7 días y 150 alertas con costo acotado a $442.50 COP', () => {
      expect(TRIAL_CONFIG.durationDays).toBe(7);
      expect(TRIAL_CONFIG.maxAlerts).toBe(150);
      expect(TRIAL_CONFIG.maxWhatsappCashiers).toBe(2);
      expect(TRIAL_CONFIG.requiresCard).toBe(false);
      expect(TRIAL_CONFIG.maxCostCop).toBe(150 * META_UTILITY_RATE_COP);
      expect(TRIAL_CONFIG.maxCostCop).toBe(442.5);
    });
  });

  describe('4. Funciones de Cálculo de Cupos y Cajeros', () => {
    it('debe calcular el cupo base sin add-ons', () => {
      expect(calculateEffectiveMonthlyQuota('emprendedor')).toBe(1500);
      expect(calculateEffectiveMonthlyQuota('negocio')).toBe(3500);
      expect(calculateEffectiveMonthlyQuota('pro')).toBe(7500);
    });

    it('debe sumar alertas de add-ons al cupo del plan', () => {
      const quota = calculateEffectiveMonthlyQuota('negocio', [
        { addonId: 'extra_cashier_wa', quantity: 1 }, // +1200
        { addonId: 'extra_alerts_1000', quantity: 2 }, // +2000
      ]);
      expect(quota).toBe(3500 + 1200 + 2000); // 6700
    });

    it('debe calcular cajeros permitidos sumando los add-ons de cajero', () => {
      expect(calculateMaxAllowedCashiers('emprendedor')).toBe(1);
      const withExtra = calculateMaxAllowedCashiers('emprendedor', [
        { addonId: 'extra_cashier_wa', quantity: 1 },
      ]);
      expect(withExtra).toBe(2);

      const proWithExtra = calculateMaxAllowedCashiers('pro', [
        { addonId: 'extra_cashier_wa', quantity: 2 },
        { addonId: 'extra_alerts_1000', quantity: 5 }, // no añade cajeros
      ]);
      expect(proWithExtra).toBe(6);
    });

    it('debe usar el plan base por defecto ante un ID inexistente', () => {
      expect(calculateEffectiveMonthlyQuota(null)).toBe(1500);
      expect(calculateMaxAllowedCashiers(undefined)).toBe(1);
    });
  });

  describe('5. Semáforo de Consumo (80% y 100%)', () => {
    it('debe retornar NORMAL cuando el consumo es menor al 80%', () => {
      expect(evaluateTrafficLightStatus(0, 1000)).toBe('NORMAL');
      expect(evaluateTrafficLightStatus(799, 1000)).toBe('NORMAL');
    });

    it('debe retornar WARNING_80 cuando el consumo es >= 80% y < 100%', () => {
      expect(evaluateTrafficLightStatus(800, 1000)).toBe('WARNING_80');
      expect(evaluateTrafficLightStatus(999, 1000)).toBe('WARNING_80');
    });

    it('debe retornar EXCEEDED_100 cuando se alcanza o supera el 100%', () => {
      expect(evaluateTrafficLightStatus(1000, 1000)).toBe('EXCEEDED_100');
      expect(evaluateTrafficLightStatus(1200, 1000)).toBe('EXCEEDED_100');
    });

    it('debe manejar casos borde de cupo cero o negativo', () => {
      expect(evaluateTrafficLightStatus(10, 0)).toBe('EXCEEDED_100');
      expect(evaluateTrafficLightStatus(10, -5)).toBe('EXCEEDED_100');
    });

    it('debe calcular el porcentaje de consumo con tope en 100%', () => {
      expect(calculateAlertConsumptionPercentage(500, 1000)).toBe(50);
      expect(calculateAlertConsumptionPercentage(800, 1000)).toBe(80);
      expect(calculateAlertConsumptionPercentage(1200, 1000)).toBe(100);
      expect(calculateAlertConsumptionPercentage(0, 1000)).toBe(0);
    });
  });
});
