# TransferYA - Verificación de Pagos P2P

Sistema SaaS B2B para la intercepción, validación y confirmación en tiempo real de transferencias P2P (Nequi, Daviplata) en comercios físicos vía WhatsApp.

## Language

**Dispositivo Centinela**:
Celular Android dedicado exclusivamente a permanecer en el punto de venta conectado a la red, ejecutando la app receptora de notificaciones y con sesión activa en las billeteras digitales del comercio.
_Avoid_: Teléfono de caja, terminal, scraper device

**Notificación Capturada**:
Evento de datos en bruto extraído por el sistema operativo Android cuando ingresa dinero, persistido localmente con ciclo de vida (`PENDING`, `DISPATCHED`, `FAILED`).
_Avoid_: Mensaje push, log de evento, payload bruto

**Stale Alert**:
Notificación de pago que llega al backend con un retraso superior al umbral de tolerancia (90 segundos) respecto a su momento de captura original (`captured_at`), desencadenando un mensaje de advertencia visual urgente en WhatsApp.
_Avoid_: Pago vencido, alerta tardía no gestionada, timeout

**Device Secret**:
Clave criptográfica simétrica única asignada durante el enrolamiento del Dispositivo Centinela, resguardada en el hardware-backed Android KeyStore y nunca transmitida en peticiones HTTP convencionales.
_Avoid_: API Key, token público, password

**HMAC Payload Signature**:
Firma criptográfica (HMAC-SHA256) adjunta en cada petición al Webhook (cabecera `X-Signature`) que garantiza la integridad del payload y la autenticidad del Dispositivo Centinela emisor.
_Avoid_: Checksum, hash simple, bearer token

**Nonce Efímero**:
Cadena alfanumérica criptográficamente aleatoria de un solo uso adjunta en cada petición (`X-Nonce`) que, combinada con `X-Timestamp`, permite al backend bloquear ataques de repetición (Replay Attacks).
_Avoid_: Request ID, UUID estático, token

**Partial WakeLock**:
Mecanismo de bajo nivel del sistema operativo Android que la app adquiere temporalmente por un máximo de 10 a 15 segundos al interceptar una notificación, impidiendo que la CPU entre en estado de reposo (Doze) antes del despacho al Webhook.
_Avoid_: Sleep inhibitor, background lock, thread keepalive

**Heartbeat**:
Petición periódica de telemetría y salud emitida cada 5 minutos por el Dispositivo Centinela hacia el backend, cuya ausencia prolongada (>10 minutos) dispara una alerta automática al dueño del comercio.
_Avoid_: Ping genérico, healthcheck HTTP básico, polling

**Parser de Notificaciones**:
Motor de dominio determinista que transforma el texto de una Notificación Capturada en una entidad estructurada de pago mediante expresiones regulares versionadas.
_Avoid_: Validador, scraper, extractor de texto

**Huella de Idempotencia**:
Identificador determinista generado a partir de los datos de la transferencia bancaria para evitar duplicar acreditaciones y alertas al cajero.
_Avoid_: ID de transacción, hash de pago, ticket ID

**Comercio Suscriptor**:
Establecimiento comercial registrado en la plataforma que vincula uno o más Dispositivos Centinela con sus respectivos canales de notificación en punto de venta.
_Avoid_: Cliente, tienda, tenant, cuenta

**Token de Enrolamiento**:
Token criptográfico efímero de un solo uso (TTL 5 minutos) generado por el backend y proyectado como código QR en el panel web para vincular de forma segura un Dispositivo Centinela con una caja física específica.
_Avoid_: Código de activación, clave de acceso, token maestro

**Emparejamiento de Centinela**:
Ceremonia de intercambio Zero-Trust donde el Dispositivo Centinela escanea el Token de Enrolamiento y recibe su `Device Secret` simétrico por TLS, resguardándolo de inmediato en el hardware-backed Android KeyStore y destruyendo el token.
_Avoid_: Login de teléfono, setup inicial, registro genérico

**Revocación de Dispositivo**:
Anulación criptográfica inmediata del `Device Secret` de un Dispositivo Centinela en la base de datos, invalidando cualquier firma HMAC futura tras el reemplazo, robo o formateo del equipo.
_Avoid_: Desconexión, logout, borrado de caja

**Telemetría de Integridad**:
Detección pasiva en el Dispositivo Centinela de entornos de riesgo (Root, depuradores activos o binarios su), reportada como bandera de advertencia en el payload periódico del Heartbeat sin bloquear la continuidad de la operación comercial en terminales de bajo costo.
_Avoid_: Root blocker, safety check, antivirus
