# 07: [E2E] Telemetría Heartbeat (Cada 5 min) y Detección de Salud del Centinela en Backend

**What to build:**
Implementar el ciclo completo de telemetría y pruebas de integración end-to-end: un worker/emisor periódico en Android que emite cada 5 minutos un `Heartbeat` firmado al backend (`/api/v1/devices/heartbeat`) reportando nivel de batería y estado de red, un backend que registra la salud del Centinela y detecta caídas prolongadas (>10 min), y una prueba E2E que simula un corte de red de 2 minutos para verificar que una notificación retenida offline se despacha con éxito y se cataloga como `STALE_ALERT` sin perderse.

**Blocked by:**
02: [Backend] Endpoint Webhook de Ingesta con Verificación HMAC, Ventana de Tiempo y Anti-Replay
03: [Android] Gestor de Claves Criptográficas en Android KeyStore y Generador de Firmas HMAC
06: [Android] Interceptor Nativo de Notificaciones con Foreground Service y Partial WakeLock de 15s

**Status:**
completed

- [x] Emisor de telemetría en Android (`HeartbeatEmitter`) que envía POST `/api/v1/devices/heartbeat` con telemetría: `battery_level`, `is_charging`, `network_type`, `app_version` y firma HMAC.
- [x] Endpoint `/api/v1/devices/heartbeat` en backend (`DeviceHeartbeatHandler`) con validación de firma HMAC idéntica al webhook y actualización de `lastSeenAt` del dispositivo a estado `ONLINE`.
- [x] Tarea en backend (`checkOfflineDevices`) que detecta y lista dispositivos en estado `OFFLINE` si `now - lastSeenAt > 10 minutos` (600.000 ms) según ADR-0003.
- [x] Prueba de integración E2E simulando modo avión / desconexión de red de 120s: inyectar notificación, esperar 120 segundos simulados, restablecer red, ejecutar worker y verificar que la notificación se inserta en el backend con `is_stale = true` y `dispatched_at - captured_at >= 120000ms`.
