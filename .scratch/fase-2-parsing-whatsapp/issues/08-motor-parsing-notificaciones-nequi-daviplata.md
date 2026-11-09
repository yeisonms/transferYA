# 08: [Parser] Motor de Parsing de Notificaciones Bancarias (Nequi y Daviplata) con TDD

**What to build:**
Implementar el motor de dominio determinista de expresiones regulares versionadas que transforma el texto no estructurado de una Notificación Capturada en un `PaymentReceipt` validado. El motor debe extraer con precisión quirúrgica el monto numérico (limpiando puntos de miles, signos de pesos y decimales), el nombre del remitente (normalizando mayúsculas/espacios y acentos) y la billetera de origen (`NEQUI` o `DAVIPLATA`), y debe descartar de forma segura notificaciones no monetarias (promociones, avisos de seguridad, cobros o transferencias salientes).

**Blocked by:**
None (puede iniciar de inmediato en la capa de dominio)

**Status:**
completed

- [x] Definición de tipos de dominio: `ParsedPaymentReceipt` (`wallet: 'NEQUI' | 'DAVIPLATA'`, `amount: number`, `senderName: string`, `reference: string | null`, `rawText: string`), y `ParseResult` (`success: true, payment: ...` | `success: false, error: 'NOT_A_PAYMENT' | 'UNSUPPORTED_FORMAT'`).
- [x] Parser de Nequi: soporte para formatos de abono estándar ("Te transfirieron $50.000 de Pepito Pérez (Saldo: $...)", "Te enviaron $30,000 por Transfiya de Juan", variaciones con y sin saldo).
- [x] Parser de Daviplata: soporte para formatos oficiales ("DaviPlata le informa que recibio $25.000 de Laura Gomez", "Recibiste una transferencia de $50.000 de MARIA GOMEZ", "Recibiste $100,000.00").
- [x] Filtro estricto anti falsos positivos: rechazo categórico de notificaciones informativas ("Paga tu factura", "Recargaste tu Nequi", "Enviaste plata", "Clave dinámica", etc.).
- [x] Suite de pruebas 100% TDD con casos reales recolectados en comercios colombianos.
