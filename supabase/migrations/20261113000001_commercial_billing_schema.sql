-- ==============================================================================
-- Migration: 20261113000001_commercial_billing_schema.sql
-- Description: Ticket 18 (Fase 3) - Extiende `merchants` con el motor comercial
--              (`subscription_status`, `subscription_ends_at`, `billing_phone`)
--              y protege las columnas de facturación frente a manipulación desde RLS.
-- ==============================================================================

-- 1. Crear ENUM comercial de forma idempotente
DO $$
BEGIN
    CREATE TYPE subscription_status_enum AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. Extender tabla `merchants` con campos comerciales
ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS subscription_status subscription_status_enum NOT NULL DEFAULT 'TRIAL',
    ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    ADD COLUMN IF NOT EXISTS billing_phone VARCHAR(25);

-- 3. Backfill idempotente desde columnas heredadas (`status` y `subscription_expires_at`)
UPDATE merchants
SET
    subscription_ends_at = COALESCE(subscription_expires_at, subscription_ends_at, NOW() + INTERVAL '7 days'),
    subscription_status = CASE
        WHEN status IN ('SUSPENDED', 'CANCELLED') THEN 'SUSPENDED'::subscription_status_enum
        WHEN subscription_expires_at IS NOT NULL AND subscription_expires_at < NOW() THEN 'PAST_DUE'::subscription_status_enum
        WHEN subscription_expires_at IS NOT NULL AND subscription_expires_at >= NOW() THEN 'ACTIVE'::subscription_status_enum
        ELSE subscription_status
    END
WHERE subscription_expires_at IS NOT NULL
   OR status IN ('SUSPENDED', 'CANCELLED');

-- 4. Índice para consultas del panel administrativo y detección de vencimientos
CREATE INDEX IF NOT EXISTS idx_merchants_subscription
    ON merchants (subscription_status, subscription_ends_at);

-- 5. Blindaje anti-fraude: impedir que sesiones `authenticated` alteren campos de facturación
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
           OR NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'No autorizado: los campos de suscripción solo pueden modificarse desde la Admin API.'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_merchant_billing_tampering ON merchants;
CREATE TRIGGER trg_prevent_merchant_billing_tampering
    BEFORE UPDATE ON merchants
    FOR EACH ROW
    EXECUTE FUNCTION prevent_merchant_billing_tampering();
