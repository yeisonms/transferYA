# TransferYA 🇨🇴⚡

> Plataforma B2B SaaS de verificación en tiempo real de transferencias bancarias móviles (Nequi y Daviplata) para comercios físicos en Colombia, con alertas automáticas a cajeros vía WhatsApp (Meta Cloud API).

TransferYA elimina el fraude por comprobantes falsos ("pantallazos editados"), automatiza la confirmación de pagos en el punto de venta y ahorra comisiones de pasarelas de pago tradicionales.

---

## 🏗️ Arquitectura del Sistema (3 Nodos)

```
 [Comprador]
      │ Paga vía Nequi / Daviplata
      ▼
┌────────────────────────────────────────────────────────┐
│ Nodo A: Android Sentinel (App en Teléfono del Negocio)  │
│  - NotificationListenerService (Filtro por paquete)   │
│  - Partial WakeLock (15s) + Foreground Service        │
│  - Cola local SQLite/Room + WorkManager (Offline FIFO) │
│  - Hardware Android KeyStore (Firma HMAC-SHA256)       │
│  - Anti-Tampering (Bloqueo emuladores, telemetría)    │
│  - Enrolamiento Zero-Trust vía QR dinámico            │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTPS POST + HMAC-SHA256 (Anti-Replay)
                           ▼
┌────────────────────────────────────────────────────────┐
│ Nodo B: SaaS Core Backend (Node.js/TypeScript Serverless│
│  - Verificador Criptográfico HMAC-SHA256 (±30s, Nonce) │
│  - Motor Regex Determinista (COP Currency & Name Clean)│
│  - Fingerprinting de Idempotencia (Bucket de 5 min)    │
│  - Enrutamiento Multi-Tenant (Aislamiento por Merchant)│
│  - Monitor de Heartbeat y Detección Stale Alert (>90s) │
│  - Supabase PostgreSQL con Row Level Security (RLS)    │
└──────────────────────────┬─────────────────────────────┘
                           │ Graph API v21+
                           ▼
┌────────────────────────────────────────────────────────┐
│ Nodo C: Despachador WhatsApp (Meta Cloud API)          │
│  - Plantillas de Utilidad Aprobadas por Meta:          │
│    • transferya_payment_alert_v1 (Confirmación Pago)   │
│    • transferya_stale_alert_v1 (Alerta Pago Retrasado) │
│  - Retry con Retroalimentación Exponencial (HTTP 429)  │
└──────────────────────────┬─────────────────────────────┘
                           │ Mensaje Instantáneo
                           ▼
                 [Cajero / Punto de Venta]
```

---

## 🛡️ Pilares de Seguridad y Resiliencia

1. **Autenticación Zero-Trust & Android KeyStore**:
   - El dispositivo Centinela se enrola mediante un QR dinámico con token de un solo uso (TTL: 5 min).
   - El secreto simétrico se genera en el backend y se almacena en el hardware seguro del dispositivo (`AndroidKeyStoreVault`), destruyendo el token de inmediato.
   - Cada notificación entrante se firma con HMAC-SHA256 canónico (`timestamp.nonce.method.path.body`), con ventana de validez de ±30s y deduplicación de nonces (TTL 60s).

2. **Resiliencia Offline y Detección de Pagos Tardíos (Stale Alerts)**:
   - Si el comercio sufre una caída de WiFi/datos, las notificaciones se encolan en SQLite local.
   - Al restaurar la conexión, `WorkManager` despacha la cola en orden FIFO estricto.
   - Si la latencia entre el pago y la entrega supera los 90 segundos (`payment_timestamp` vs `sentinel_timestamp`), se despacha automáticamente la plantilla `transferya_stale_alert_v1` alertando al cajero que debe verificar la fecha y hora antes de entregar mercancía.

3. **Prevención de Duplicados (Fingerprinting)**:
   - Generación determinista de huella digital SHA-256 combinando `amount + wallet + reference + sender_normalized + 5-min bucket`.
   - Normalización de nombres de pagador (remoción de tildes NFD, mayúsculas/minúsculas).
   - Bloqueo en PostgreSQL mediante restricción única `uq_device_payment_fingerprint`.

4. **Multi-Tenancy y Supabase Row Level Security (RLS)**:
   - Aislamiento estricto por comercio (`merchants.owner_id = auth.uid()`).
   - Los comercios solo tienen permisos `SELECT` sobre sus pagos y dispositivos; todas las mutaciones críticas se ejecutan desde el backend con `SUPABASE_SERVICE_ROLE_KEY`.

---

## 📊 Matriz de Pruebas Automatizadas

El proyecto opera bajo metodología estricta **TDD (Red-Green-Refactor)** y **4 Quality Gates**:

