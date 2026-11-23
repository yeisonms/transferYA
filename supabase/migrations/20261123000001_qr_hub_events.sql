-- ============================================================================
-- Migración: Registro de Métricas Ligeras para Página Puente QR (/go)
-- Ticket: QR Volanteo Hub (Métricas No Bloqueantes)
-- ============================================================================

CREATE TABLE IF NOT EXISTS qr_hub_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    zone TEXT DEFAULT 'general',
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE qr_hub_events ENABLE ROW LEVEL SECURITY;

-- Política de inserción anónima para recolección ligera y no bloqueante
DROP POLICY IF EXISTS "Permitir insercion anonima de eventos QR" ON qr_hub_events;
CREATE POLICY "Permitir insercion anonima de eventos QR"
    ON qr_hub_events
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Política de lectura restringida únicamente al rol de servicio / administradores
DROP POLICY IF EXISTS "Permitir lectura de eventos QR a service_role" ON qr_hub_events;
CREATE POLICY "Permitir lectura de eventos QR a service_role"
    ON qr_hub_events
    FOR SELECT
    TO service_role
    USING (true);

-- Índices para analítica agregada rápida por tipo de evento, zona y fecha
CREATE INDEX IF NOT EXISTS idx_qr_hub_events_type_created ON qr_hub_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qr_hub_events_zone ON qr_hub_events (zone);
