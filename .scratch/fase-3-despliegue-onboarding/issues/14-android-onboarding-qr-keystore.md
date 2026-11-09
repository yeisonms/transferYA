# 14: [Android] Módulo de Onboarding, Escáner de QR y Enrolamiento KeyStore

**What to build:**
Implementar el cliente de onboarding y enrolamiento en la aplicación Android del Dispositivo Centinela. Integra la lógica de captura del `enrollment_token` a partir del escáner de QR, realiza la llamada HTTPS al endpoint `/api/v1/devices/enroll`, importa de forma segura el `device_secret` simétrico recibido en el `AndroidKeyStoreVault` (`sentinel_hmac_secret`), persiste el `device_id` y transiciona el estado de la aplicación de `UNENROLLED` a `ACTIVE_SENTINEL`.

**Blocked by:**
13: [Backend & DB] Módulo de Enrolamiento Zero-Trust (QR Tokens y Handshake Criptográfico)

**Status:**
completed

- [x] Contrato y cliente HTTP de enrolamiento nativo `DeviceEnrollmentClient`.
- [x] Integración con `AndroidKeyStoreVault` para importar el `device_secret` simétrico de 256 bits sin exponerlo en logs ni almacenamiento plano.
- [x] Gestor de estado de enrolamiento local (`EnrollmentStateManager`) con soporte para estados `UNENROLLED`, `ENROLLING`, `ACTIVE_SENTINEL` y `REVOKED`.
- [x] Pruebas unitarias en Kotlin (JUnit 5) simulando el handshake de enrolamiento, almacenamiento de credenciales y transiciones de estado.

