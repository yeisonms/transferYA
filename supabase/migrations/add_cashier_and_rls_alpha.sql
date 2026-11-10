-- ====================================================================
-- TransferYA - Registro de Cajero y Ajuste de Políticas RLS para Piloto
-- Fecha: 2026-11-09
-- ====================================================================

-- 1. Asegurar la existencia del Comercio Piloto
INSERT INTO merchants (id, owner_id, name, status)
VALUES ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'Comercio Piloto Alpha', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 2. Registrar el número de WhatsApp como Cajero Principal
INSERT INTO cashier_recipients (merchant_id, name, phone_number, is_active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'Cajero Principal', '+573113654315', true);

-- 3. Habilitar políticas permisivas para el Gateway / Pipeline durante el Piloto Alpha
DROP POLICY IF EXISTS "alpha_service_cashier_recipients" ON cashier_recipients;
CREATE POLICY "alpha_service_cashier_recipients" ON cashier_recipients FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "alpha_service_merchants" ON merchants;
CREATE POLICY "alpha_service_merchants" ON merchants FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "alpha_service_devices" ON devices;
CREATE POLICY "alpha_service_devices" ON devices FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "alpha_service_captured_notifications" ON captured_notifications;
CREATE POLICY "alpha_service_captured_notifications" ON captured_notifications FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "alpha_service_payment_fingerprints" ON payment_fingerprints;
CREATE POLICY "alpha_service_payment_fingerprints" ON payment_fingerprints FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "alpha_service_enrollment_tokens" ON enrollment_tokens;
CREATE POLICY "alpha_service_enrollment_tokens" ON enrollment_tokens FOR ALL TO anon USING (true) WITH CHECK (true);

