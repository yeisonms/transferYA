import { describe, expect, it } from 'vitest';
import {
  extractColombianPhoneNumbers,
  extractReferenceCodesFromText,
  generateInvoiceReferenceCode,
} from '../utils.js';

describe('Utilidades de Facturación y Referencias Dogfooding (Ticket 22)', () => {
  describe('generateInvoiceReferenceCode', () => {
    it('debe generar códigos con prefijo TYA y formato válido', () => {
      const code1 = generateInvoiceReferenceCode();
      const code2 = generateInvoiceReferenceCode();

      expect(code1).toMatch(/^TYA-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      expect(code2).toMatch(/^TYA-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      expect(code1).not.toBe(code2);
    });

    it('debe admitir prefijo personalizado', () => {
      const custom = generateInvoiceReferenceCode('MURSAT', 8);
      expect(custom.startsWith('MURSAT-')).toBe(true);
      expect(custom.length).toBe('MURSAT-'.length + 8);
    });
  });

  describe('extractReferenceCodesFromText', () => {
    it('debe extraer códigos de referencia oficiales TYA-XXXXXX', () => {
      const text = 'Pago recibido en caja. Ref: TYA-7B8K2M gracias por su compra';
      const extracted = extractReferenceCodesFromText(text);

      expect(extracted).toContain('TYA-7B8K2M');
    });

    it('debe extraer referencias bancarias genéricas Ref: M123456', () => {
      const text = 'Te enviaron $50.000 a tu Nequi. Ref: M78998319';
      const extracted = extractReferenceCodesFromText(text);

      expect(extracted).toContain('M78998319');
    });

    it('debe manejar texto vacío o nulo sin errores', () => {
      expect(extractReferenceCodesFromText('')).toEqual([]);
      expect(extractReferenceCodesFromText(null)).toEqual([]);
      expect(extractReferenceCodesFromText(undefined)).toEqual([]);
    });
  });

  describe('extractColombianPhoneNumbers', () => {
    it('debe extraer y normalizar números de 10 dígitos a formato E.164 (+57...) sin duplicados', () => {
      const text = 'EDWIN MURCIA (3113654315) te envió dinero desde su 311 365 4315';
      const phones = extractColombianPhoneNumbers(text);

      expect(phones).toEqual(['+573113654315']);
    });

    it('debe manejar prefijo +57 o 57 explícito', () => {
      const text = 'Remitente: +573113654315 y otro número 573201234567';
      const phones = extractColombianPhoneNumbers(text);

      expect(phones).toContain('+573113654315');
      expect(phones).toContain('+573201234567');
    });

    it('debe ignorar números fijos o cadenas con longitud diferente a celular colombiano', () => {
      const text = 'Teléfono fijo 6012345678 o código 123456';
      const phones = extractColombianPhoneNumbers(text);

      expect(phones).toEqual([]);
    });
  });
});
