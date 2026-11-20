import { cleanCopAmount, normalizeSenderName } from './engine.js';
import type {
  GoogleForwardingVerification,
  InboundEmailInput,
  InboundEmailParseResult,
  ParseResult,
} from './types.js';

/**
 * Convierte código HTML de correos en texto limpio para parsing determinista.
 */
export function stripHtml(html: string): string {
  if (!html) return '';

  return html
    // Convertir saltos de línea y celdas de tabla en espacios/saltos
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    // Eliminar etiquetas HTML
    .replace(/<[^>]+>/g, '')
    // Reemplazar entidades HTML comunes
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&Aacute;/gi, 'Á')
    .replace(/&Eacute;/gi, 'É')
    .replace(/&Iacute;/gi, 'Í')
    .replace(/&Oacute;/gi, 'Ó')
    .replace(/&Uacute;/gi, 'Ú')
    .replace(/&Ntilde;/gi, 'Ñ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Detecta y procesa correos de solicitud de reenvío automático enviados por Google (Gmail Forwarding).
 */
export function parseGoogleForwardingEmail(
  email: InboundEmailInput,
): GoogleForwardingVerification | null {
  const from = (email.from || '').toLowerCase();
  const subject = email.subject || '';
  const bodyText = (email.text || stripHtml(email.html || '')).trim();
  const combined = `${subject}\n${bodyText}`;

  // Si el correo contiene palabras clave explícitas de pagos o transferencias, nunca es verificación de Google
  if (
    /¡?recibiste plata|te enviaron plata|bre-b|comprobante|transferencia/i.test(subject) ||
    /¡?recibiste plata|te enviaron plata por bre-b/i.test(combined)
  ) {
    return null;
  }

  const isGoogleSubject =
    /solicitud de reenv[ií]o de gmail/i.test(subject) ||
    /confirmaci[oó]n de reenv[ií]o de gmail/i.test(subject) ||
    /gmail forwarding confirmation/i.test(subject) ||
    /reenv[ií]o de gmail/i.test(subject);

  const isGoogleSender =
    from.includes('forwarding-noreply@google.com') ||
    isGoogleSubject;

  if (!isGoogleSender && !isGoogleSubject) {
    return null;
  }

  // 1. Extraer código de verificación numérico (habitualmente 8 a 10 dígitos, típicamente 9)
  let verificationCode = '';
  const codeMatch =
    combined.match(
      /(?:c[oó]digo(?:\s+de\s+confirmaci[oó]n)?|confirmation\s+code|code)(?:\s+es|\s+is)?[:\s]*([0-9]{8,10})/i,
    ) ||
    combined.match(/(?:#|n[uú]mero)[:\s]*([0-9]{8,10})/i) ||
    combined.match(/\(#?([0-9]{8,10})\)/i) ||
    combined.match(/(?:confirmaci[oó]n|c[oó]digo|code)[^\d]*([0-9]{8,10})/i) ||
    combined.match(/\b([0-9]{9})\b/) ||
    combined.match(/\b([0-9]{8,10})\b/);

  if (codeMatch) {
    verificationCode = codeMatch[1].trim();
  }

  // 2. Extraer enlace de confirmación directa (Google suele usar mail-settings.google.com o mail.google.com)
  let confirmationUrl: string | undefined;
  const urlMatch =
    combined.match(
      /(https:\/\/(?:[a-zA-Z0-9.-]+\.)?google\.com\/mail\/[^\s"'>)]+)/i,
    ) ||
    combined.match(
      /(https:\/\/mail\.google\.com\/mail\/vf-[a-zA-Z0-9_\-]+)/i,
    );

  if (urlMatch) {
    confirmationUrl = urlMatch[1].trim();
  }

  // Si no contiene código de verificación numérico ni enlace de confirmación, no es una verificación de Google
  if (!verificationCode && !confirmationUrl) {
    return null;
  }

  // 3. Extraer correo de destino solicitado
  let requestedAddress: string | undefined = email.to?.trim();
  const addressMatch = combined.match(
    /(?:reenviar.*?(?:correo|electr[oó]nico|a)\s+|forward.*?(?:mail|to)\s+)([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
  );
  if (addressMatch) {
    requestedAddress = addressMatch[1].trim();
  }

  return {
    type: 'GOOGLE_FORWARDING_VERIFICATION',
    verificationCode,
    confirmationUrl,
    requestedAddress,
    rawText: combined,
  };
}

// Patrones de descarte para correos de Nequi que no son pagos entrantes
const NEQUI_EMAIL_NEGATIVE_PATTERNS = [
  /\b(clave din[aá]mica|nuevo inicio de sesi[oó]n|c[oó]digo de seguridad|cambio de clave|restablecer tu clave)\b/i,
  /\b(enviaste plata|pagaste\s+\$|env[ií]o exitoso|retiro exitoso|sacaste plata)\b/i,
  /\b(conoce las nuevas tarifas|disfruta de descuentos|pr[eé]stamo salvavidas)\b/i,
];

/**
 * Parsea un comprobante de transferencia entrante emitido por Nequi a través de correo electrónico.
 */
export function parseNequiEmailReceipt(email: InboundEmailInput): ParseResult {
  const subject = email.subject || '';
  const bodyText = (email.text || stripHtml(email.html || '')).trim();
  const combined = `${subject}\n${bodyText}`;

  // 1. Filtrar alertas de seguridad y salidas de dinero
  for (const neg of NEQUI_EMAIL_NEGATIVE_PATTERNS) {
    if (neg.test(combined)) {
      return {
        success: false,
        error: 'NOT_A_PAYMENT',
        reason: 'El correo corresponde a seguridad, cambio de clave o transacción saliente',
      };
    }
  }

  // 2. Extraer Monto
  let rawAmount = '';
  const amountPatterns = [
    /¿Cu[aá]nto\?[:\s]*([\$\d.,\s]+)/i,
    /Valor[:\s]*([\$\d.,\s]+)/i,
    /Monto[:\s]*([\$\d.,\s]+)/i,
    /Valor recibido[:\s]*([\$\d.,\s]+)/i,
    /(?:Te enviaron|recibiste)\s+([\$\d.,\s]+?)(?:\s+de\s+|\s+a tu Nequi|\s+en Nequi|\s+por Bre-B|\.|$)/i,
    /(?:Te enviaron|recibiste)\s+([\$\d.,\s]+)/i,
  ];

  for (const pat of amountPatterns) {
    const m = combined.match(pat);
    if (m && m[1]) {
      rawAmount = m[1];
      break;
    }
  }

  const amount = cleanCopAmount(rawAmount);
  if (amount <= 0) {
    return {
      success: false,
      error: 'NOT_A_PAYMENT',
      reason: 'No se pudo identificar un monto válido en el correo de Nequi',
    };
  }

  // 3. Extraer Remitente
  let rawSender = '';
  const senderPatterns = [
    /(?:recibiste|te enviaron)\s+[\$\d.,\s]+\s+de\s+([a-zA-Z\s]+?)(?:\s+el|\s+a las|\s+desde|\.|$)/i,
    /(?:^|\n)\s*¿Qui[eé]n te la envi[oó]\?[:\s]*([^\n\r]+)/i,
    /(?:^|\n)\s*Env[ií]a[:\s]*([^\n\r]+)/i,
    /(?:^|\n)\s*Nombre[:\s]*([^\n\r]+)/i,
    /(?:^|\n)\s*recibiste plata de[:\s]*([^\n\r]+)/i,
    /(?:^|\n)\s*De[:\s]+([^\n\r]+)/i,
  ];

  for (const pat of senderPatterns) {
    const m = combined.match(pat);
    if (m && m[1]) {
      const candidate = m[1].replace(/[.;,]+$/, '').trim();
      // Asegurarse de que no capture líneas de cabecera como "¿De qué cuenta?" o "envío"
      if (
        candidate &&
        !/^(?:env[ií]o|transacci[oó]n|cuenta|banco|fecha|referencia)$/i.test(candidate) &&
        !/cuenta|banco|fecha|referencia/i.test(candidate)
      ) {
        rawSender = candidate;
        break;
      }
    }
  }

  let senderName = rawSender ? normalizeSenderName(rawSender) : '';
  if (!senderName) {
    // Si el comprobante confirma que le enviaron plata pero no detalla el nombre del pagador
    if (/Bre-B/i.test(combined)) {
      senderName = 'Transferencia Bre-B';
    } else {
      senderName = 'Transferencia Nequi';
    }
  }

  // 4. Extraer Referencia Bancaria (M1234567, etc.)
  let reference: string | null = null;
  // Limpiar URLs antes de buscar la referencia para no capturar hashes o fragmentos de tracking
  const textWithoutUrls = combined.replace(/https?:\/\/[^\s"'<>]+/gi, '');
  const refMatch = textWithoutUrls.match(
    /(?:N[uú]mero\s+de\s+referencia|Referencia|Nro\.?\s*de\s+transacci[oó]n|\bRef\b)[:\s#]*([a-zA-Z0-9]{5,})/i,
  );
  if (refMatch && refMatch[1]) {
    reference = refMatch[1].trim().toUpperCase();
  }

  return {
    success: true,
    payment: {
      wallet: 'NEQUI',
      amount,
      senderName,
      reference,
      rawText: combined,
    },
  };
}

// Patrones de descarte para correos de Bancolombia que no son abonos entrantes
const BANCOLOMBIA_EMAIL_NEGATIVE_PATTERNS = [
  /\b(clave din[aá]mica|nuevo inicio de sesi[oó]n|c[oó]digo de seguridad|cambio de clave|restablecer tu clave)\b/i,
  /\b(compra por\s+\$|compraste\s+\$|pagaste\s+\$|transferiste\s+\$|retiro por\s+\$|retiro en cajero)\b/i,
  /\b(informaci[oó]n de tus llaves|conoce las nuevas tarifas|disfruta de descuentos)\b/i,
];

/**
 * Parsea un comprobante de transferencia entrante emitido por Bancolombia por correo electrónico.
 */
export function parseBancolombiaEmailReceipt(email: InboundEmailInput): ParseResult {
  const subject = email.subject || '';
  const bodyText = (email.text || stripHtml(email.html || '')).trim();
  const combined = `${subject}\n${bodyText}`;

  // 1. Filtrar alertas de seguridad, claves dinámicas y transacciones salientes
  for (const neg of BANCOLOMBIA_EMAIL_NEGATIVE_PATTERNS) {
    if (neg.test(combined)) {
      return {
        success: false,
        error: 'NOT_A_PAYMENT',
        reason: 'El correo corresponde a seguridad, clave dinámica o transacción saliente',
      };
    }
  }

  // 2. Extraer Monto
  let rawAmount = '';
  const amountPatterns = [
    /recibiste una transferencia de\s+.*?\s+por\s+([\$\d.,\s]+?)(?:\s+en tu cuenta|\.|$|\s+el)/i,
    /recibiste una transferencia\s+por\s+([\$\d.,\s]+?)(?:\s+de\s+|\s+en tu cuenta|\.|$)/i,
    /recibiste un pago de\s+.*?\s+por\s+([\$\d.,\s]+?)(?:\s+en tu cuenta|\.|$)/i,
    /Te transfirieron\s+([\$\d.,\s]+?)(?:\s+por Transfiya|\s+a trav[eé]s de Transfiya|\s+de\s+|\s+a tu cuenta|\.|$)/i,
    /Valor[:\s]*([\$\d.,\s]+)/i,
    /Monto[:\s]*([\$\d.,\s]+)/i,
    /(?:recibiste|te enviaron)\s+([\$\d.,\s]+)/i,
  ];

  for (const pat of amountPatterns) {
    const m = combined.match(pat);
    if (m && m[1]) {
      rawAmount = m[1];
      break;
    }
  }

  const amount = cleanCopAmount(rawAmount);
  if (amount <= 0) {
    return {
      success: false,
      error: 'NOT_A_PAYMENT',
      reason: 'No se pudo identificar un monto válido en el correo de Bancolombia',
    };
  }

  // 3. Extraer Remitente
  let rawSender = '';
  const senderPatterns = [
    /recibiste una transferencia de\s+([a-zA-ZÁÉÍÓÚÑáéíóúñ\s]+?)\s+por\s+[\$\d.,\s]+/i,
    /recibiste una transferencia por\s+[\$\d.,\s]+\s+de\s+([a-zA-ZÁÉÍÓÚÑáéíóúñ\s]+?)(?:\s+en tu cuenta|\.|$|\s+el)/i,
    /recibiste un pago de\s+([a-zA-ZÁÉÍÓÚÑáéíóúñ\s]+?)\s+por\s+[\$\d.,\s]+/i,
    /Te transfirieron\s+[\$\d.,\s]+(?:\s+por Transfiya|\s+a trav[eé]s de Transfiya)?\s+de\s+([a-zA-ZÁÉÍÓÚÑáéíóúñ\s]+?)(?:\s+en tu cuenta|\.|$|\s+el)/i,
    /(?:^|\n)\s*De[:\s]+([^\n\r]+)/i,
  ];

  for (const pat of senderPatterns) {
    const m = combined.match(pat);
    if (m && m[1]) {
      const candidate = m[1].replace(/[.;,]+$/, '').trim();
      if (
        candidate &&
        !/^(?:cuenta|banco|fecha|referencia)$/i.test(candidate) &&
        !/cuenta|banco|fecha|referencia/i.test(candidate)
      ) {
        rawSender = candidate;
        break;
      }
    }
  }

  let senderName = rawSender ? normalizeSenderName(rawSender) : '';
  if (!senderName) {
    senderName = 'Transferencia Bancolombia';
  }

  // 4. Extraer Referencia o Cuenta (*5871)
  let reference: string | null = null;
  const refMatch = combined.match(
    /(?:en tu cuenta\s+(\*\d+)|conectada a la llave\s+(@?[a-zA-Z0-9._-]+)|(?:N[uú]mero\s+de\s+referencia|Referencia|Nro\.?\s*de\s+transacci[oó]n|\bRef\b)[:\s#]*([a-zA-Z0-9*]{4,}))/i,
  );
  if (refMatch) {
    reference = (refMatch[1] || refMatch[2] || refMatch[3] || '').trim();
  }

  return {
    success: true,
    payment: {
      wallet: 'BANCOLOMBIA',
      amount,
      senderName,
      reference,
      rawText: combined,
    },
  };
}

/**
 * Enrutador principal de Inbound Email para la Ruta Cloud de TransferYA.
 */
export function parseInboundEmail(
  email: InboundEmailInput,
): InboundEmailParseResult {
  // 1. Evaluar si es correo de verificación de reenvío de Google
  const googleVerification = parseGoogleForwardingEmail(email);
  if (googleVerification) {
    return {
      success: true,
      type: 'GOOGLE_VERIFICATION',
      verification: googleVerification,
    };
  }

  const from = (email.from || '').toLowerCase();
  const subject = email.subject || '';
  const bodyText = email.text || email.html || '';
  const combined = `${from}\n${subject}\n${bodyText}`;

  // 2. Evaluar si proviene de o menciona Bancolombia
  const isBancolombia =
    /bancolombia/i.test(from) ||
    /notificacionesbancolombia/i.test(from) ||
    /bancolombia/i.test(subject) ||
    /bancolombia:/i.test(bodyText);

  if (isBancolombia) {
    const bancolombiaResult = parseBancolombiaEmailReceipt(email);
    if (bancolombiaResult.success) {
      return {
        success: true,
        type: 'PAYMENT',
        payment: bancolombiaResult.payment,
      };
    }
    return {
      success: false,
      error: 'NOT_A_PAYMENT',
      reason: bancolombiaResult.reason,
    };
  }

  // 3. Evaluar si es comprobante de pago de Nequi
  const nequiResult = parseNequiEmailReceipt(email);
  if (nequiResult.success) {
    return {
      success: true,
      type: 'PAYMENT',
      payment: nequiResult.payment,
    };
  }

  return {
    success: false,
    error: 'NOT_A_PAYMENT',
    reason: nequiResult.reason,
  };
}
