-- ==============================================================================
-- Migration: 20261114000001_billing_invoices_schema.sql
-- Description: Ticket 22 (Fase 3) - Tabla de facturación y conciliación por Dogfooding
--              (`billing_invoices`) para cobros automáticos de MurSat Solutions.
-- ==============================================================================

-- 1. Crear tabla de facturas de cobro comercial
CREATE TABLE IF NOT EXISTS billing_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    amount_cop BIGINT NOT NULL DEFAULT 50000,
    reference_code VARCHAR(30) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'CANCELLED', 'EXPIRED')),
    notification_id UUID REFERENCES captured_notifications(id) ON DELETE SET NULL,
    paid_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Índices de búsqueda para conciliación rápida y auditoría
CREATE INDEX IF NOT EXISTS idx_billing_invoices_merchant
    ON billing_invoices (merchant_id, status);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_reference
    ON billing_invoices (reference_code);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_notification
    ON billing_invoices (notification_id);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_created
    ON billing_invoices (created_at DESC);

-- 3. Habilitar Row Level Security (RLS)
ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;

-- 4. Políticas de lectura aislada para comerciantes
DROP POLICY IF EXISTS "merchants_view_own_billing_invoices" ON billing_invoices;
CREATE POLICY "merchants_view_own_billing_invoices"
    ON billing_invoices
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM merchants m
            WHERE m.id = billing_invoices.merchant_id
              AND m.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "super_admin_view_all_billing_invoices" ON billing_invoices;
CREATE POLICY "super_admin_view_all_billing_invoices"
    ON billing_invoices
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = '44737b1e-254d-4014-9f24-34bcd9340768'::uuid
    );

DROP POLICY IF EXISTS "service_role_manage_billing_invoices" ON billing_invoices;
CREATE POLICY "service_role_manage_billing_invoices"
    ON billing_invoices
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 5. Trigger anti-manipulación: impedir inserciones o mutaciones directas desde el frontend
CREATE OR REPLACE FUNCTION prevent_billing_invoices_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    jwt_role TEXT := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), current_user);
BEGIN
    IF jwt_role = 'authenticated' THEN
        RAISE EXCEPTION 'No autorizado: las facturas comerciales solo pueden generarse y conciliarse desde el backend o Admin API.'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_billing_invoices_tampering ON billing_invoices;
CREATE TRIGGER trg_prevent_billing_invoices_tampering
    BEFORE INSERT OR UPDATE OR DELETE ON billing_invoices
    FOR EACH ROW
    EXECUTE FUNCTION prevent_billing_invoices_tampering();
