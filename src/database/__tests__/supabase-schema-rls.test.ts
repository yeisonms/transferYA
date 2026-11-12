import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Validación de Migraciones Supabase DDL y Políticas de Aislamiento RLS (Ticket 16)', () => {
  const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
  const initialSchemaPath = resolve(
    migrationsDir,
    '20261105000001_initial_schema.sql',
  );
  const rlsPath = resolve(
    migrationsDir,
    '20261105000002_row_level_security.sql',
  );

  describe('1. Existencia e Integridad de Archivos de Migración', () => {
    it('debe existir el directorio supabase/migrations', () => {
      expect(existsSync(migrationsDir)).toBe(true);
    });

    it('debe existir el archivo de migración DDL inicial 20261105000001_initial_schema.sql', () => {
      expect(existsSync(initialSchemaPath)).toBe(true);
    });

    it('debe existir el archivo de políticas RLS 20261105000002_row_level_security.sql', () => {
      expect(existsSync(rlsPath)).toBe(true);
    });
  });

  describe('2. Estructura de Tablas, Claves y Restricciones DDL', () => {
    it('debe definir las 6 tablas esenciales del sistema en la migración inicial', () => {
      const sql = readFileSync(initialSchemaPath, 'utf-8');

      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+merchants/i);
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+devices/i);
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+cashier_recipients/i);
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+captured_notifications/i);
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+payment_fingerprints/i);
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+enrollment_tokens/i);
    });

    it('debe incluir la restricción de unicidad estricta para la Huella de Idempotencia por dispositivo', () => {
      const sql = readFileSync(initialSchemaPath, 'utf-8');
      expect(sql).toMatch(
        /CONSTRAINT\s+uq_device_payment_fingerprint\s+UNIQUE\s*\(\s*device_id\s*,\s*payment_fingerprint\s*\)/i,
      );
    });

    it('debe incluir índices optimizados para lookup rápido y auditoría temporal', () => {
      const sql = readFileSync(initialSchemaPath, 'utf-8');
      expect(sql).toMatch(/idx_merchants_status/i);
      expect(sql).toMatch(/idx_devices_merchant/i);
      expect(sql).toMatch(/idx_cashier_recipients_merchant/i);
      expect(sql).toMatch(/idx_captured_notifications_device_status/i);
      expect(sql).toMatch(/idx_payment_fingerprints_lookup/i);
      expect(sql).toMatch(/idx_enrollment_tokens_lookup/i);
    });
  });

  describe('3. Políticas de Aislamiento Row Level Security (RLS)', () => {
    it('debe activar RLS (ENABLE ROW LEVEL SECURITY) explícitamente en las 6 tablas transaccionales', () => {
      const sql = readFileSync(rlsPath, 'utf-8');

      expect(sql).toMatch(
        /ALTER TABLE\s+merchants\s+ENABLE ROW LEVEL SECURITY/i,
      );
      expect(sql).toMatch(
        /ALTER TABLE\s+devices\s+ENABLE ROW LEVEL SECURITY/i,
      );
      expect(sql).toMatch(
        /ALTER TABLE\s+cashier_recipients\s+ENABLE ROW LEVEL SECURITY/i,
      );
      expect(sql).toMatch(
        /ALTER TABLE\s+captured_notifications\s+ENABLE ROW LEVEL SECURITY/i,
      );
      expect(sql).toMatch(
        /ALTER TABLE\s+payment_fingerprints\s+ENABLE ROW LEVEL SECURITY/i,
      );
      expect(sql).toMatch(
        /ALTER TABLE\s+enrollment_tokens\s+ENABLE ROW LEVEL SECURITY/i,
      );
    });

    it('debe aislar merchants mediante el predicado auth.uid() = owner_id', () => {
      const sql = readFileSync(rlsPath, 'utf-8');
      expect(sql).toMatch(/auth\.uid\(\)\s*=\s*owner_id/i);
    });

    it('debe restringir captured_notifications a solo lectura (SELECT) para los comerciantes', () => {
      const sql = readFileSync(rlsPath, 'utf-8');
      expect(sql).toMatch(
        /CREATE POLICY\s+.*_owner_select\s+ON\s+captured_notifications\s+FOR SELECT/i,
      );
      // No debe permitir que un usuario regular modifique ni inserte notificaciones capturadas directamente
      expect(sql).not.toMatch(
        /CREATE POLICY\s+.*ON\s+captured_notifications\s+FOR INSERT/i,
      );
      expect(sql).not.toMatch(
        /CREATE POLICY\s+.*ON\s+captured_notifications\s+FOR UPDATE/i,
      );
      expect(sql).not.toMatch(
        /CREATE POLICY\s+.*ON\s+captured_notifications\s+FOR DELETE/i,
      );
    });

    it('debe permitir a los comerciantes gestionar sus cajeros (cashier_recipients)', () => {
      const sql = readFileSync(rlsPath, 'utf-8');
      expect(sql).toMatch(/ON\s+cashier_recipients\s+FOR ALL/i);
    });
  });

  describe('4. Migración de Endurecimiento Multi-Comercio Estricto (Paso 4)', () => {
    it('debe eliminar las políticas abiertas alpha_service_* y restaurar políticas autenticadas', () => {
      const strictPath = resolve(
        migrationsDir,
        '20261112000001_multi_tenant_strict_rls.sql',
      );
      expect(existsSync(strictPath)).toBe(true);
      const sql = readFileSync(strictPath, 'utf-8');

      expect(sql).toMatch(/DROP POLICY IF EXISTS\s+"alpha_service_merchants"/i);
      expect(sql).toMatch(/DROP POLICY IF EXISTS\s+"alpha_service_devices"/i);
      expect(sql).toMatch(/DROP POLICY IF EXISTS\s+"alpha_service_cashier_recipients"/i);
      expect(sql).toMatch(/DROP POLICY IF EXISTS\s+"alpha_service_captured_notifications"/i);
      expect(sql).toMatch(/DROP POLICY IF EXISTS\s+"alpha_service_payment_fingerprints"/i);
      expect(sql).toMatch(/DROP POLICY IF EXISTS\s+"alpha_service_enrollment_tokens"/i);
      expect(sql).toMatch(/CREATE POLICY\s+merchants_owner_insert\s+ON\s+merchants/i);
      expect(sql).toMatch(/TO authenticated/i);
    });
  });
});

