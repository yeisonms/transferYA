# 15: [Android Hardening] Detección de Emuladores, Telemetría de Root y Reglas R8/ProGuard

**What to build:**
Implementar los mecanismos de defensa en profundidad (Hardening) en la aplicación Android del Centinela. Incluye el detector y bloqueador de entornos virtualizados/emuladores (`EmulatorDetector`), el detector pasivo de Root (`IntegrityDetector`) que reporta la bandera `is_compromised: true` en el payload periódico de telemetría del Heartbeat, la configuración de red `network_security_config.xml` (desactivación de texto plano y exclusión de certificados de usuario) y el archivo de reglas `proguard-rules.pro` para ofuscación y reducción de código con R8.

**Blocked by:**
None

**Status:**
completed

- [x] `EmulatorDetector`: Detección de QEMU, BlueStacks, Genymotion y SDK emulators con aborto preventivo en compilaciones release.
- [x] `IntegrityDetector`: Detección de binarios `su`, Magisk y firmas de test-keys sin bloquear el proceso, exponiendo el flag `is_compromised` para el payload de Heartbeat (ADR-0005).
- [x] `network_security_config.xml`: Configuración HTTPS estricta (`cleartextTrafficPermitted="false"`, solo CAs de sistema).
- [x] `proguard-rules.pro`: Reglas de ofuscación para `com.transferya.sentinel.*` manteniendo seguros los puntos de entrada del sistema operativo (`NotificationListenerService`, WorkManager, KeyStore).
- [x] Pruebas unitarias en Kotlin para los detectores de emulador e integridad.

