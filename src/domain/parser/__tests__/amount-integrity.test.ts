import { describe, it, expect } from 'vitest';
import { cleanCopAmount, parseBankingNotification } from '../engine.js';
import { parseInboundEmail } from '../email-parser.js';

describe('Auditoría Integral de Certeza Monetaria (Pesos vs Miles vs Millones)', () => {
  describe('1. Función Core: cleanCopAmount', () => {
    const cases: [string, number][] = [
      // Pesos individuales y bajos (sin miles)
      ['1', 1],
      ['$1', 1],
      ['$1.00', 1],
      ['$1,00', 1],
      ['10', 10],
      ['$10', 10],
      ['$10.00', 10],
      ['$10,00', 10],
      ['15', 15],
      ['$15.00', 15],
      ['$15,00', 15],
      ['50', 50],
      ['$50.00', 50],
      ['100', 100],
      ['$100.00', 100],
      ['$500', 500],
      ['$500.00', 500],
      ['$999', 999],
      ['$999.00', 999],

      // Miles exactos (1.000 a 999.999)
      ['1000', 1000],
      ['$1.000', 1000],
      ['$1.000,00', 1000],
      ['$1,000.00', 1000],
      ['$10.000', 10000],
      ['$10.000,00', 10000],
      ['$10,000.00', 10000],
      ['$15.000', 15000],
      ['$25.000', 25000],
      ['$29.900', 29900],
      ['$29.900,00', 29900],
      ['$29,900.00', 29900],
      ['29900', 29900],
      ['$50.000', 50000],
      ['$66.000', 66000],
      ['$100.000', 100000],
      ['$100.000,00', 100000],
      ['$250.000', 250000],
      ['$500.000', 500000],
      ['$999.999', 999999],

      // Millones (1.000.000+)
      ['1000000', 1000000],
      ['$1.000.000', 1000000],
      ['$1.000.000,00', 1000000],
      ['$1,000,000.00', 1000000],
      ['$1.250.000', 1250000],
      ['$1.500.000', 1500000],
      ['$1.500.000,00', 1500000],
      ['$1,500,000.00', 1500000],
      ['$2.350.500,00', 2350500],
      ['$10.000.000', 10000000],
      ['$25.000.000', 25000000],
      ['$100.000.000', 100000000],
    ];

    for (const [raw, expected] of cases) {
      it(`debe convertir "${raw}" exactamente a ${expected} COP sin confundir escalas`, () => {
        expect(cleanCopAmount(raw)).toBe(expected);
      });
    }
  });

  describe('2. Notificaciones Bancarias (SMS y App Push)', () => {
    it('debe diferenciar $10.00 (diez pesos) en SMS Bancolombia QR', () => {
      const text =
        'Bancolombia: MERCACREDITO, recibiste un pago de JEFFERSON TORO ALEGRIA por $10.00 en tu cuenta *5871 conectado a la llave 0079127304 el 21/11/2026 a las 13:02.';
      const res = parseBankingNotification(text);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.payment.amount).toBe(10);
        expect(res.payment.wallet).toBe('BANCOLOMBIA');
      }
    });

    it('debe diferenciar $15.00 (quince pesos) en SMS Bancolombia Llaves', () => {
      const text =
        'Bancolombia: JEFFERSON, recibiste una transferencia de YEISON STIVEN MURCIA CALVO por $15.00 en tu cuenta *5871 conectada a la llave @jefferson0769 el 21/11/26 a las 12:57.';
      const res = parseBankingNotification(text);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.payment.amount).toBe(15);
        expect(res.payment.wallet).toBe('BANCOLOMBIA');
      }
    });

    it('debe diferenciar $10.000 (diez mil pesos) en Nequi y nunca confundirlo con $10', () => {
      const text = '¡Te llegó plata! Te enviaron $10.000 a tu Nequi.';
      const res = parseBankingNotification(text, 'Nequi', 'com.nequi.MobileApp');
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.payment.amount).toBe(10000);
      }
    });

    it('debe diferenciar $29.900 (veintinueve mil novecientos) en Nequi/Daviplata', () => {
      const text = 'Te pasaron $29.900 de YEISON STIVEN MURCIA';
      const res = parseBankingNotification(text);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.payment.amount).toBe(29900);
      }
    });

    it('debe diferenciar $1.500.000 (un millón quinientos mil) y no confundirlo con 1500 ni 15', () => {
      const text = 'Te pasaron $1.500.000 de ANDRES FELIPE RUIZ';
      const res = parseBankingNotification(text);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.payment.amount).toBe(1500000);
      }
    });

    it('debe extraer $66.000 en notificación genérica Nequi/Bre-B', () => {
      const text = 'Te enviaron $66.000. Entra a tu app y revisa tu saldo.';
      const res = parseBankingNotification(text);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.payment.amount).toBe(66000);
      }
    });
  });

  describe('3. Correos Electrónicos (Gmail Webhooks)', () => {
    it('debe parsear $29.900 en correo oficial de Bre-B Daviplata (caso real del usuario)', () => {
      const email = {
        from: 'notificaciones@daviplata.com',
        subject: '¡Recibiste plata por Bre-B!',
        text: '¡Hola, Yeison Stiven Murcia Calvo!\n\nRecibiste 29.900 de YEISON STIVEN MURCIA CALVO el 21 de noviembre de 2026 a las 8:50 p.m, desde el banco Daviplata. Revisa el detalle en los movimientos de tu app o descarga el comprobante si lo necesitas.',
      };
      const res = parseInboundEmail(email);
      expect(res.success).toBe(true);
      if (res.success && res.type === 'PAYMENT') {
        expect(res.payment.amount).toBe(29900);
        expect(res.payment.senderName).toBe('Yeison Stiven Murcia Calvo');
      }
    });

    it('debe parsear $1.500.000,00 en correo de Nequi con formato tabla', () => {
      const email = {
        from: 'notificaciones@nequi.com',
        subject: '¡Te enviaron plata!',
        text: '¿Cuánto? $ 1.500.000,00\n¿Quién te la envió? CARLOS PEREZ\nNúmero de referencia: M1234567',
      };
      const res = parseInboundEmail(email);
      expect(res.success).toBe(true);
      if (res.success && res.type === 'PAYMENT') {
        expect(res.payment.amount).toBe(1500000);
        expect(res.payment.reference).toBe('M1234567');
      }
    });

    it('debe parsear $10.00 en correo de Bancolombia QR sin inflar a miles', () => {
      const email = {
        from: 'notificacionesbancolombia@bancolombia.com.co',
        subject: 'Transferencia recibida por QR',
        text: 'recibiste un pago de JEFFERSON TORO por $10.00 en tu cuenta *5871 conectado a la llave 0079127304.',
      };
      const res = parseInboundEmail(email);
      expect(res.success).toBe(true);
      if (res.success && res.type === 'PAYMENT') {
        expect(res.payment.amount).toBe(10);
      }
    });

    it('debe parsear $15.00 en correo de Bancolombia Llaves sin inflar a miles', () => {
      const email = {
        from: 'notificacionesbancolombia@bancolombia.com.co',
        subject: 'Transferencia recibida',
        text: 'recibiste una transferencia de YEISON STIVEN MURCIA CALVO por $15.00 en tu cuenta *5871.',
      };
      const res = parseInboundEmail(email);
      expect(res.success).toBe(true);
      if (res.success && res.type === 'PAYMENT') {
        expect(res.payment.amount).toBe(15);
      }
    });
  });
});
