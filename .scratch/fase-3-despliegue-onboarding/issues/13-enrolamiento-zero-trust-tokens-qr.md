# 13: [Backend & DB] Módulo de Enrolamiento Zero-Trust (QR Tokens y Handshake Criptográfico)

**What to build:**
Implementar el módulo de backend para la ceremonia de enrolamiento Zero-Trust de Dispositivos Centinela. Permite generar tokens de enrolamiento temporales (`enrollment_token`, TTL 5 minutos, consumo único) para proyectar en códigos QR desde el panel administrativo, y provee el endpoint seguro `POST /api/v1/devices/enroll` para validar el token, generar el `device_secret` simétrico de 256 bits, persistir su hash criptográfico SHA-256 en la base de datos y retornarlo al Centinela por TLS. Adicionalmente, implementa el endpoint `POST /api/v1/devices/revoke` para invalidar dispositivos anteriores y habilitar el re-emparejamiento.

**Blocked by:**
None

**Status:**
completed

- [x] Esquema y tabla de base de datos para `enrollment_tokens` (token, merchant_id, device_id, expires_at, is_consumed).
- [x] Endpoint `POST /api/v1/devices/enrollment-tokens`: generación criptográfica de tokens efímeros con TTL de 300 segundos.
- [x] Endpoint `POST /api/v1/devices/enroll`: validación de token, generación de `device_secret` seguro (32 bytes random), persistencia de `secret_hash` y retorno de credenciales iniciales.
- [x] Endpoint `POST /api/v1/devices/revoke`: revocación inmediata de secretos anteriores ante pérdida o reemplazo de equipo.
- [x] Pruebas unitarias y de integración con TDD cubriendo expiración de tokens, prevención de reuso (replay) y revocación.

