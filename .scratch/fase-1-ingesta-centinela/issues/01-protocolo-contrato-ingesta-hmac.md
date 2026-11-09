# 01: [Protocol] Especificación del Contrato de Ingesta y Validador Criptográfico HMAC-SHA256

**What to build:**
Definir de forma canónica el contrato de comunicación entre el Dispositivo Centinela (Android) y el Webhook (Backend), incluyendo el esquema tipado de la `Notificación Capturada`, el algoritmo determinista de serialización para firma, y utilidades puras de hashing/HMAC-SHA256 con suite de pruebas cruzadas basadas en vectores RFC para garantizar firmas idénticas e interoperables entre TypeScript (Node.js) y Kotlin (JVM).

**Blocked by:**
None (can start immediately)

**Status:**
completed

- [x] Tipos de datos estrictos para `CapturedNotificationPayload`: `device_id` (string), `wallet_package` (enum: `com.nequi.MobileApp` | `com.davivienda.daviplata`), `raw_title` (string), `raw_text` (string), `captured_at` (number unix epoch ms), `dispatched_at` (number unix epoch ms).
- [x] Función de canonicalización determinista: `canonicalize(method, path, timestamp, nonce, bodyHash)` insensible al orden de propiedades en el JSON.
- [x] Algoritmo de firma `HMAC-SHA256(device_secret, canonicalString)` con salida en codificación Hexadecimal estandarizada.
- [x] Suite de pruebas unitarias 100% TDD con vectores de prueba conocidos que verifiquen paridad absoluta de firmas entre implementaciones.
- [x] Zero dependencias externas pesadas (apoyado en módulos estándar `node:crypto` de Node y `javax.crypto` de JVM).
