-- ==============================================================================
-- Migration: 20261105000002_row_level_security.sql
-- Description: Row Level Security (RLS) policies for multi-tenant isolation (ADR-0006).
--              Enforces strict owner-based boundaries while allowing the trusted backend
--              (service_role) to execute webhook ingestion and pipeline dispatch without friction.
-- ==============================================================================

-- 1. Habilitación obligatoria de Row Level Security (RLS) en todas las tablas
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashier_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE captured_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_tokens ENABLE ROW LEVEL SECURITY;

-- 2. Políticas de Seguridad para MERCHANTS
CREATE POLICY merchants_owner_select ON merchants
    FOR SELECT
    USING (auth.uid() = owner_id);

CREATE POLICY merchants_owner_update ON merchants
    FOR UPDATE
    USING (auth.uid() = owner_id);

-- 3. Políticas de Seguridad para DEVICES
CREATE POLICY devices_owner_select ON devices
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = devices.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

CREATE POLICY devices_owner_update ON devices
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = devices.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- 4. Políticas de Seguridad para CASHIER_RECIPIENTS (Gestión completa por el comerciante)
CREATE POLICY cashier_recipients_owner_all ON cashier_recipients
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = cashier_recipients.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- 5. Políticas de Seguridad para CAPTURED_NOTIFICATIONS (Solo Lectura para Comerciantes)
-- El backend (service_role) realiza las inserciones y mutaciones durante la ingesta HMAC.
CREATE POLICY captured_notifications_owner_select ON captured_notifications
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM devices
            JOIN merchants ON merchants.id = devices.merchant_id
            WHERE devices.id = captured_notifications.device_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- 6. Políticas de Seguridad para PAYMENT_FINGERPRINTS (Solo Lectura para Comerciantes)
CREATE POLICY payment_fingerprints_owner_select ON payment_fingerprints
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM devices
            JOIN merchants ON merchants.id = devices.merchant_id
            WHERE devices.id = payment_fingerprints.device_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- 7. Políticas de Seguridad para ENROLLMENT_TOKENS
CREATE POLICY enrollment_tokens_owner_select ON enrollment_tokens
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = enrollment_tokens.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

CREATE POLICY enrollment_tokens_owner_insert ON enrollment_tokens
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = enrollment_tokens.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

