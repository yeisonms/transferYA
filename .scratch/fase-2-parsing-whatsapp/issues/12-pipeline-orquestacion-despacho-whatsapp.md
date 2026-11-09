# 12: [Pipeline E2E] Orquestador de Procesamiento de Pagos y Despacho a WhatsApp

**What to build:**
Implementar el pipeline integral end-to-end que toma notificaciones capturadas en estado `RECEIVED` en la base de datos (originadas desde el Webhook de la Fase 1), ejecuta el motor de parsing (Ticket 08), evalúa la huella de idempotencia para descartar duplicados (Ticket 09), resuelve los cajeros del comercio (Ticket 10) y despacha la alerta de confirmación instantánea a WhatsApp vía Meta Cloud API (Ticket 11), actualizando el registro en base de datos a `PROCESSED` con el `whatsapp_message_id` y timestamp de entrega.

**Blocked by:**
08: [Parser] Motor de Parsing de Notificaciones Bancarias (Nequi y Daviplata) con TDD
09: [Core] Algoritmo de Huella de Idempotencia de Transferencias P2P
10: [Backend] Módulo de Mapeo Comercio-Dispositivo-Cajero (Multi-Tenant Routing)
11: [Meta API] Cliente de WhatsApp Meta Cloud API para Plantillas de Utilidad

**Status:**
completed

- [x] Servicio orquestador `PaymentProcessingPipeline` con método `processCapturedNotification(notificationId: string): Promise<PipelineResult>`.
- [x] Flujo secuencial:
  1. Cargar evento de `captured_notifications` (Ticket 02).
  2. Parsear texto crudo con el motor de Regex (Ticket 08); si no es un pago válido, marcar `IGNORED_NON_PAYMENT`.
  3. Calcular y validar la Huella de Idempotencia (Ticket 09); si ya existe en la base de datos para ese comercio, marcar `DUPLICATE_PAYMENT` y omitir despacho a WhatsApp.
  4. Resolver los destinatarios de caja del comercio (Ticket 10).
  5. Despachar a WhatsApp con la plantilla correspondiente según `is_stale` (Ticket 11).
  6. Actualizar registro a `PROCESSED` con `whatsapp_message_id` para auditoría.
- [x] Manejo de transacciones atómicas y registros de auditoría en caso de fallos de despacho.
- [x] Suite de pruebas de integración E2E simulando el ciclo completo desde notificación en crudo hasta mensaje entregado al cajero.

