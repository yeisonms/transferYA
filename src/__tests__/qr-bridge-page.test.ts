import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('Página Puente para QR de Volanteo (/go) y Telemetría', () => {
  const rootDir = process.cwd();
  const goHtmlPath = resolve(rootDir, 'public', 'go.html');
  const migrationPath = resolve(rootDir, 'supabase', 'migrations', '20261123000001_qr_hub_events.sql');
  const qrEventsApiPath = resolve(rootDir, 'api', 'v1', 'qr-events.ts');
  const vercelJsonPath = resolve(rootDir, 'vercel.json');

  describe('1. Estructura y Archivos Esenciales', () => {
    it('debe existir el archivo public/go.html', () => {
      expect(existsSync(goHtmlPath)).toBe(true);
    });

    it('debe existir el archivo de migración SQL para qr_hub_events', () => {
      expect(existsSync(migrationPath)).toBe(true);
    });

    it('debe existir el endpoint serverless api/v1/qr-events.ts', () => {
      expect(existsSync(qrEventsApiPath)).toBe(true);
    });

    it('debe existir la regla de rewrite en vercel.json para la ruta /go', () => {
      expect(existsSync(vercelJsonPath)).toBe(true);
      const vercelConfig = JSON.parse(readFileSync(vercelJsonPath, 'utf-8'));
      const hasRewrite = vercelConfig.rewrites?.some(
        (r: any) => r.source === '/go' && r.destination === '/go.html',
      );
      expect(hasRewrite).toBe(true);
    });
  });

  describe('2. Contenido Visual y Requisitos Mobile-First (/go)', () => {
    const html = readFileSync(goHtmlPath, 'utf-8');

    it('debe tener el título oficial y metadatos noindex para no competir con el SEO principal', () => {
      expect(html).toContain('<title>transferYA — Activa tus 7 días gratis</title>');
      expect(html).toMatch(/<meta\s+name=["']robots["']\s+content=["']noindex,\s*nofollow["']/i);
    });

    it('debe incluir el encabezado compacto con el titular y la píldora de confianza', () => {
      expect(html).toContain('Adiós a los comprobantes falsos');
      expect(html).toContain('Confirma por WhatsApp y administra cada pago real en tu panel sonoro.');
      expect(html).toContain('🔒 Sin pedir claves ni tocar tu plata');
    });

    it('debe contener las 3 opciones de acción táctiles con la constante de WhatsApp 573144886484', () => {
      expect(html).toContain('573144886484');

      // Opción 1: Botón principal
      expect(html).toContain('Instálalo en 15 minutos');
      expect(html).toContain('Activa 7 días gratis sin tarjeta por WhatsApp');
      expect(html).toContain('Hola%2C%20escane%C3%A9%20el%20QR%20de%20transferYA%20y%20quiero%20configurar%20la%20instalaci%C3%B3n%20en%2015%20minutos%20con%20los%207%20d%C3%ADas%20gratis.');

      // Opción 2: Botón secundario
      expect(html).toContain('Habla con un asesor');
      expect(html).toContain('Resuelve tus dudas por WhatsApp ahora mismo');
      expect(html).toContain('Hola%2C%20escane%C3%A9%20el%20QR%20de%20transferYA%20y%20quiero%20hablar%20con%20un%20asesor%20para%20conocer%20m%C3%A1s.');

      // Opción 3: Botón terciario
      expect(html).toContain('Entiende cómo funciona y ve los planes');
      expect(html).toContain('Paso a paso, panel web sonoro y precios desde $29.900/mes');
      expect(html).toContain('/landing?utm_source=volante&utm_medium=qr&utm_campaign=go');
    });

    it('debe incluir el pie de confianza con las 4 entidades financieras y el número de contacto', () => {
      expect(html).toContain('Compatible con');
      expect(html).toContain('Nequi');
      expect(html).toContain('DaviPlata');
      expect(html).toContain('Bre-B');
      expect(html).toContain('Bancolombia');
      expect(html).toContain('0% comisiones por venta · WhatsApp: 314 488 6484');
    });

    it('debe incluir el script de telemetría ligero para page_view y clicks con soporte para ?z=', () => {
      expect(html).toContain('WHATSAPP_NUMBER');
      expect(html).toContain('getQrZone');
      expect(html).toContain("params.get('z')");
      expect(html).toContain('recordQrHubEvent');
      expect(html).toContain('page_view');
      expect(html).toContain('click_install');
      expect(html).toContain('click_advisor');
      expect(html).toContain('click_landing');
      expect(html).toContain('/api/v1/qr-events');
    });
  });

  describe('3. DDL de Supabase para qr_hub_events', () => {
    const sql = readFileSync(migrationPath, 'utf-8');

    it('debe crear la tabla qr_hub_events con las columnas id, event_type, zone, user_agent y created_at', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+qr_hub_events/i);
      expect(sql).toContain('event_type TEXT NOT NULL');
      expect(sql).toContain("zone TEXT DEFAULT 'general'");
      expect(sql).toContain('user_agent TEXT');
      expect(sql).toContain('created_at TIMESTAMPTZ DEFAULT NOW()');
    });

    it('debe habilitar Row Level Security (RLS) y permitir inserción anónima', () => {
      expect(sql).toMatch(/ALTER TABLE\s+qr_hub_events\s+ENABLE ROW LEVEL SECURITY/i);
      expect(sql).toMatch(/CREATE POLICY\s+"Permitir insercion anonima de eventos QR"/i);
      expect(sql).toMatch(/FOR INSERT/i);
    });
  });
});
