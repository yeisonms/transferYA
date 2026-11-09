# ADR-0006: Pipeline CI/CD Automatizado, Migraciones Supabase y Modelo de Aislamiento RLS

El despliegue a producción de TransferYA se automatiza mediante GitHub Actions aplicando las 4 compuertas de calidad, migraciones declarativas de base de datos en Supabase y aislamiento de datos combinando backend confiable (Service Role) con Row Level Security (RLS) estricto en el panel web.

## Status
Accepted

## Context
Para operar con alta disponibilidad en un SaaS de pagos en tiempo real, el proceso de entrega de software debe eliminar errores humanos manuales. El backend en Vercel gestiona credenciales de máxima sensibilidad (tokens de Meta WhatsApp Cloud API, claves maestras de base de datos) que nunca deben filtrarse en el código fuente ni en artefactos públicos. Al mismo tiempo, la base de datos PostgreSQL en Supabase alberga información transaccional sensible de múltiples comercios que debe permanecer estrictamente aislada.

## Decision
1. **Flujo de Integración y Entrega Continua (GitHub Actions):**
   - **Quality Gate 1 & 2:** En cada Pull Request y push a `main`, se ejecutan en paralelo:
     - Chequeo estático de tipos: `npx tsc --noEmit`.
     - Suite completa de pruebas unitarias y de integración de backend: `npm test` (Vitest).
     - Suite completa de pruebas Android: `gradle test` (JUnit 5 en Kotlin).
     - Si una sola prueba falla, el pipeline cancela el despliegue de inmediato.
   - **Quality Gate 3 & 4 (Build & Release):**
     - Compilación limpia de producción en TypeScript (`npm run build`).
     - Compilación del APK de producción con R8 y firmado automático con Keystore inyectado desde GitHub Secrets.
2. **Migraciones Declarativas en Supabase:**
   - La gestión del esquema de base de datos (`schema.sql`) se versiona como migraciones incrementales aplicadas por la CLI de Supabase (`supabase db push`) en el pipeline de despliegue mediante tokens de servicio seguros.
3. **Aislamiento de Datos y Modelo de Seguridad (RLS vs Service Role):**
   - **Capa Backend / Ingesta:** El Webhook y el Pipeline en Vercel operan como entorno de máxima confianza (`Trusted Backend`) usando la `SUPABASE_SERVICE_ROLE_KEY`. Tienen acceso directo y rápido para consultar secretos de dispositivos, deduplicar huellas de idempotencia y actualizar estados de entrega de WhatsApp.
   - **Capa Dispositivo Centinela:** El teléfono Android **nunca** se conecta directamente a Supabase ni conoce credenciales de base de datos; su único punto de contacto es el Webhook protegido por HMAC-SHA256.
   - **Capa Dashboard / Panel Web:** Para la futura interfaz de administración de los comerciantes, se activan políticas de **Row Level Security (RLS)** obligatorias en todas las tablas (`merchants`, `devices`, `cashier_recipients`, `captured_notifications`, `payment_fingerprints`), asegurando que cada comercio autenticado (`auth.uid() = merchant.owner_id`) solo pueda ver sus propios datos.
4. **Protección de Variables de Entorno de Meta Cloud API:**
   - Las variables sensibles (`META_WHATSAPP_TOKEN`, `META_PHONE_NUMBER_ID`, `SUPABASE_SERVICE_ROLE_KEY`, `WEBHOOK_HMAC_MASTER_KEY`) se configuran exclusivamente en el panel cifrado de Vercel como secretos de entorno de producción. Ninguna variable sensible reside en archivos `.env` versionados en Git.

## Consequences
- **Positivas:**
  - Despliegues a producción con cero intervención manual y garantía de cero regresiones (respaldado por los 107 tests automatizados).
  - Imposibilidad de fuga de credenciales de Meta o Supabase.
  - Aislamiento multi-tenant robusto a nivel de motor de PostgreSQL mediante RLS.
  - Generación automática de artefactos APK release listos para ser distribuidos al primer cliente Alpha.
- **Trade-offs:**
  - Requiere mantener sincronizados los secretos de CI/CD en GitHub y Vercel.

