import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Herramienta Comercial: Calculadora de Ahorro para Vendedores y Comercios', () => {
  const rootDir = process.cwd();
  const landingPath = resolve(rootDir, 'public', 'landing.html');
  const calcPath = resolve(rootDir, 'public', 'calculadora.html');
  const vercelJsonPath = resolve(rootDir, 'vercel.json');

  describe('1. Archivos e Integración en la Web', () => {
    it('debe existir la sección de calculadora en public/landing.html', () => {
      expect(existsSync(landingPath)).toBe(true);
      const html = readFileSync(landingPath, 'utf-8');
      expect(html).toContain('id="calculadora"');
      expect(html).toContain('¿Cuánto podría ahorrar tu negocio con TransferYA?');
      expect(html).toContain('Simulador comercial');
    });

    it('debe existir la página dedicada mobile-first public/calculadora.html para comisionistas en la calle', () => {
      expect(existsSync(calcPath)).toBe(true);
      const html = readFileSync(calcPath, 'utf-8');
      expect(html).toContain('¿Cuánto podría ahorrar tu negocio con TransferYA?');
      expect(html).toContain('Herramienta Comercial para Vendedores');
    });

    it('debe existir la regla de rewrite en vercel.json para la ruta /calculadora', () => {
      expect(existsSync(vercelJsonPath)).toBe(true);
      const vercelConfig = JSON.parse(readFileSync(vercelJsonPath, 'utf-8'));
      const hasRewrite = vercelConfig.rewrites?.some(
        (r: any) => r.source === '/calculadora' && r.destination === '/calculadora.html',
      );
      expect(hasRewrite).toBe(true);
    });
  });

  describe('2. Elementos Clave y Controles de la Interfaz', () => {
    const html = readFileSync(landingPath, 'utf-8');

    it('debe tener el slider de ventas y el visor de monto formateado', () => {
      expect(html).toContain('id="calcSalesSlider"');
      expect(html).toContain('id="calcSalesDisplay"');
      expect(html).toContain('Ventas mensuales por QR');
    });

    it('debe tener el campo de porcentaje de comisión con valor por defecto 1,5%', () => {
      expect(html).toContain('id="calcFeeInput"');
      expect(html).toContain('Comisión actual del comercio (%)');
      expect(html).toContain('value="1,5"');
    });

    it('debe incluir los tres planes de TransferYA (Emprendedor $29.900, Negocio $49.900, Pro $89.900)', () => {
      expect(html).toContain('name="calcPlan"');
      expect(html).toContain('value="29900"');
      expect(html).toContain('value="49900"');
      expect(html).toContain('value="89900"');
    });

    it('debe incluir las barras visuales comparativas de costo mensual', () => {
      expect(html).toContain('Costo mensual comparado');
      expect(html).toContain('id="calcCurrentCost"');
      expect(html).toContain('id="calcTyCost"');
      expect(html).toContain('id="calcCurrentBar"');
      expect(html).toContain('id="calcTyBar"');
    });

    it('debe mostrar los resultados de ahorro mensual y anual estimado', () => {
      expect(html).toContain('Ahorro mensual estimado');
      expect(html).toContain('Ahorro anual estimado');
      expect(html).toContain('id="calcMonthlySavings"');
      expect(html).toContain('id="calcYearlySavings"');
    });

    it('debe incluir el botón de compartir cotización por WhatsApp', () => {
      expect(html).toContain('id="calcWaShareBtn"');
    });
  });

  describe('3. Validación Matemática de las Fórmulas de Ahorro', () => {
    function calculateSavings(sales: number, feePercent: number, planPrice: number) {
      const currentCost = Math.round(sales * (feePercent / 100));
      const tyCost = planPrice;
      const monthlySavings = Math.max(0, currentCost - tyCost);
      const yearlySavings = monthlySavings * 12;
      return { currentCost, tyCost, monthlySavings, yearlySavings };
    }

    it('debe calcular exactamente los valores del mockup ($20M al 1.5% con Plan Negocio $49.900)', () => {
      const result = calculateSavings(20_000_000, 1.5, 49_900);
      expect(result.currentCost).toBe(300_000);
      expect(result.tyCost).toBe(49_900);
      expect(result.monthlySavings).toBe(250_100);
      expect(result.yearlySavings).toBe(3_001_200);
    });

    it('debe calcular correctamente para una tienda pequeña ($10M al 1.5% con Plan Emprendedor $29.900)', () => {
      const result = calculateSavings(10_000_000, 1.5, 29_900);
      expect(result.currentCost).toBe(150_000);
      expect(result.tyCost).toBe(29_900);
      expect(result.monthlySavings).toBe(120_100);
      expect(result.yearlySavings).toBe(1_441_200);
    });

    it('debe calcular correctamente para un restaurante o droguería ($50M al 2.8% con Plan Pro $89.900)', () => {
      const result = calculateSavings(50_000_000, 2.8, 89_900);
      expect(result.currentCost).toBe(1_400_000);
      expect(result.tyCost).toBe(89_900);
      expect(result.monthlySavings).toBe(1_310_100);
      expect(result.yearlySavings).toBe(15_721_200);
    });
  });
});
