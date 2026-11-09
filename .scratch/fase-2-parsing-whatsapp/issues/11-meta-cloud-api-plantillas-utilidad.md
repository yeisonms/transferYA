# 11: [Meta API] Cliente de WhatsApp Meta Cloud API para Plantillas de Utilidad

**What to build:**
Implementar el cliente de integración desacoplado con la API Oficial de Meta (WhatsApp Cloud API / Graph API v21+) para el envío de plantillas pre-aprobadas bajo la categoría "Utilidad" (Utility). El cliente debe formatear las variables dinámicas de la plantilla (`{{1}}` monto en COP con formato monetario $50.000, `{{2}}` nombre del remitente, `{{3}}` billetera Nequi/Daviplata, `{{4}}` hora de intercepción), soportar el componente de advertencia visual para *Stale Alerts* (`isStale = true`) y manejar reintentos controlados con backoff ante errores 429 (rate limits) o fallos de red.

**Blocked by:**
None (o 08 para los tipos de `ParsedPaymentReceipt`)

**Status:**
completed

- [x] Cliente HTTP desacoplado `IWhatsAppCloudApiClient` con método `sendUtilityTemplate(to: string, templateName: string, parameters: TemplateParameter[]): Promise<WhatsAppSendResult>`.
- [x] Constructor de payloads de Meta Cloud API: serialización correcta de componentes `header`, `body` y `button` según la especificación de Graph API.
- [x] Soporte para plantilla estándar de confirmación de pago (`transferya_payment_alert_v1`) y plantilla de advertencia por retraso de red (`transferya_stale_alert_v1`).
- [x] Formateador de moneda colombiana determinista: `formatCopCurrency(amount)` (ej. `50000 -> "$ 50.000"`).
- [x] Pruebas unitarias completas con mocks simulando respuestas 200 de Meta (`messages[0].id`), respuestas 400 (parámetros inválidos), 401 (token expirado) y 429 (rate limit).

