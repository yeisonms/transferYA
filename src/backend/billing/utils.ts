import { randomBytes } from 'node:crypto';
import { normalizePhoneNumberE164 } from '../../domain/routing/phone-utils.js';

// Caracteres seguros para evitar confusión humana (sin 0, O, 1, I)
const BASE32_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Genera un código de referencia comercial alfanumérico único e inequívoco.
 * Ejemplo: `TYA-7B8K2M`
 */
export function generateInvoiceReferenceCode(prefix = 'TYA', length = 6): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return `${prefix}-${code}`.toUpperCase();
}

/**
 * Extrae posibles códigos de referencia de pago desde el texto crudo o campo de referencia.
 * Reconoce patrones oficiales como `TYA-XXXXXX` o referencias bancarias alfanuméricas.
 */
export function extractReferenceCodesFromText(text: string | null | undefined): string[] {
  if (!text) return [];

  const found = new Set<string>();

  // 1. Patrón oficial TransferYA: TYA-XXXXXX
  const tyaMatches = text.match(/\b(TYA-[A-Z0-9]{4,10})\b/gi);
  if (tyaMatches) {
    for (const m of tyaMatches) {
      found.add(m.toUpperCase());
    }
  }

  // 2. Patrón de referencia bancaria genérica Ref: M12345678 o Ref: 123456
  const refMatches = text.matchAll(/(?:ref(?:erencia)?[:\s\-]+)([A-Z0-9]{5,12})\b/gi);
  for (const match of refMatches) {
    if (match[1]) {
      found.add(match[1].toUpperCase());
    }
  }

  return Array.from(found);
}

/**
 * Extrae números celulares colombianos (10 dígitos comenzando en 3) desde cualquier texto
 * y los normaliza a formato ITU-T E.164 (+573...).
 */
export function extractColombianPhoneNumbers(text: string | null | undefined): string[] {
  if (!text) return [];

  const found = new Set<string>();

  // Patrón para capturar celulares en Colombia:
  // Admite opcionalmente +57 o 57 al inicio y separadores como espacios, guiones o puntos.
  const phoneRegex = /(?:(?:\+?57)?\s*)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})\b/g;

  let match: RegExpExecArray | null;
  while ((match = phoneRegex.exec(text)) !== null) {
    const rawDigits = match[1].replace(/[\s.-]/g, '');
    if (rawDigits.length === 10 && rawDigits.startsWith('3')) {
      try {
        const normalized = normalizePhoneNumberE164(rawDigits);
        found.add(normalized);
      } catch {
        // Ignorar si falla la validación E.164
      }
    }
  }

  return Array.from(found);
}
