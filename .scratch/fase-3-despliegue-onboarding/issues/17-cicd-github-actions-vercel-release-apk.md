# 17: [CI/CD & Release] Pipelines de GitHub Actions (Backend Vercel Deploy & Android Release APK)

**What to build:**
Implementar los flujos de automatización CI/CD con GitHub Actions para garantizar despliegues seguros y reproducibles en producción. Configura el workflow de verificación continua que ejecuta en paralelo los 4 Quality Gates (Typecheck, Vitest, Gradle JUnit 5 y Build), el despliegue automático del backend a Vercel con variables de entorno inyectadas de forma segura, y el workflow de compilación y firmado del APK de producción del Centinela con R8 activado para distribución.

**Blocked by:**
15: [Android Hardening] Detección de Emuladores, Telemetría de Root y Reglas R8/ProGuard
16: [Database] Migraciones Supabase DDL y Políticas de Aislamiento Row Level Security (RLS)

**Status:**
ready-for-agent

- [ ] Workflow `.github/workflows/ci.yml`: ejecución automatizada de Quality Gates (TypeScript + Vitest + Gradle).
- [ ] Job de despliegue a Vercel (`vercel pull`, `vercel build`, `vercel deploy --prod`) con variables de entorno enlazadas a GitHub Secrets.
- [ ] Workflow `.github/workflows/android-release.yml`: compilación de APK release con R8 activado, firmado criptográfico mediante Keystore en base64 y generación de artefacto descargable.
- [ ] Pruebas locales de validación de sintaxis y ejecución de scripts de CI/CD.

