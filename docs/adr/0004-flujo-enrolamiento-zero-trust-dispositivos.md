# ADR-0004: Flujo de Enrolamiento Zero-Trust (Device Pairing) mediante QR Efímero y KeyStore

El emparejamiento físico inicial de un Dispositivo Centinela se realiza mediante el escaneo de un código QR con Token de Enrolamiento efímero de un solo uso (TTL 5 minutos) generado en el panel administrativo del comercio, el cual intercambia de forma segura el Device Secret simétrico e inicializa las claves en hardware KeyStore sin intervención manual de credenciales.

## Status
Accepted

## Context
Para operar en comercios físicos independientes (minimarkets, droguerías, ferreterías), el proceso de enrolamiento no puede depender de configuraciones complejas por parte de ingenieros en sitio ni del tipeo manual de API keys largas y propensas a errores. Al mismo tiempo, el intercambio inicial del `device_secret` (clave simétrica de 256 bits para HMAC-SHA256) debe cumplir con principios de Zero-Trust: la clave nunca debe ser conocida por el personal de la tienda ni transmitirse sin cifrado robusto de transporte. Adicionalmente, si el teléfono se formatea, se daña o es reemplazado, debe existir un mecanismo seguro de revocación y re-enlace.

## Decision
1. **Generación de Token de Enrolamiento:**
   - El propietario del comercio inicia sesión en el panel web administrativo (autenticado con Supabase Auth).
   - En la sección de gestión de cajas, solicita enlazar un nuevo Dispositivo Centinela.
   - El backend genera un `enrollment_token` criptográficamente seguro (UUID v4 + firma temporal HMAC interna con TTL de 300 segundos) y lo proyecta como un código QR dinámico en pantalla.
2. **Ceremonia de Emparejamiento (Pairing Handshake):**
   - La aplicación Centinela recién instalada en el teléfono Android abre un lector de cámara exclusivo para el onboarding.
   - Al escanear el QR, la app emite una petición `POST /api/v1/devices/enroll` con el `enrollment_token`.
   - El backend valida la firma y vigencia del token (< 5 minutos) y que no haya sido consumido previamente.
   - El backend genera un `device_secret` aleatorio de 32 bytes (256 bits), calcula su hash criptográfico SHA-256 (`secret_hash`) y lo almacena en la tabla `devices` vinculado al comercio y caja.
   - El backend retorna por TLS el `device_id` y el `device_secret` en crudo a la app, destruyendo inmediatamente el token de enrolamiento.
3. **Persistencia en Hardware KeyStore:**
   - La app Centinela recibe el `device_secret` y lo importa de inmediato en el `AndroidKeyStore` respaldado por hardware (TEE / StrongBox) bajo el alias `sentinel_hmac_secret`.
   - La clave queda resguardada contra extracción física o dumping de memoria por parte de aplicaciones no privilegiadas.
4. **Política de Revocación y Re-enlace:**
   - Cada caja física admite estrictamente **un único Dispositivo Centinela activo** en cualquier momento.
   - En caso de reemplazo, pérdida o formateo del equipo, el comerciante pulsa *"Re-enlazar Centinela"* en el panel web. Esto marca el registro previo en base de datos como `REVOKED`, invalidando cualquier firma HMAC futura del equipo anterior y emitiendo un nuevo QR.

## Consequences
- **Positivas:**
  - Experiencia de onboarding de menos de 10 segundos para el tendero, sin digitación de claves.
  - El personal del comercio nunca conoce ni expone el `device_secret`.
  - Ventana de exposición del enrolamiento limitada a 5 minutos y consumo único.
  - Revocación criptográfica inmediata ante extravío o reemplazo del hardware.
- **Trade-offs:**
  - Requiere que el teléfono Android tenga cámara funcional para escanear el QR.

