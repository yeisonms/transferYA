-- TransferYA PostgreSQL / Supabase Schema Definition
-- Phase 1 & 2: Ingestion, captured notifications, payment idempotency fingerprints, and multi-tenant routing

-- Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabla de Comercios Suscriptores (Ticket 10)
CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, CANCELLED, PENDING_VERIFICATION
    subscription_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants (status);

-- 2. Tabla de Dispositivos Centinela (Node A)
CREATE TABLE IF NOT EXISTS devices (
    id VARCHAR(64) PRIMARY KEY, -- ej: dev_centinela_caja_1
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    secret_hash VARCHAR(128) NOT NULL,
    label VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE, SUSPENDED
    last_heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_merchant ON devices (merchant_id);

-- 3. Tabla de Destinatarios de Caja / Cajeros Autorizados (Ticket 10)
CREATE TABLE IF NOT EXISTS cashier_recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 4. Tabla de Notificaciones Capturadas (Ingesta de Node A)
CREATE TABLE IF NOT EXISTS captured_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    wallet_package VARCHAR(100) NOT NULL,
    raw_title TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    captured_at BIGINT NOT NULL,     -- Epoch ms en Android
    dispatched_at BIGINT NOT NULL,   -- Epoch ms en Android
    received_at BIGINT NOT NULL,     -- Epoch ms en Backend
    latency_ms BIGINT NOT NULL,
    is_stale BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED', -- RECEIVED, PROCESSING, PROCESSED, FAILED
    amount BIGINT,
    sender_name VARCHAR(255),
    payment_reference VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_captured_notifications_device_status 
    ON captured_notifications (device_id, status);
CREATE INDEX IF NOT EXISTS idx_captured_notifications_created_at 
    ON captured_notifications (created_at DESC);

-- 5. Tabla de Huellas de Idempotencia de Transferencias P2P (Ticket 09)
-- Restricción crítica: Evita duplicidad de alertas de WhatsApp si un pago se notifica múltiples veces (Push + SMS)
CREATE TABLE IF NOT EXISTS payment_fingerprints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    payment_fingerprint VARCHAR(64) NOT NULL, -- SHA-256 Hex
    wallet VARCHAR(20) NOT NULL,              -- NEQUI, DAVIPLATA
    amount BIGINT NOT NULL,                   -- Monto exacto en COP
    sender_name VARCHAR(255) NOT NULL,        -- Nombre normalizado
    captured_at BIGINT NOT NULL,              -- Epoch ms de la captura
    notification_id UUID REFERENCES captured_notifications(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Restricción de unicidad estricta por Centinela para evitar colisiones entre comercios
    CONSTRAINT uq_device_payment_fingerprint UNIQUE (device_id, payment_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_payment_fingerprints_lookup 
    ON payment_fingerprints (device_id, payment_fingerprint);
CREATE INDEX IF NOT EXISTS idx_payment_fingerprints_created_at 
    ON payment_fingerprints (created_at DESC);

-- 6. Tabla de Tokens de Enrolamiento Zero-Trust (Ticket 13)
-- Tokens efímeros (TTL 5 min) para escaneo de código QR y entrega segura del Device Secret
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
