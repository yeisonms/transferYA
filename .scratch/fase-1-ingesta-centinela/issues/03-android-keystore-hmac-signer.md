# 03: [Android] Gestor de Claves Criptográficas en Android KeyStore y Generador de Firmas HMAC

**What to build:**
Implementar el módulo nativo en Kotlin `AndroidKeyStoreVault` que administra de forma segura el ciclo de vida del `device_secret` en el enclave de seguridad por hardware del dispositivo (`AndroidKeyStore`), genera números aleatorios criptográficos para nonces efímeros (`SecureRandom`), obtiene timestamps sincronizados y genera la firma HMAC-SHA256 para cada petición saliente sin exponer la clave en memoria plana.

**Blocked by:**
01: [Protocol] Especificación del Contrato de Ingesta y Validador Criptográfico HMAC-SHA256

**Status:**
completed

- [x] Inyección/almacenamiento del `device_secret` utilizando `KeyStore` de Android respaldado por hardware (usando `KeyProperties.PURPOSE_SIGN` o clave simétrica `HmacSHA256` en KeyStore).
- [x] Generador de `X-Nonce` criptográfico de 128 bits en formato UUIDv4 seguro sin colisiones en ráfaga.
- [x] Método de firma `sign(method, path, timestamp, nonce, payloadJson)` que aplica el canon determinista definido en el Ticket 01 (`METHOD|PATH|TIMESTAMP|NONCE|BODY_SHA256`).
- [x] Manejo de excepciones criptográficas y fallback controlado en caso de dispositivos o entornos sin chip seguro hardware.
- [x] Pruebas unitarias en JVM/JUnit con verificación contra los vectores de prueba de referencia del Ticket 01.
