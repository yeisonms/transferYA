---
name: TransferYA SaaS Fintech Design System
colors:
  surface: '#FFFFFF'
  surface-dim: '#F5F7FA'
  surface-bright: '#FFFFFF'
  surface-container-lowest: '#FFFFFF'
  surface-container-low: '#F8FAFC'
  surface-container: '#F1F5F9'
  surface-container-high: '#E2E8F0'
  surface-container-highest: '#CBD5E1'
  on-surface: '#101C2D'
  on-surface-variant: '#64748B'
  inverse-surface: '#101C2D'
  inverse-on-surface: '#F8FAFC'
  outline: '#E2E8F0'
  outline-variant: '#CBD5E1'
  primary: '#13B981'
  on-primary: '#FFFFFF'
  primary-container: '#E8F7F0'
  on-primary-container: '#065F46'
  secondary: '#101C2D'
  on-secondary: '#FFFFFF'
  secondary-container: '#E2E8F0'
  on-secondary-container: '#101C2D'
  tertiary: '#64748B'
  on-tertiary: '#FFFFFF'
  tertiary-container: '#F1F5F9'
  on-tertiary-container: '#334155'
  background: '#F5F7FA'
  on-background: '#101C2D'
  nequi-badge-bg: '#FDF2F8'
  nequi-badge-text: '#9D174D'
  nequi-badge-border: '#FBCFE8'
  daviplata-badge-bg: '#FEF2F2'
  daviplata-badge-text: '#B91C1C'
  daviplata-badge-border: '#FECACA'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: '-0.02em'
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-lg:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  title-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: '0.05em'
  mono-number:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
spacing:
  unit: 8px
  gutter: 16px
  margin: 24px
  margin-mobile: 16px
rounded:
  sm: 6px
  DEFAULT: 8px
  md: 12px
  lg: 16px
  full: 9999px
---

# Design System: TransferYA SaaS Fintech (Rediseño Light Premium)

## 1. Atmósfera y Filosofía Visual
TransferYA es una plataforma SaaS de verificación de pagos en tiempo real para comercios y puntos de venta en Colombia.
Su personalidad visual proyecta:
- **Claridad Financiera y Confianza**: Espacios limpios, blancos cálidos (`#F5F7FA`), tarjetas en blanco puro (`#FFFFFF`) con bordes suaves (`#E2E8F0`) y sombras sutiles (`shadow-sm`).
- **Verde Esmeralda Fintech (`#13B981`)**: El color de la certeza y el dinero recibido. Se utiliza en estados de éxito, montos confirmados y botones de acción principal.
- **Azul Medianoche Corporativo (`#101C2D`)**: Tipografía principal, títulos y botones de soporte. Da seriedad y elegancia empresarial.
- **Cero Estética de Hacker o Terminal**: Sin métricas de latencia de red en milisegundos, sin fondos negros con bordes fluorescentes, sin fuentes monoespaciadas obligatorias en todo el sitio.

## 2. Paleta de Colores
- **Lienzo Principal (Canvas)**: `#F5F7FA` (Gris cálido tenue).
- **Superficies y Tarjetas**: `#FFFFFF` con borde `1px solid #E2E8F0` y esquinas `rounded-xl`.
- **Verde Esmeralda Principal**: `#13B981` (Acción principal, dinero confirmado, estados activos).
- **Verde Suave (Pills y Badges)**: `#E8F7F0` con texto `#065F46` (Para pastillas de estado "Sistema operativo", "Conectado", "En línea").
- **Azul Medianoche (Marca y Títulos)**: `#101C2D`.
- **Gris Pizarra Secundario**: `#64748B` (Subtítulos, fechas, metadatos amigables).
- **Gris Borde Sutil**: `#E2E8F0` / `#CBD5E1`.
- **Identificador Nequi**: Badge sutil `#FDF2F8`, borde `#FBCFE8`, texto `#9D174D` (No se usa como color decorativo de fondo).
- **Identificador Daviplata**: Badge sutil `#FEF2F2`, borde `#FECACA`, texto `#B91C1C`.
- **Alertas y Errores**: `#EF4444` (Rojo controlado).
- **Advertencias y Pendientes**: `#F59E0B` (Ámbar cálido).

## 3. Tipografía
- **Fuente Principal**: `Inter` para toda la jerarquía de lectura (títulos, subtítulos, botones, textos descriptivos).
- **Fuente Monospace (`JetBrains Mono`)**: Exclusivamente para números de referencia bancaria, comprobantes o códigos de autenticación cuando sea estrictamente necesario.

## 4. Estructura de Navegación Lateral (Sidebar)
La navegación se organiza en 3 bloques enfocados en las tareas cotidianas del comerciante:
1. **PRINCIPAL**:
   - Resumen (Dashboard general del negocio)
   - Movimientos (Historial de pagos y transferencias)
   - Cierres de caja (Arqueo y balances diarios)
2. **MI NEGOCIO**:
   - Mis cajas (Puntos de venta)
   - Dispositivos (Celulares de caja y estado)
   - Notificaciones WhatsApp (Cajeros vinculados)
3. **CONFIGURACIÓN**:
   - Configuración (Ajustes de cuenta)
   - Mi plan (Suscripción y días restantes)
   - Ayuda (Soporte y preguntas frecuentes)
   - Stickers de caja (Botón de impresión de códigos QR de mostrador)

## 5. Principios de Interacción y Pantalla de Movimientos
- **Lista Limpia Transaccional**: La tabla principal muestra únicamente el remitente, la hora, la billetera y el valor en verde destacado (`+$120.000 COP`).
- **Drawer / Modal de Detalle**: Toda la información técnica pesada (payload crudo, referencia bancaria de 9 dígitos, estado de entrega WhatsApp, acuse de recibo) se abre en un panel lateral al hacer clic en la fila, manteniendo la vista principal 100% limpia.
