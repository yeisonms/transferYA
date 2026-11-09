# ADR-0002: Autenticación del Webhook con HMAC-SHA256, Android KeyStore y Prevención Anti-Replay

El Webhook del backend autentica las notificaciones entrantes mediante firmas criptográficas HMAC-SHA256 generadas con un Device Secret custodiado en el hardware-backed Android KeyStore, validando una ventana estricta de timestamp (±30s) y deduplicando nonces efímeros para bloquear ataques de repetición o inyección de pagos fantasma.

## Status
Accepted

## Context
Las aplicaciones cliente en Android están expuestas a descompilación (`jadx`, `apktool`) e inspección de tráfico TLS mediante proxys locales. Si se utilizara una API Key estática o credenciales embebidas, un atacante o empleado desleal podría extraerla y emitir peticiones HTTP directas al backend simulando pagos de Nequi o Daviplata que nunca existieron ("pagos fantasma"). Además, peticiones legítimas capturadas en tránsito podrían ser reenviadas repetidamente (Replay Attacks).

## Decision
1. **Zero Trust en el Cliente:** Se descartan API Keys compartidas o estáticas en el código de la app.
2. **Device Secret en Hardware Seguro:** Cada Dispositivo Centinela enrolado recibe/genera una clave simétrica `device_secret` que se almacena exclusivamente en el **Android KeyStore** (hardware-backed).
3. **Firma Criptográfica por Petición:** Toda llamada HTTP POST al Webhook exige las siguientes cabeceras:
   - `X-Device-Id`: Identificador único del Centinela.
   - `X-Timestamp`: Unix timestamp (milisegundos) de la emisión.
   - `X-Nonce`: Cadena aleatoria criptográfica de un solo uso (UUIDv4 o 128-bit hex).
   - `X-Signature`: `HMAC-SHA256(device_secret, method + path + timestamp + nonce + sha256(body))`.
4. **Validación del Backend:**
   - La diferencia absoluta entre el reloj del servidor y `X-Timestamp` no puede superar los 30 segundos.
   - El `X-Nonce` se valida contra una memoria/tabla efímera de deduplicación con TTL de 60 segundos; si el nonce ya fue procesado, la petición se rechaza con HTTP 409/401.
   - La firma HMAC debe coincidir exactamente con el cálculo del servidor usando el secreto del `device_id`.

## Consequences
- **Positivas:** Imposibilita la inyección de pagos fantasma sin acceso al chip criptográfico del dispositivo físico. Neutraliza los ataques de repetición de tráfico capturado.
- **Trade-offs:** Exige sincronización horaria razonable en los dispositivos (NTP automático en Android) y mayor complejidad de implementación en el cliente nativo y middleware del backend.

