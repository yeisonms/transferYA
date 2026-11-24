-- Migración: Tabla de Suscripciones Web Push (Fase 2)
-- Permite recibir alertas en segundo plano / pantalla bloqueada en celulares y PC sin app nativa

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices optimizados
CREATE INDEX IF NOT EXISTS idx_web_push_merchant_id ON web_push_subscriptions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_web_push_endpoint ON web_push_subscriptions(endpoint);

-- Habilitar Row Level Security (RLS)
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Política para service_role (Backend / Servidor)
CREATE POLICY "web_push_subscriptions_service_role"
    ON web_push_subscriptions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Política para usuarios autenticados (Dueños de comercios)
CREATE POLICY "web_push_subscriptions_authenticated"
    ON web_push_subscriptions
    FOR ALL
    TO authenticated
    USING (
        merchant_id IN (
            SELECT id FROM merchants WHERE owner_id = auth.uid()
        )
    )
    WITH CHECK (
        merchant_id IN (
            SELECT id FROM merchants WHERE owner_id = auth.uid()
        )
    );
