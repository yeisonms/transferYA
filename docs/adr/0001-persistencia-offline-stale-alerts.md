# ADR-0001: Persistencia Offline Local y Gestión de Stale Alerts

El Dispositivo Centinela persiste toda Notificación Capturada localmente en una base de datos SQLite (Room) con ciclo de vida atómico y despacha mediante Android WorkManager con reintentos exponenciales; el backend audita la latencia de red (`now - captured_at`) y clasifica como Stale Alert (>90s) cualquier notificación rezagada para alertar al cajero de forma diferenciada.

## Status
Accepted

## Context
En comercios físicos de Colombia, la conectividad Wi-Fi o datos móviles de gama de entrada presenta micro-cortes frecuentes. Si una notificación de transferencia bancaria se pierde en el momento de la intercepción porque el dispositivo no tiene red, el comercio no recibe la confirmación y se genera fricción o fraude. Por otro lado, si la red regresa minutos después, enviar una confirmación estándar al cajero generaría confusión sobre pagos antiguos ya entregados o clientes ausentes.

## Decision
1. **Persistencia local atómica:** Toda Notificación Capturada se inserta en SQLite mediante `Room` con estado inicial `PENDING` antes de intentar cualquier socket de red.
2. **Despacho asíncrono resiliente:** Se utiliza `WorkManager` de Android configurado con `NetworkType.CONNECTED` y política de backoff exponencial. Tras éxito HTTP 200, el estado muta a `DISPATCHED`.
3. **Métricas de tiempo en Payload:** El payload incluye `captured_at` (timestamp del SO en la intercepción) y `dispatched_at` (timestamp de salida de red).
4. **Política de Stale Alerts:** Si `server_time - captured_at > 90 segundos`, el backend procesa y audita el pago, pero etiqueta el evento como `STALE_ALERT`, forzando en WhatsApp una plantilla de advertencia visual urgente para el cajero.

## Consequences
- **Positivas:** Garantía de entrega *At-Least-Once*. Cero pérdida de notificaciones por reinicios o caídas de red. El personal de caja no es engañado por confirmaciones desfasadas en el tiempo.
- **Trade-offs:** Requiere almacenamiento local en el dispositivo y gestión de limpieza periódica de registros `DISPATCHED` para evitar saturación de almacenamiento en dispositivos de gama baja.

