-- ==============================================================================
-- Migration: 20261121000001_plans_limits_usage_schema.sql
-- Description: Fase 3 - Catálogo oficial de planes (`subscription_plans`),
--              límites y cuotas de consumo en `merchants`, add-ons (`merchant_addons`),
--              auditoría de costos de WhatsApp (`whatsapp_usage_logs`) y blindaje RLS.
-- ==============================================================================

-- 1. Crear tabla de catálogo oficial de planes
CREATE TABLE IF NOT EXISTS subscription_plans (
    id VARCHAR(30) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    badge VARCHAR(50),
    highlighted BOOLEAN NOT NULL DEFAULT FALSE,
    price_monthly_cop BIGINT NOT NULL,
    price_annual_cop BIGINT NOT NULL,
    annual_effective_monthly_cop BIGINT NOT NULL,
    annual_savings_cop BIGINT NOT NULL,
    max_whatsapp_cashiers INT NOT NULL DEFAULT 1,
    monthly_alerts_cap INT NOT NULL DEFAULT 1500,
    max_branches_or_devices INT NOT NULL DEFAULT 1,
    cloud_email_fallback BOOLEAN NOT NULL DEFAULT FALSE,
    web_pos_live_screen BOOLEAN NOT NULL DEFAULT FALSE,
    ios_shortcut_webhook BOOLEAN NOT NULL DEFAULT FALSE,
    branch_routing BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Inserción idempotente de los 3 planes oficiales
INSERT INTO subscription_plans (
    id, name, badge, highlighted, price_monthly_cop, price_annual_cop,
    annual_effective_monthly_cop, annual_savings_cop, max_whatsapp_cashiers,
    monthly_alerts_cap, max_branches_or_devices, cloud_email_fallback,
    web_pos_live_screen, ios_shortcut_webhook, branch_routing
) VALUES
    ('emprendedor', 'Emprendedor', NULL, FALSE, 29900, 299000, 24917, 59800, 1, 1500, 1, FALSE, FALSE, FALSE, FALSE),
    ('negocio', 'Negocio', 'Más popular', TRUE, 49900, 499000, 41583, 99800, 2, 3500, 1, TRUE, TRUE, TRUE, FALSE),
    ('pro', 'Pro Multi-Caja', 'Multi-Sede', FALSE, 89900, 899000, 74917, 179800, 4, 7500, 3, TRUE, TRUE, TRUE, TRUE)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    badge = EXCLUDED.badge,
    highlighted = EXCLUDED.highlighted,
    price_monthly_cop = EXCLUDED.price_monthly_cop,
    price_annual_cop = EXCLUDED.price_annual_cop,
    annual_effective_monthly_cop = EXCLUDED.annual_effective_monthly_cop,
    annual_savings_cop = EXCLUDED.annual_savings_cop,
    max_whatsapp_cashiers = EXCLUDED.max_whatsapp_cashiers,
    monthly_alerts_cap = EXCLUDED.monthly_alerts_cap,
    max_branches_or_devices = EXCLUDED.max_branches_or_devices,
    cloud_email_fallback = EXCLUDED.cloud_email_fallback,
    web_pos_live_screen = EXCLUDED.web_pos_live_screen,
    ios_shortcut_webhook = EXCLUDED.ios_shortcut_webhook,
    branch_routing = EXCLUDED.branch_routing,
    updated_at = NOW();

-- 3. Extender tabla `merchants` con campos de plan y cuota de alertas
ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS plan_id VARCHAR(30) REFERENCES subscription_plans(id) DEFAULT 'emprendedor',
    ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(10) NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual')),
    ADD COLUMN IF NOT EXISTS monthly_alerts_used INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS monthly_alerts_cap INT NOT NULL DEFAULT 1500,
    ADD COLUMN IF NOT EXISTS alerts_reset_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days');

CREATE INDEX IF NOT EXISTS idx_merchants_plan
    ON merchants (plan_id, subscription_status);

-- 4. Crear tabla de Add-ons contratados por comercio
CREATE TABLE IF NOT EXISTS merchant_addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    addon_id VARCHAR(50) NOT NULL,
    billing_type VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (billing_type IN ('monthly', 'one_time')),
    adds_whatsapp_cashiers INT NOT NULL DEFAULT 0,
    adds_monthly_alerts INT NOT NULL DEFAULT 0,
    price_cop BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'CANCELLED')),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchant_addons_lookup
    ON merchant_addons (merchant_id, status);

