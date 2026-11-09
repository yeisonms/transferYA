# 09: [Core] Algoritmo de Huella de Idempotencia de Transferencias P2P

**What to build:**
Implementar el generador determinista de la `Huella de Idempotencia` a nivel de transferencia de dinero. A diferencia del `X-Nonce` (que protege la conexión HTTP entre Android y el Webhook), la Huella de Idempotencia protege el proceso de negocio: evita que dos notificaciones del mismo pago físico (por ejemplo, duplicidad de push del banco o push + SMS en ráfaga) generen dos alertas de confirmación a los cajeros en WhatsApp.

**Blocked by:**
08: [Parser] Motor de Parsing de Notificaciones Bancarias (Nequi y Daviplata) con TDD

**Status:**
completed

- [x] Función pura `generatePaymentFingerprint(receipt: ParsedPaymentReceipt, captureTimestamp: number, windowBucketMinutes: number = 5): string`.
- [x] Normalización de remitente (lowercase, eliminación de tildes y espacios múltiples) para que variaciones ortográficas menores no alteren el hash.
- [x] Agrupamiento en ventana de tiempo (*time bucket* de 5 minutos) para absorber fluctuaciones de llegada de red manteniendo unicidad temporal.
- [x] Tabla/repositorio de deduplicación de huellas en base de datos PostgreSQL/Supabase con restricción `UNIQUE (device_id, payment_fingerprint)`.
- [x] Pruebas unitarias comprobando que el mismo pago físico con ligeras variaciones de tiempo dentro de la ventana produce la misma huella, y pagos distintos producen huellas diferentes.

