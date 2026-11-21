-- Migración: Soporte para Nurture, Bienvenida y Recordatorios Preventivos de Prueba Gratuita (Trial)
-- Fase: Conversión Comercial y Retención Automática

ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS trial_welcome_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trial_day5_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trial_day7_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_merchants_trial_status
    ON merchants (subscription_status, subscription_ends_at)
    WHERE subscription_status = 'TRIAL';
