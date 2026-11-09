-- ==============================================================================
-- TransferYA Core Database Schema & Row Level Security (RLS)
-- Target Project: https://yljfzscbxhwdflpkcboy.supabase.co
-- ==============================================================================

-- 1. Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Tabla de Comercios Suscriptores
CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL, -- auth.users(id) del propietario del comercio
    name VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, CANCELLED, PENDING_VERIFICATION
    subscription_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants (status);
CREATE INDEX IF NOT EXISTS idx_merchants_owner ON merchants (owner_id);

-- 3. Tabla de Dispositivos Centinela (Node A)
CREATE TABLE IF NOT EXISTS devices (
    id VARCHAR(64) PRIMARY KEY, -- ej: dev_centinela_caja_1
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    secret_hash VARCHAR(128) NOT NULL,
    label VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE, SUSPENDED, REVOKED
    last_heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_merchant ON devices (merchant_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices (status);

-- 4. Tabla de Destinatarios de Caja (Cajeros y Supervisores)
CREATE TABLE IF NOT EXISTS cashier_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    device_id VARCHAR(64) REFERENCES devices(id) ON DELETE SET NULL, -- NULL = Aplica a todas las cajas
    name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(25) NOT NULL, -- Formato E.164 (ej: +573001234567)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cashier_recipients_merchant ON cashier_recipients (merchant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_cashier_recipients_device ON cashier_recipients (device_id);

-- 5. Tabla de Notificaciones Capturadas (Ingesta de Node A)
CREATE TABLE IF NOT EXISTS captured_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    wallet_package VARCHAR(100) NOT NULL,
    raw_title TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    captured_at BIGINT NOT NULL,     -- Epoch ms en Android
    dispatched_at BIGINT NOT NULL,   -- Epoch ms en Android
    received_at BIGINT NOT NULL,     -- Epoch ms en Backend
    latency_ms BIGINT NOT NULL,
    is_stale BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED', -- RECEIVED, PROCESSING, PROCESSED, IGNORED_NON_PAYMENT, DUPLICATE_PAYMENT, ROUTING_FAILED, DISPATCH_FAILED, FAILED
    amount BIGINT,
    sender_name VARCHAR(255),
    payment_reference VARCHAR(100),
    whatsapp_message_ids TEXT[],
    processed_at BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_captured_notifications_device_status 
    ON captured_notifications (device_id, status);
CREATE INDEX IF NOT EXISTS idx_captured_notifications_created_at 
    ON captured_notifications (created_at DESC);

-- 6. Tabla de Huellas de Idempotencia de Transferencias P2P
CREATE TABLE IF NOT EXISTS payment_fingerprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    payment_fingerprint VARCHAR(64) NOT NULL, -- SHA-256 Hex
    wallet VARCHAR(20) NOT NULL,              -- NEQUI, DAVIPLATA
    amount BIGINT NOT NULL,                   -- Monto exacto en COP
    sender_name VARCHAR(255) NOT NULL,        -- Nombre normalizado
    captured_at BIGINT NOT NULL,              -- Epoch ms de la captura
    notification_id UUID REFERENCES captured_notifications(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Restricción crítica: unicidad estricta por Dispositivo Centinela para evitar duplicar alertas
    CONSTRAINT uq_device_payment_fingerprint UNIQUE (device_id, payment_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_payment_fingerprints_lookup 
    ON payment_fingerprints (device_id, payment_fingerprint);
CREATE INDEX IF NOT EXISTS idx_payment_fingerprints_created_at 
    ON payment_fingerprints (created_at DESC);

-- 7. Tabla de Tokens de Enrolamiento Zero-Trust
CREATE TABLE IF NOT EXISTS enrollment_tokens (
    token VARCHAR(64) PRIMARY KEY, -- 32 bytes hex
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    device_id VARCHAR(64) NOT NULL,
    label VARCHAR(100),
    expires_at BIGINT NOT NULL,     -- Epoch ms
    is_consumed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL      -- Epoch ms
);

CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_lookup 
    ON enrollment_tokens (token, is_consumed);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_device 
    ON enrollment_tokens (device_id);

-- ==============================================================================
-- 8. Row Level Security (RLS) - Aislamiento Multi-Tenant (ADR-0006)
-- ==============================================================================

ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashier_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE captured_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_tokens ENABLE ROW LEVEL SECURITY;

-- Políticas para MERCHANTS
CREATE POLICY merchants_owner_select ON merchants
    FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY merchants_owner_update ON merchants
    FOR UPDATE USING (auth.uid() = owner_id);

-- Políticas para DEVICES
CREATE POLICY devices_owner_select ON devices
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = devices.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

CREATE POLICY devices_owner_update ON devices
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = devices.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- Políticas para CASHIER_RECIPIENTS
CREATE POLICY cashier_recipients_owner_all ON cashier_recipients
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = cashier_recipients.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- Políticas para CAPTURED_NOTIFICATIONS (Solo lectura para merchants, backend usa service_role)
CREATE POLICY captured_notifications_owner_select ON captured_notifications
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM devices
            JOIN merchants ON merchants.id = devices.merchant_id
            WHERE devices.id = captured_notifications.device_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- Políticas para PAYMENT_FINGERPRINTS (Solo lectura para merchants, backend usa service_role)
CREATE POLICY payment_fingerprints_owner_select ON payment_fingerprints
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM devices
            JOIN merchants ON merchants.id = devices.merchant_id
            WHERE devices.id = payment_fingerprints.device_id
              AND merchants.owner_id = auth.uid()
        )
    );

-- Políticas para ENROLLMENT_TOKENS
CREATE POLICY enrollment_tokens_owner_select ON enrollment_tokens
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = enrollment_tokens.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );

CREATE POLICY enrollment_tokens_owner_insert ON enrollment_tokens
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM merchants
            WHERE merchants.id = enrollment_tokens.merchant_id
              AND merchants.owner_id = auth.uid()
        )
    );
