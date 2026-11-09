# 02: [Backend] Endpoint Webhook de Ingesta con Verificación HMAC, Ventana de Tiempo y Anti-Replay

**What to build:**
Exponer el endpoint HTTP POST `/api/v1/webhooks/notifications` en el backend para recibir las notificaciones capturadas por los Centinelas. El endpoint valida las cabeceras de seguridad (`X-Device-Id`, `X-Timestamp`, `X-Nonce`, `X-Signature`), recupera el secreto del dispositivo en la base de datos (PostgreSQL/Supabase), verifica la ventana temporal de 30s, descarta nonces repetidos en memoria/caché con TTL de 60s, valida la firma HMAC-SHA256, calcula el flag `is_stale` si `now - captured_at > 90s`, y almacena el evento crudo en la tabla `captured_notifications` con estado `RECEIVED`.

**Blocked by:**
01: [Protocol] Especificación del Contrato de Ingesta y Validador Criptográfico HMAC-SHA256

**Status:**
completed

- [x] Validación de cabeceras requeridas; respuesta HTTP 401 Unauthorized si falta alguna o si el `X-Device-Id` no existe en la base de datos.
- [x] Validación de ventana de tiempo: rechazo con HTTP 401 Unauthorized (`TIMESTAMP_DRIFT_EXCEEDED`) si `abs(server_time - X-Timestamp) > 30000ms`.
- [x] Mecanismo anti-replay: memoria/tabla efímera de nonces con TTL de 60s; rechazo con HTTP 409 Conflict si el `X-Nonce` ya fue recibido.
- [x] Verificación de la firma `X-Signature` contra el secreto del dispositivo; rechazo 401 si la firma no coincide exactamente.
- [x] Cálculo de latencia: `latency_ms = now - captured_at`. Si `latency_ms > 90000ms`, marcar campo `is_stale = true`.
- [x] Persistencia del evento en la base de datos relacional con estado `RECEIVED` e idempotencia a nivel de transacción.
- [x] Suite de pruebas de integración y unitarias (Vitest) cubriendo todos los escenarios de ataque (replay, timestamps expirados, firmas manipuladas, payloads válidos).
