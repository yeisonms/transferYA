import { describe, expect, it } from 'vitest';
import {
  parseGoogleForwardingEmail,
  parseInboundEmail,
  parseNequiEmailReceipt,
  stripHtml,
} from '../email-parser.js';
import type { InboundEmailInput } from '../types.js';

describe('Motor de Parsing de Inbound Email (Ruta Cloud TransferYA)', () => {
  describe('1. Utilidad stripHtml', () => {
    it('debe convertir etiquetas HTML de tablas y párrafos en texto limpio con saltos de línea', () => {
      const html = `
        <div style="font-family: sans-serif;">
          <h2>¡Te enviaron plata!</h2>
          <p>Detalle de tu movimiento:</p>
          <table>
            <tr><td>¿Cuánto?</td><td>$ 50.000,00</td></tr>
            <tr><td>¿Quién te la envió?</td><td>CARLOS GOMEZ</td></tr>
          </table>
        </div>
      `;
      const text = stripHtml(html);
      expect(text).toContain('¡Te enviaron plata!');
      expect(text).toContain('¿Cuánto? $ 50.000,00');
      expect(text).toContain('¿Quién te la envió? CARLOS GOMEZ');
      expect(text).not.toContain('<table');
      expect(text).not.toContain('</div>');
    });

    it('debe decodificar entidades HTML comunes (tildes, eñe, comillas)', () => {
      const html = '&iexcl;Hola! Te envi&oacute; plata Mar&iacute;a Pe&ntilde;a por &amp; para tu local.';
      const text = stripHtml(html);
      expect(text).toContain('María Peña');
      expect(text).toContain('&');
    });
  });

  describe('2. Handshake de Verificación de Reenvío de Google (Gmail Forwarding)', () => {
    it('debe extraer el código numérico de 9 dígitos y el enlace de confirmación directa', () => {
      const googleEmail: InboundEmailInput = {
        from: 'forwarding-noreply@google.com',
        to: 'tienda1@inbound.transferya.app',
        subject: 'Solicitud de reenvío de Gmail - Confirmación para recibir correo de usuario@gmail.com',
        text: `
          usuario@gmail.com ha solicitado reenviar automáticamente correo a tu dirección de correo electrónico tienda1@inbound.transferya.app.
          
          Código de confirmación: 492019384

          O también puedes hacer clic en el siguiente enlace para confirmar la solicitud:
          https://mail.google.com/mail/vf-ab12cd34ef56gh78ij90
          
          Gracias por usar Gmail.
        `,
      };

      const result = parseGoogleForwardingEmail(googleEmail);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('GOOGLE_FORWARDING_VERIFICATION');
      expect(result?.verificationCode).toBe('492019384');
      expect(result?.confirmationUrl).toBe('https://mail.google.com/mail/vf-ab12cd34ef56gh78ij90');
      expect(result?.requestedAddress).toBe('tienda1@inbound.transferya.app');
    });

    it('debe soportar correos de confirmación de Google en inglés', () => {
      const englishEmail: InboundEmailInput = {
        from: 'forwarding-noreply@google.com',
        subject: 'Gmail Forwarding Confirmation - Receive Mail from merchant@gmail.com',
        text: `
          Confirmation code: 837492019
          To verify, visit: https://mail.google.com/mail/vf-9988776655
        `,
      };

      const result = parseGoogleForwardingEmail(englishEmail);
      expect(result).not.toBeNull();
      expect(result?.verificationCode).toBe('837492019');
      expect(result?.confirmationUrl).toBe('https://mail.google.com/mail/vf-9988776655');
    });

    it('debe retornar null si no es un correo de verificación de Google', () => {
      const regularEmail: InboundEmailInput = {
        from: 'notificaciones@nequi.com.co',
        subject: 'Te enviaron plata',
        text: 'Te enviaron $10.000',
      };
      expect(parseGoogleForwardingEmail(regularEmail)).toBeNull();
    });

    it('debe retornar null si el correo proviene del envelope de Gmail pero es un pago real de Bre-B', () => {
      const autoForwardedPayment: InboundEmailInput = {
        from: 'forwarding-noreply+caf_=pago=transferya.app@google.com',
        subject: '¡Recibiste plata por Bre-B!',
        text: '¡Hola, Yeison Stiven Murcia Calvo!\n\nRecibiste 120 de YEISON STIVEN MURCIA CALVO el 18 de noviembre de 2026 a la 1:28 p.m, desde el banco Daviplata.',
      };
      expect(parseGoogleForwardingEmail(autoForwardedPayment)).toBeNull();
    });
  });

  describe('3. Extracción de Comprobantes de Pago de Nequi por Correo', () => {
    it('debe parsear el formato estándar de Nequi con "¿Cuánto?", "¿Quién te la envió?" y "Número de referencia"', () => {
      const email: InboundEmailInput = {
        from: 'comprobantes@nequi.com.co',
        subject: '¡Hola! Te enviaron plata a tu Nequi',
        text: `
          ¡Hola!
          Te enviaron plata a tu Nequi
          
          Detalle del movimiento:
          ¿Cuánto?: $ 50.000,00
          ¿Quién te la envió?: CARLOS ALBERTO GOMEZ PEREZ
          ¿De qué cuenta?: 310*******
          Fecha: 18 de Noviembre de 2026 - 08:15 AM
          Número de referencia: M12345678
        `,
      };

      const result = parseNequiEmailReceipt(email);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payment.wallet).toBe('NEQUI');
        expect(result.payment.amount).toBe(50000);
        expect(result.payment.senderName).toBe('Carlos Alberto Gomez Perez');
        expect(result.payment.reference).toBe('M12345678');
      }
    });

    it('debe parsear el formato resumido con "Valor:", "De:" y "Referencia:"', () => {
      const email: InboundEmailInput = {
        from: 'notificaciones@nequi.com.co',
        subject: 'Comprobante de envío',
        html: `
          <div>
            <h1>¡Plata recibida!</h1>
            <p>Valor: $ 120.000</p>
            <p>De: MARIA PAULA ROJAS</p>
            <p>Referencia: M98765432</p>
          </div>
        `,
      };

      const result = parseNequiEmailReceipt(email);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payment.amount).toBe(120000);
        expect(result.payment.senderName).toBe('Maria Paula Rojas');
        expect(result.payment.reference).toBe('M98765432');
      }
    });

    it('debe parsear el formato de transferencias Bre-B recibido desde notificaciones@nequi.com.co', () => {
      const email: InboundEmailInput = {
        from: 'notificaciones@nequi.com.co',
        subject: '¡Recibiste plata por Bre-B!',
        text: `
          ¡Hola, YEISON MURCIA!

          Recibiste 200 de EDWIN MURCIA el 18 de noviembre de 2026 a las 12:05 p.m, desde el banco Nequi. Revisa el detalle en los movimientos de tu app o descarga el comprobante si lo necesitas.
        `,
      };

      const result = parseNequiEmailReceipt(email);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payment.wallet).toBe('NEQUI');
        expect(result.payment.amount).toBe(200);
        expect(result.payment.senderName).toBe('Edwin Murcia');
      }
    });

    it('debe parsear transferencias por Bre-B / Transfiya notificadas por correo', () => {
      const email: InboundEmailInput = {
        from: 'notificaciones@nequi.com.co',
        subject: '¡Te llegó plata por Transfiya!',
        text: `
          ¡Te llegó plata por Transfiya!
          Monto: $ 35.000
          Envía: ANDRES FELIPE RUIZ
          Nro. de transacción: B8374920
        `,
      };

      const result = parseNequiEmailReceipt(email);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payment.amount).toBe(35000);
        expect(result.payment.senderName).toBe('Andres Felipe Ruiz');
        expect(result.payment.reference).toBe('B8374920');
      }
    });

    it('debe descartar correos de seguridad, claves dinámicas o restablecimiento de contraseña', () => {
      const securityEmail: InboundEmailInput = {
        from: 'seguridad@nequi.com.co',
        subject: 'Código de seguridad para tu Nequi',
        text: 'Tu clave dinámica es 482910. Nunca la compartas con nadie.',
      };

      const result = parseNequiEmailReceipt(securityEmail);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('NOT_A_PAYMENT');
        expect(result.reason).toMatch(/seguridad|clave/i);
      }
    });
  });

  describe('4. Enrutador Unificado parseInboundEmail', () => {
    it('debe clasificar correctamente una verificación de Gmail Forwarding', () => {
      const email: InboundEmailInput = {
        from: 'forwarding-noreply@google.com',
        subject: 'Solicitud de reenvío de Gmail',
        text: 'Código de confirmación: 112233445',
      };

      const result = parseInboundEmail(email);
      expect(result.success).toBe(true);
      if (result.success && result.type === 'GOOGLE_VERIFICATION') {
        expect(result.verification.verificationCode).toBe('112233445');
      }
    });

    it('debe clasificar correctamente un comprobante de pago de Nequi', () => {
      const email: InboundEmailInput = {
        from: 'comprobantes@nequi.com.co',
        subject: 'Te enviaron plata',
        text: '¿Cuánto?: $ 80.000\n¿Quién te la envió?: PEDRO PEREZ\nReferencia: M55443322',
      };

      const result = parseInboundEmail(email);
      expect(result.success).toBe(true);
      if (result.success && result.type === 'PAYMENT') {
        expect(result.payment.amount).toBe(80000);
        expect(result.payment.senderName).toBe('Pedro Perez');
        expect(result.payment.reference).toBe('M55443322');
      }
    });

    it('debe clasificar como PAYMENT un pago de Bre-B reenviado por Google envelope', () => {
      const email: InboundEmailInput = {
        from: 'forwarding-noreply+caf_=pago=transferya.app@google.com',
        to: 'pago+5f38cd0c-7802-4cbf-98a3-e4fc71482dcb@transferya.app',
        subject: '¡Recibiste plata por Bre-B!',
        text: '¡Hola, Yeison Stiven Murcia Calvo!\n\nRecibiste 120 de YEISON STIVEN MURCIA CALVO el 18 de noviembre de 2026 a la 1:28 p.m, desde el banco Daviplata.',
      };

      const result = parseInboundEmail(email);
      expect(result.success).toBe(true);
      if (result.success && result.type === 'PAYMENT') {
        expect(result.payment.amount).toBe(120);
        expect(result.payment.senderName).toBe('Yeison Stiven Murcia Calvo');
        expect(result.payment.wallet).toBe('NEQUI');
      }
    });
  });
});
