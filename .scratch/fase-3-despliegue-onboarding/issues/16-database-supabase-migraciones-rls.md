# 16: [Database] Migraciones Supabase DDL y Políticas de Aislamiento Row Level Security (RLS)

**What to build:**
Generar el conjunto estructurado de migraciones declarativas SQL para Supabase (compatible con la CLI de Supabase) que crea todas las tablas del sistema (`merchants`, `devices`, `cashier_recipients`, `captured_notifications`, `payment_fingerprints`, `enrollment_tokens`), los índices optimizados y las políticas de Row Level Security (RLS) para aislamiento multi-tenant estricto entre comercios, garantizando que el rol `service_role` (utilizado por el backend de Vercel) mantenga acceso sin restricciones operativas.

**Blocked by:**
13: [Backend & DB] Módulo de Enrolamiento Zero-Trust (QR Tokens y Handshake Criptográfico)

**Status:**
completed

- [x] Archivos de migración versionados en `supabase/migrations/` con DDL completo idempotente.
- [x] Activación de RLS (`ENABLE ROW LEVEL SECURITY`) en todas las tablas transaccionales.
- [x] Políticas RLS para consultas y mutaciones de comerciantes autenticados basadas en `auth.uid() = merchants.owner_id`.
- [x] Políticas para la tabla `captured_notifications` permitiendo solo lectura (`SELECT`) a comercios suscritos sobre sus propios eventos.
- [x] Script o pruebas automatizadas de verificación de políticas RLS y restricciones de unicidad.

