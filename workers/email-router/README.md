# TransferYA — Cloudflare Email Worker (Ruta Cloud)

Este Worker de Cloudflare se ejecuta en el **Edge (red Anycast global)** para interceptar en milisegundos los correos de comprobantes de pago de Nequi y los correos de verificación de reenvío de Google (`forwarding-noreply@google.com`), despachándolos de forma segura y ultrarrápida hacia el webhook central de TransferYA en Vercel.

---

## 🚀 Despliegue en 3 Pasos

### 1. Instalar Dependencias
Desde la terminal, ingresa a este directorio:
```bash
cd workers/email-router
npm install
```

### 2. Autenticarte en Cloudflare (Solo la primera vez)
```bash
npx wrangler login
```
Se abrirá tu navegador para autorizar a Wrangler con tu cuenta gratuita de Cloudflare.

### 3. Desplegar a Producción
```bash
npx wrangler deploy
```

---

## 🔐 Configuración de Seguridad y Variables

El Worker y el backend de TransferYA se comunican usando un secreto compartido (`x-inbound-secret`):

1. **En Cloudflare (Recomendado vía secret cifrado):**
   ```bash
   npx wrangler secret put INBOUND_EMAIL_SECRET
   ```
   *Ingresa un valor secreto seguro (ej: `transferya_prod_sec_994821`).*

2. **En Vercel (Panel de Administración del Backend):**
   * Ve a tu proyecto en **Vercel** &gt; **Settings** &gt; **Environment Variables**.
   * Crea la variable:
     * **Key:** `INBOUND_EMAIL_SECRET`
     * **Value:** *(El mismo valor que ingresaste en Cloudflare)*
   * Guarda y haz un *Redeploy* si es necesario.

3. **URL del Webhook:**
   * En `wrangler.toml` verifica que `TRANSFERYA_WEBHOOK_URL` apunte a tu dominio oficial (ej: `https://transferya.app/api/v1/webhooks/inbound-email`).

---

## 📧 Configuración en el Panel de Cloudflare (Email Routing)

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com/) y selecciona tu dominio (ej: `transferya.app`).
2. En el menú lateral izquierdo, haz clic en **Email** &gt; **Email Routing**.
3. Si es tu primera vez activándolo:
   * Pulsa **Enable Email Routing**.
   * Cloudflare te mostrará los 3 registros MX y el registro TXT SPF requeridos. Pulsa **Add records automatically** (se configuran en 1 clic).
4. Ve a la pestaña **Routing Rules (Reglas de enrutamiento)**:
   * Haz clic en **Create Rule**.
   * **Custom address:** `pago` (o selecciona *Catch-all address* para capturar cualquier alias).
   * **Action:** Selecciona **Send to Worker**.
   * **Destination Worker:** Selecciona **`transferya-email-router`**.
   * Pulsa **Save**.

---

## 🧪 Verificación y Diagnóstico

Para verificar que el Worker está activo, puedes hacer una petición GET a su URL pública asignada por Cloudflare (ej: `https://transferya-email-router.<tu-subdominio>.workers.dev`):

```bash
curl https://transferya-email-router.<tu-subdominio>.workers.dev
```

Respuesta esperada:
```json
{
  "status": "ok",
  "service": "transferya-email-router",
  "timestamp": "2026-11-18T14:40:00.000Z"
}
```
