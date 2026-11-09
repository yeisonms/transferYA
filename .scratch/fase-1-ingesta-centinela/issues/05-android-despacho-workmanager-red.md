# 05: [Android] Orquestador de Despacho de Red con WorkManager y Política de Conectividad

**What to build:**
Implementar el worker asíncrono `NotificationDispatchWorker` / `NotificationDispatcher` utilizando la política de conectividad activa (`NetworkType.CONNECTED`) y backoff exponencial, que extrae registros `PENDING` de Room/SQLite, los firma con el KeyStore Manager, ejecuta el HTTP POST al Webhook y actualiza el estado local atómicamente a `DISPATCHED` con el `dispatched_at` real.

**Blocked by:**
02: [Backend] Endpoint Webhook de Ingesta con Verificación HMAC, Ventana de Tiempo y Anti-Replay
03: [Android] Gestor de Claves Criptográficas en Android KeyStore y Generador de Firmas HMAC
04: [Android] Almacenamiento Local Offline con Room (DAO, Entidad y Estados PENDING/DISPATCHED/FAILED)

**Status:**
completed

- [x] Definición de `NotificationDispatcher` y contratos desacoplados (`ISentinelHttpClient`, `IConnectivityProvider`).
- [x] Lógica de despacho: lectura de registros `PENDING`, serialización a JSON con escape seguro, cálculo de timestamp/nonce/firma HMAC con el KeyStore Manager, y emisión del POST HTTP.
- [x] Tratamiento de respuestas: si el Webhook responde HTTP 200/201/202, actualizar SQLite/Room a `DISPATCHED` con el `dispatched_at` actual.
- [x] Política de reintentos: si ocurre error de red o HTTP 5xx, retornar `DispatchResult.Retry` con backoff e incremento en `retryCount`; si ocurre error fatal 4xx (401/403), retornar `DispatchResult.FatalFailure`.
- [x] Pruebas unitarias/integración con SQLite en memoria simulando caídas de red, timeouts, errores 5xx, errores 4xx y respuestas exitosas 202.
