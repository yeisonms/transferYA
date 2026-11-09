# ADR-0005: Endurecimiento del APK de Producción (R8, Bloqueo de Emuladores y Telemetría de Integridad)

El APK de producción del Dispositivo Centinela aplica ofuscación agresiva con R8/ProGuard, bloqueo estricto de emuladores para evitar granjas de scraping y reporte pasivo de telemetría de integridad en caso de detección de Root, manteniendo el tráfico de red confinado estrictamente a HTTPS.

## Status
Accepted

## Context
El Dispositivo Centinela se ejecutará en hardware móvil situado en mostradores de comercios físicos sobre los cuales no tenemos control perimetral absoluto. Si un tercero malintencionado obtiene el APK, podría intentar descompilar el código para descubrir la lógica de intercepción de billeteras, clonar el cliente o ejecutarlo en un entorno virtualizado (emulador) para enviar payloads fraudulentos. Al mismo tiempo, en el contexto minorista de Colombia, muchos comercios operan con dispositivos de gama baja o segunda mano que pueden contar con versiones de Android alteradas por operadoras o bootloaders desbloqueados.

## Decision
1. **Ofuscación y Reducción con R8:**
   - La variante de compilación `release` activa `isMinifyEnabled = true` e `isShrinkResources = true`.
   - Se ofuscan todos los identificadores de clases, métodos y campos del paquete `com.transferya.sentinel.*`.
   - Se preservan mediante reglas explícitas de ProGuard (`-keep`) únicamente los puntos de integración con el sistema operativo: `NotificationListenerService`, `Worker` de WorkManager, `BroadcastReceiver` de boot y entidades SQLite.
2. **Bloqueo Estricto de Emuladores:**
   - El APK incluye comprobaciones al arranque para identificar entornos de emulación (BlueStacks, QEMU, Genymotion, Nox, SDK Emulator) mediante la inspección de propiedades de hardware: `Build.FINGERPRINT`, `Build.HARDWARE`, `Build.MODEL`, `Build.PRODUCT` y rutas `/dev/qemu_pipe`.
   - Si se detecta un emulador en la compilación `release`, la app aborta inmediatamente con un mensaje explícito: el Centinela debe ejecutarse exclusivamente en hardware físico.
3. **Telemetría Pasiva de Root (Non-Blocking):**
   - Se detecta la presencia de binarios `su` (`/system/bin/su`, `/system/xbin/su`), gestores conocidos (Magisk, SuperSU) y flags de `test-keys`.
   - Para evitar falsos positivos que bloqueen las ventas del comercio en terminales económicos con ROMs personalizadas, **no se termina el proceso**. En su lugar, el Heartbeat periódico emitido hacia el backend incluye la bandera `is_compromised: true`, permitiendo al panel administrativo alertar al equipo de soporte y auditar el nivel de riesgo del punto de venta.
4. **Configuración de Seguridad de Red (Network Security Config):**
   - El archivo `network_security_config.xml` desactiva totalmente el tráfico en texto plano (`cleartextTrafficPermitted="false"`).
   - Se confía exclusivamente en certificados de autoridades raíz del sistema (`system`), rechazando certificados de usuario (`user`) para bloquear proxies de inspección tipo Charles o mitmproxy en la red local.

## Consequences
- **Positivas:**
  - Máxima resistencia contra ingeniería inversa y extracción de código Kotlin.
  - Imposibilidad de correr Centinelas en granjas de emuladores en la nube.
  - Cero falsos bloqueos comerciales en terminales económicos de comercios reales, manteniendo visibilidad total del riesgo mediante telemetría.
  - Conexión HTTPS segura protegida contra intercepción de certificados locales.
- **Trade-offs:**
  - La depuración de fallos en producción requiere mapeo de símbolos vía archivo `mapping.txt` generado por R8.

