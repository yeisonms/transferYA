import type { ParsedPaymentReceipt, SupportedWallet } from '../domain/parser/types.js';
import type { PaymentAlertOptions } from './types.js';

/**
 * Formatea un monto numérico entero en formato de moneda colombiana (COP).
 * Ejemplo: 50000 -> "$ 50.000"
 */
export function formatCopCurrency(amount: number): string {
  if (
    typeof amount !== 'number' ||
    Number.isNaN(amount) ||
    amount <= 0 ||
    !Number.isInteger(amount)
  ) {
    throw new Error(
      'El monto debe ser un entero positivo en pesos colombianos (COP)',
    );
  }

  const formatted = amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$ ${formatted}`;
}

/**
 * Formatea un timestamp epoch ms en una hora legible colombiana (UTC-5 / America/Bogota).
 * Formato determinista HH:mm:ss en 24 horas.
 */
export function formatCapturedTime(
  timestamp: number,
  timezone = 'America/Bogota',
): string {
  if (
    typeof timestamp !== 'number' ||
    Number.isNaN(timestamp) ||
    timestamp < 0
  ) {
    throw new Error('Timestamp de captura invalido');
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return formatter.format(new Date(timestamp));
}

/**
 * Formatea un timestamp epoch ms en hora amigable comercial en formato de 12 horas (ej. "02:45 p. m.").
 */
export function formatFriendlyCapturedTime(
  timestamp: number,
  timezone = 'America/Bogota',
): string {
  if (
    typeof timestamp !== 'number' ||
    Number.isNaN(timestamp) ||
    timestamp < 0
  ) {
    throw new Error('Timestamp de captura invalido');
  }

  const formatter = new Intl.DateTimeFormat('es-CO', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return formatter.format(new Date(timestamp));
}

/**
 * Normaliza el nombre legible de la billetera digital para visualización al cajero.
 */
export function formatWalletDisplayName(wallet: SupportedWallet): string {
  if (wallet === 'NEQUI') {
    return 'Nequi';
  }
  if (wallet === 'DAVIPLATA') {
    return 'Daviplata';
  }
  return wallet;
}

/**
 * Retorna el distintivo visual (emoji + nombre) de la billetera.
 */
export function formatWalletBadge(wallet: SupportedWallet): {
  emoji: string;
  name: string;
  combined: string;
} {
  if (wallet === 'NEQUI') {
    return { emoji: '🟣', name: 'Nequi', combined: '🟣 Nequi' };
  }
  if (wallet === 'DAVIPLATA') {
    return { emoji: '🔴', name: 'DaviPlata', combined: '🔴 DaviPlata' };
  }
  return { emoji: '⚡', name: wallet, combined: `⚡ ${wallet}` };
}

/**
 * Normaliza el número de teléfono para la API de Meta.
 * Meta Graph API requiere dígitos puros sin el signo '+' ni separadores.
 * Ejemplo: "+57 300 123-4567" -> "573001234567"
 */
export function formatRecipientForMeta(phone: string): string {
  if (!phone || typeof phone !== 'string') {
    throw new Error('Numero de destinatario invalido');
  }

  const digits = phone.trim().replace(/\D/g, '');
  if (!digits) {
    throw new Error('Numero de destinatario invalido');
  }

  return digits;
}

/**
 * Construye la plantilla de notificación de WhatsApp 100% humanizada para cajeros.
 * Diseñada para brindar tranquilidad total al cajero al entregar la mercancía:
 *
 * "✅ ¡Pago Confirmado en Caja 1!"
 * "🟣 Nequi: $ 35.000"
 * "👤 Cliente: Carlos Andrés Gómez"
 * "⏰ Hora: 02:45 p. m. — Saldo validado"
 */
export function buildHumanizedPaymentAlertText(
  payment: ParsedPaymentReceipt,
  options: PaymentAlertOptions,
): string {
  const formattedAmount = formatCopCurrency(payment.amount);
  const badge = formatWalletBadge(payment.wallet);
  const friendlyTime = formatFriendlyCapturedTime(options.capturedAt);
  const boxTitle = options.deviceLabel || (options.cashierName ? `Caja de ${options.cashierName}` : 'Caja 1');
  const clientName =
    payment.senderName &&
    payment.senderName.trim() !== '' &&
    payment.senderName.toLowerCase() !== 'desconocido'
      ? payment.senderName.trim()
      : 'Cliente Billetera';

  const refPart = payment.reference ? `\n🧾 Ref: *${payment.reference}*` : '';
  const staleNote = options.isStale
    ? `\n_(Nota: reporte registrado con retraso de red, saldo 100% en tu cuenta)_`
    : '';

  return (
    `✅ *¡Pago Confirmado en ${boxTitle}!* 💰\n\n` +
    `${badge.combined}: *${formattedAmount}*\n` +
    `👤 *Cliente:* ${clientName}\n` +
    `⏰ *Hora:* ${friendlyTime} — *Saldo validado*` +
    `${refPart}${staleNote}\n\n` +
    `_👍 Entrega la mercancía con tranquilidad. Verificado en tiempo real con TransferYA._`
  );
}
