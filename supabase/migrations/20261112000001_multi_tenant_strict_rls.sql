-- ==============================================================================
-- Migration: 20261112000001_multi_tenant_strict_rls.sql
-- Description: Paso 4 - Restaura el aislamiento estricto Multi-Comercio (RLS)
--              eliminando las políticas abiertas del Piloto Alpha (`alpha_service_*`).
--
-- PRERREQUISITO CRITICO ANTES DE EJECUTAR EN PRODUCCION:
--   1. Configura `SUPABASE_SERVICE_ROLE_KEY` en Vercel -> Settings -> Environment Variables
--      (para que el Webhook HMAC / Enroll / Heartbeat / Reset sigan operando como Backend Confiable).
--   2. Inicia sesión o crea tu usuario en TransferYA Web con tu correo.
--   3. Descomenta y ejecuta el UPDATE del final reemplazando tu correo para reclamar
--      la propiedad de `Comercio Piloto Alpha` (`a0000000-0000-0000-0000-000000000001`).
-- ==============================================================================

-- 1. Eliminar políticas temporales permisivas (anon) del Piloto Alpha
DROP POLICY IF EXISTS "alpha_service_cashier_recipients" ON cashier_recipients;
DROP POLICY IF EXISTS "alpha_service_merchants" ON merchants;
DROP POLICY IF EXISTS "alpha_service_devices" ON devices;
DROP POLICY IF EXISTS "alpha_service_captured_notifications" ON captured_notifications;
DROP POLICY IF EXISTS "alpha_service_payment_fingerprints" ON payment_fingerprints;
DROP POLICY IF EXISTS "alpha_service_enrollment_tokens" ON enrollment_tokens;

-- 2. Garantizar RLS habilitado en las 6 tablas
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashier_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE captured_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_tokens ENABLE ROW LEVEL SECURITY;

-- 3. Políticas estrictas para MERCHANTS (lectura, auto-registro inicial y actualización del dueño)
DROP POLICY IF EXISTS merchants_owner_select ON merchants;
CREATE POLICY merchants_owner_select ON merchants
    FOR SELECT
    TO authenticated
    USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS merchants_owner_insert ON merchants;
CREATE POLICY merchants_owner_insert ON merchants
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS merchants_owner_update ON merchants;
CREATE POLICY merchants_owner_update ON merchants
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 4. Políticas estrictas para DEVICES (el comercio solo lee y actualiza etiquetas/estado de sus cajas)
DROP POLICY IF EXISTS devices_owner_select ON devices;
CREATE POLICY devices_owner_select ON devices
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = devices.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS devices_owner_update ON devices;
CREATE POLICY devices_owner_update ON devices
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = devices.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = devices.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- 5. Políticas estrictas para CASHIER_RECIPIENTS
DROP POLICY IF EXISTS cashier_recipients_owner_all ON cashier_recipients;
CREATE POLICY cashier_recipients_owner_all ON cashier_recipients
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = cashier_recipients.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = cashier_recipients.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- 6. Políticas estrictas para CAPTURED_NOTIFICATIONS (Solo Lectura para comercios)
DROP POLICY IF EXISTS captured_notifications_owner_select ON captured_notifications;
CREATE POLICY captured_notifications_owner_select ON captured_notifications
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM devices
            JOIN merchants ON merchants.id = devices.merchant_id
            WHERE devices.id = captured_notifications.device_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- 7. Políticas estrictas para PAYMENT_FINGERPRINTS (Solo Lectura para comercios)
DROP POLICY IF EXISTS payment_fingerprints_owner_select ON payment_fingerprints;
CREATE POLICY payment_fingerprints_owner_select ON payment_fingerprints
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM devices
            JOIN merchants ON merchants.id = devices.merchant_id
            WHERE devices.id = payment_fingerprints.device_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- 8. Políticas estrictas para ENROLLMENT_TOKENS
DROP POLICY IF EXISTS enrollment_tokens_owner_select ON enrollment_tokens;
CREATE POLICY enrollment_tokens_owner_select ON enrollment_tokens
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = enrollment_tokens.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS enrollment_tokens_owner_insert ON enrollment_tokens;
CREATE POLICY enrollment_tokens_owner_insert ON enrollment_tokens
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = enrollment_tokens.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- 9. Garantizar publicación en Supabase Realtime para notificaciones y dispositivos
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'captured_notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE captured_notifications;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'devices'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE devices;
    END IF;
END $$;

-- ==============================================================================
-- 10. ASIGNAR PROPIEDAD DEL COMERCIO PILOTO ALPHA A TU CUENTA DE USUARIO REAL:
-- Reemplaza 'tu-correo@ejemplo.com' por el correo con el que te registraste en TransferYA:
--
-- UPDATE merchants
-- SET owner_id = (SELECT id FROM auth.users WHERE email = 'tu-correo@ejemplo.com' LIMIT 1)
-- WHERE id = 'a0000000-0000-0000-0000-000000000001';
-- ==============================================================================