-- 5. Crear tabla de auditoría de costos de WhatsApp (`whatsapp_usage_logs`)
CREATE TABLE IF NOT EXISTS whatsapp_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    cashier_phone VARCHAR(25) NOT NULL,
    wamid VARCHAR(100),
    category VARCHAR(30) NOT NULL DEFAULT 'utility',
    estimated_cost_cop NUMERIC(8,2) NOT NULL DEFAULT 2.95,
    status VARCHAR(30) NOT NULL DEFAULT 'sent',
    notification_id UUID REFERENCES captured_notifications(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_merchant_created
    ON whatsapp_usage_logs (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_wamid
    ON whatsapp_usage_logs (wamid);

-- 6. Habilitar Row Level Security (RLS) en todas las nuevas tablas
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_usage_logs ENABLE ROW LEVEL SECURITY;

-- 7. Políticas de lectura y seguridad RLS
-- subscription_plans: catálogo público de lectura para todos los autenticados y anónimos
DROP POLICY IF EXISTS "public_read_subscription_plans" ON subscription_plans;
CREATE POLICY "public_read_subscription_plans"
    ON subscription_plans
    FOR SELECT
    TO public
    USING (true);

DROP POLICY IF EXISTS "service_role_manage_subscription_plans" ON subscription_plans;
CREATE POLICY "service_role_manage_subscription_plans"
    ON subscription_plans
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- merchant_addons: lectura aislada para el dueño del comercio
DROP POLICY IF EXISTS "merchants_view_own_addons" ON merchant_addons;
CREATE POLICY "merchants_view_own_addons"
    ON merchant_addons
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM merchants m
            WHERE m.id = merchant_addons.merchant_id
              AND m.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "service_role_manage_merchant_addons" ON merchant_addons;
CREATE POLICY "service_role_manage_merchant_addons"
    ON merchant_addons
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- whatsapp_usage_logs: lectura aislada para el dueño del comercio
DROP POLICY IF EXISTS "merchants_view_own_whatsapp_logs" ON whatsapp_usage_logs;
CREATE POLICY "merchants_view_own_whatsapp_logs"
    ON whatsapp_usage_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM merchants m
            WHERE m.id = whatsapp_usage_logs.merchant_id
              AND m.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "service_role_manage_whatsapp_logs" ON whatsapp_usage_logs;
CREATE POLICY "service_role_manage_whatsapp_logs"
    ON whatsapp_usage_logs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 8. Actualizar trigger anti-tampering en `merchants` protegiendo plan y consumo
CREATE OR REPLACE FUNCTION prevent_merchant_billing_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    jwt_role TEXT := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), current_user);
BEGIN
    IF jwt_role = 'authenticated' THEN
        IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
           OR NEW.subscription_ends_at IS DISTINCT FROM OLD.subscription_ends_at
           OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
           OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
           OR NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle
           OR NEW.monthly_alerts_used IS DISTINCT FROM OLD.monthly_alerts_used
           OR NEW.monthly_alerts_cap IS DISTINCT FROM OLD.monthly_alerts_cap
           OR NEW.alerts_reset_at IS DISTINCT FROM OLD.alerts_reset_at THEN
            RAISE EXCEPTION 'No autorizado: los campos comerciales de suscripción y límites solo pueden modificarse desde la Admin API o backend.'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 9. Trigger anti-tampering para `merchant_addons` (solo modificable por backend / Admin)
CREATE OR REPLACE FUNCTION prevent_merchant_addons_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    jwt_role TEXT := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), current_user);
BEGIN
    IF jwt_role = 'authenticated' THEN
        RAISE EXCEPTION 'No autorizado: los add-ons solo pueden activarse o modificarse desde el backend o Admin API.'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_merchant_addons_tampering ON merchant_addons;
CREATE TRIGGER trg_prevent_merchant_addons_tampering
    BEFORE INSERT OR UPDATE OR DELETE ON merchant_addons
    FOR EACH ROW
    EXECUTE FUNCTION prevent_merchant_addons_tampering();