| Componente | Framework / Suite | Tests | Estado |
|---|---|:---:|:---:|
| **Protocolo Criptográfico HMAC-SHA256** | Vitest (`hmac-protocol.test.ts`) | 9 | ✅ PASS |
| **Ingesta Webhook & Anti-Replay** | Vitest (`webhook-handler.test.ts`) | 7 | ✅ PASS |
| **Motor de Parsing Nequi & Daviplata** | Vitest (`notification-parser.test.ts`) | 13 | ✅ PASS |
| **Fingerprint Idempotencia (5-min Bucket)**| Vitest (`payment-fingerprint.test.ts`) | 20 | ✅ PASS |
| **Enrutamiento Multi-Tenant & E.164** | Vitest (`merchant-routing.test.ts`) | 12 | ✅ PASS |
| **Cliente Meta WhatsApp Cloud API** | Vitest (`whatsapp-cloud-api.test.ts`) | 12 | ✅ PASS |
| **Pipeline Orquestador E2E** | Vitest (`payment-pipeline.test.ts`) | 6 | ✅ PASS |
| **Simulación E2E Offline Outage (>90s)** | Vitest (`e2e-offline-stale-alert.test.ts`)| 1 | ✅ PASS |
| **Heartbeat & Telemetría Centinela** | Vitest (`heartbeat-handler.test.ts`) | 3 | ✅ PASS |
| **Enrolamiento Zero-Trust QR** | Vitest (`enrollment-handler.test.ts`) | 8 | ✅ PASS |
| **Validación DDL & RLS Supabase** | Vitest (`supabase-schema-rls.test.ts`) | 10 | ✅ PASS |
| **Validación Workflows GitHub Actions** | Vitest (`github-workflows.test.ts`) | 9 | ✅ PASS |
| **Android KeyStore & Criptografía Kotlin**| JUnit 5 (`HmacSignerTest.kt`) | 8 | ✅ PASS |
| **Android Almacenamiento Local SQLite** | JUnit 5 (`SqliteNotificationDaoTest.kt`) | 6 | ✅ PASS |
| **Android Despachador WorkManager** | JUnit 5 (`NotificationDispatcherTest.kt`)| 6 | ✅ PASS |
| **Android Interceptor & WakeLock** | JUnit 5 (`NotificationInterceptorTest.kt`)| 5 | ✅ PASS |
| **Android Onboarding & Enrolamiento QR** | JUnit 5 (`DeviceEnrollmentManagerTest.kt`)| 7 | ✅ PASS |
| **Android Hardening (Emuladores & Root)** | JUnit 5 (`SecurityDetectorsTest.kt`) | 6 | ✅ PASS |
| **TOTAL** | **18 Suites de Pruebas** | **148** | **✅ 100% PASS** |

---

## 🚀 Puesta en Marcha y Comandos

### Requisitos Previos
- Node.js 18+ (recomendado Node 20+)
- Java JDK 17+ y Gradle 8.11+ (para el módulo Android)

### Instalación de Dependencias
```bash
npm install
```

### Ejecutar Pruebas Automatizadas
```bash
# Ejecutar suite completa TypeScript (Vitest)
npm test -- --run

# Compilar TypeScript sin emitir errores
npx tsc --noEmit

# Compilar proyecto TypeScript a dist/
npm run build

# Ejecutar suite completa Android Kotlin (Gradle)
cd android
./gradlew test
```

---

## 📚 Documentación de Arquitectura (ADRs)

Las decisiones técnicas y arquitectónicas están formalizadas en [`docs/adr/`](docs/adr/):
- **[ADR-0001](docs/adr/0001-persistencia-offline-stale-alerts.md)**: Persistencia Offline en Centinela con SQLite/Room, WorkManager y Stale Alerts.
- **[ADR-0002](docs/adr/0002-autenticacion-webhook-anti-spoofing.md)**: Autenticación HMAC-SHA256, Android KeyStore y Mitigación Anti-Replay.
- **[ADR-0003](docs/adr/0003-mitigacion-politicas-bateria-monitoreo.md)**: Mitigación de Políticas de Batería OEM (WakeLock, Foreground Service, Heartbeats).
- **[ADR-0004](docs/adr/0004-flujo-enrolamiento-zero-trust-dispositivos.md)**: Protocolo de Enrolamiento Zero-Trust mediante QR Dinámico y Token Efímero.
- **[ADR-0005](docs/adr/0005-hardening-apk-release-ofuscacion-r8-anti-tampering.md)**: Hardening de APK Release, Ofuscación R8, Detección de Emuladores y Telemetría Root.
- **[ADR-0006](docs/adr/0006-ci-cd-despliegue-vercel-supabase-rls.md)**: Pipeline CI/CD con GitHub Actions, Vercel, Supabase Migrations y RLS.
- **[GLOSSARY.md](GLOSSARY.md)**: Lenguaje ubicuo de dominio de TransferYA.

---

## ⚖️ Licencia

TransferYA Core Platform &copy; 2026. Todos los derechos reservados.
