# 10: [Backend] Módulo de Mapeo Comercio-Dispositivo-Cajero (Multi-Tenant Routing)

**What to build:**
Implementar el servicio de dominio y repositorio para la resolución de enrutamiento multi-comercio: a partir del `device_id` autenticado en la ingesta, resolver el `comercio_id`, verificar que el comercio se encuentre en estado `ACTIVE` con suscripción al día, y recuperar la lista de destinatarios autorizados (números de WhatsApp internacionales E.164 o IDs de grupos de WhatsApp) asignados a esa caja/tienda física.

**Blocked by:**
09: [Core] Algoritmo de Huella de Idempotencia de Transferencias P2P

**Status:**
completed

- [x] Interfaces y esquemas de dominio: `Merchant`, `CashierRecipient` (`phoneNumber: string`, `label: string`, `isActive: boolean`).
- [x] Interfaz de repositorio: `IMerchantRoutingRepository` con métodos `getMerchantByDeviceId(deviceId)` y `getCashierRecipients(merchantId)`.
- [x] Validación de estado de cuenta: si el comercio está `SUSPENDED` o `CANCELLED`, suspender el despacho a WhatsApp y registrar evento de auditoría.
- [x] Validación estricta de números telefónicos en formato internacional E.164 (ej. `+573001234567`).
- [x] Pruebas unitarias de resolución de rutas y filtrado de cajeros inactivos con mocks.

