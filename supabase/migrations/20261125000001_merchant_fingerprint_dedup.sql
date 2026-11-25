-- Migration: 20261125000001_merchant_fingerprint_dedup.sql
-- Description: Agrega merchant_id a payment_fingerprints con unicidad atómica a nivel comercio
--              para impedir pagos duplicados entre cajas físicas y canales híbridos (Centinela + Gmail).

-- 1. Agregar columna merchant_id a payment_fingerprints (idempotente)
ALTER TABLE payment_fingerprints
    ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE;

-- 2. Poblar merchant_id en registros existentes a partir de la tabla devices
UPDATE payment_fingerprints pf
SET merchant_id = d.merchant_id
FROM devices d
WHERE pf.device_id = d.id
  AND pf.merchant_id IS NULL;

-- 3. Eliminar cualquier colisión histórica pre-existente de (merchant_id, payment_fingerprint)
--    conservando siempre el registro más antiguo
DELETE FROM payment_fingerprints pf
USING (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY merchant_id, payment_fingerprint
               ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM payment_fingerprints
    WHERE merchant_id IS NOT NULL
) dup
WHERE pf.id = dup.id
  AND dup.rn > 1;

-- 4. Restricción de unicidad atómica a nivel comercio (previene carreras entre cajas físicas, lambdas y canales)
CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_payment_fingerprint
    ON payment_fingerprints (merchant_id, payment_fingerprint)
    WHERE merchant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_fingerprints_merchant_lookup
    ON payment_fingerprints (merchant_id, payment_fingerprint);

-- 5. Índice compuesto en captured_notifications para acelerar findRecentDuplicatePayment por dispositivo, monto y fecha
CREATE INDEX IF NOT EXISTS idx_captured_notifications_device_amount_captured
    ON captured_notifications (device_id, amount, captured_at DESC);

-- 6. Notificar a PostgREST para recargar caché de esquema
NOTIFY pgrst, 'reload schema';
