---
name: TransferYA Cockpit System
colors:
  surface: '#090D16'
  surface-dim: '#060910'
  surface-bright: '#1E293B'
  surface-container-lowest: '#04060B'
  surface-container-low: '#0B101C'
  surface-container: '#111726'
  surface-container-high: '#182032'
  surface-container-highest: '#222B40'
  on-surface: '#F8FAFC'
  on-surface-variant: '#94A3B8'
  inverse-surface: '#F8FAFC'
  inverse-on-surface: '#0F172A'
  outline: '#1E293B'
  outline-variant: '#2A364F'
  primary: '#00D26A'
  on-primary: '#041E0F'
  primary-container: '#00D26A'
  on-primary-container: '#003B1A'
  secondary: '#38BDF8'
  on-secondary: '#082F49'
  secondary-container: '#0284C7'
  on-secondary-container: '#E0F2FE'
  tertiary: '#F43F5E'
  on-tertiary: '#4C0519'
  tertiary-container: '#BE123C'
  on-tertiary-container: '#FFE4E6'
  background: '#090D16'
  on-background: '#F8FAFC'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: '-0.02em'
  display-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
  title-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: '0.08em'
spacing:
  unit: 8px
  gutter: 16px
  margin: 24px
  margin-mobile: 16px
rounded:
  sm: 4px
  DEFAULT: 8px
  md: 12px
  lg: 16px
  full: 9999px
---

# Design System: TransferYA Merchant Cockpit & POS PWA

## 1. Visual Theme & Atmosphere
TransferYA is a high-velocity, mission-critical financial cockpit for retail store owners and cashiers in Colombia. The atmosphere is dense (Density 8/10), high-contrast, tactical, and uncompromisingly fast.
- Deep, low-fatigue slate obsidian (`#090D16`) serves as the core substrate.
- Crisp 1px structural outlines (`rgba(255, 255, 255, 0.08)`) frame telemetry cards without heavy muddy gradients.
- Electric Emerald (`#00D26A`) acts as the definitive affirmative pulse: incoming verified money, active Sentinel health, and instant cashier confirmation.
- High-visibility Cashier POS Mode provides instant glanceability from 3 meters away behind a sales counter.

## 2. Color Palette & Roles
- **Substrate Slate** (`#090D16`): Root application canvas and dark mode background.
- **Surface Elevation 1** (`#0B101C`): Sidebar navigation, header bars, and secondary panels.
- **Surface Elevation 2** (`#111726`): Transaction cards, stat modules, table containers.
- **Surface Elevation 3 / Hover** (`#182032`): Active rows, modal sheets, and dropdowns.
- **Electric Emerald Accent** (`#00D26A`): Verified payment success, live connected heartbeat, primary CTA buttons.
- **Nequi Purple Signature** (`#E10098` / `#200020` fill): Wallet chip indicator for Nequi transfers.
- **Daviplata Red Signature** (`#ED1C24` / `#2A0808` fill): Wallet chip indicator for Daviplata transfers.
- **Cyan Telemetry** (`#38BDF8`): Sub-second latency badges (`210 ms`), device sync state.
- **Warning Amber** (`#F59E0B`): Battery optimization warning or pending reconnect.
- **Text Primary** (`#F8FAFC`): Bold financial totals, sender names, headings.
- **Text Secondary** (`#94A3B8`): Timestamps, references, metadata captions.
- **Structural Border** (`#1E293B` / `rgba(255, 255, 255, 0.08)`): Grid and card dividers.

## 3. Typography Rules
- **Display & Headings**: `Plus Jakarta Sans` with tightened tracking (`-0.02em`).
- **Body & Captions**: `Plus Jakarta Sans` for clean Spanish readability across retail stores.
- **Financial Numbers & Identifiers**: `JetBrains Mono` or `Plus Jakarta Sans` with tabular figures (`font-variant-numeric: tabular-nums`). All COP values, phone numbers, and latencies use mono alignment.
- **Banned**: Inter, generic serif fonts (Times, Georgia), comic fonts, overly rounded novelty fonts.

## 4. Component Stylings
- **Transaction Cards & Rows**: High-density horizontal rows with wallet badge (Nequi/Daviplata), sender name in bold, exact amount formatted as `$ 150.000 COP`, timestamp, latency pill (`230ms`), and WhatsApp delivery status.
- **Metric Tiles**: Large bold COP figure with 24h delta, total transactions count, and active Sentinel health badge.
- **Live Payment Modal / POS Alert**: Full-screen or floating banner that triggers on new transfer, flashes an emerald edge glow, displays `$ AMOUNT` and sender name in giant 48px typography, and plays an affirmative audio chime.
- **QR Pairing Modal**: Clean, high-contrast modal displaying an SVG QR code for the Android Sentinel camera, with live countdown expiration and "1-Click Copiar Enlace" fallback.
- **Buttons**:
  - Primary: `#00D26A` background with `#041E0F` text, bold font, subtle emerald glow on hover (`box-shadow: 0 0 16px rgba(0, 210, 106, 0.3)`), active scale 0.98.
  - Secondary: Transparent with `1px solid rgba(255, 255, 255, 0.12)`, text `#F8FAFC`, hover border `#38BDF8`.
  - Cashier Mode Toggle: Prominent tactile pill button to switch into full-screen high-contrast POS counter view.

## 5. Layout Principles & Responsive Architecture
- **Desktop (1024px+)**: Sidebar navigation (Dashboard, Transacciones, Modo Caja POS, Dispositivos Centinela, Cajeros WhatsApp, Ajustes), top telemetry bar with live WebSocket ping, 3-column metric cards, split feed with Live Payments on left and Device Status / WhatsApp logs on right.
- **Mobile & Tablet PWA (< 1024px)**: Single-column responsive layout, persistent bottom navigation bar (Resumen, En Vivo, Modo Caja, Ajustes), touch-friendly minimum 48px tap targets.
- **POS Mode**: Dedicated zero-distraction view for counter tablets or cashier smartphones. Giant display of the latest transaction with color flash and big audio indicator.

## 6. Motion & Audio
- **Realtime Incoming Payment Animation**: Slide-in from top with green border pulse (`@keyframes payment-in`).
- **Sound Alert**: Native Web Audio API dual-tone synthesized chime (`880 Hz -> 1760 Hz` pleasant cash-register / bell tone) on verified transaction.
- **Live Sync Beacon**: Pulsing green dot indicator next to "Centinela En Línea" verifying WebSocket connection.

## 7. Anti-Patterns (Banned)
- No emojis anywhere in the interface (use clean Lucide SVG icons).
- No generic purple AI gradients.
- No pure black (`#000000`).
- No generic placeholder names ("John Doe" -> use realistic Colombian names like "Karoll Sierra", "Carlos Mendoza", "María Gómez").
- No fake round statistics.
- No light mode default (retail counters need high contrast dark mode to reduce glare and battery drain).

