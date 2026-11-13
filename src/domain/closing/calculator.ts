/**
 * TransferYA — Módulo de Cierre de Turno y Arqueo de Caja
 * Calcula el desglose de ingresos Nequi vs DaviPlata y formatea el reporte para WhatsApp y PDF.
 */

export interface TransactionSummaryItem {
  id?: string;
  amount: number | string;
  wallet_package?: string;
  raw_title?: string;
  raw_text?: string;
  status: string;
  device_id?: string;
  captured_at?: number;
  created_at?: string;
  sender_name?: string;
}

export interface TurnClosingSummary {
  merchantName: string;
  deviceLabel: string;
  scopeLabel: string;
  nequiSum: number;
  nequiCount: number;
  daviSum: number;
  daviCount: number;
  totalSum: number;
  totalCount: number;
  avgTicket: number;
}

const VALID_STATUSES = new Set(['VALIDATED', 'CONFIRMED', 'DELIVERED', 'COMPLETED']);

export function detectWallet(item: Pick<TransactionSummaryItem, 'wallet_package' | 'raw_title' | 'raw_text'>): 'NEQUI' | 'DAVIPLATA' {
  const pkg = (item.wallet_package || '').toLowerCase();
  const title = (item.raw_title || '').toLowerCase();
  const text = (item.raw_text || '').toLowerCase();
  if (pkg.includes('daviplata') || title.includes('daviplata') || text.includes('daviplata')) {
    return 'DAVIPLATA';
  }
  return 'NEQUI';
}

export function isCountableTransaction(item: TransactionSummaryItem): boolean {
  return VALID_STATUSES.has(item.status) && Number(item.amount) > 0;
}

export function calculateTurnClosing(params: {
  merchantName: string;
  deviceLabel?: string;
  scopeLabel?: string;
  transactions: TransactionSummaryItem[];
}): TurnClosingSummary {
  let nequiSum = 0;
  let nequiCount = 0;
  let daviSum = 0;
  let daviCount = 0;

  for (const tx of params.transactions) {
    if (!isCountableTransaction(tx)) continue;
    const amt = Number(tx.amount) || 0;
    const wallet = detectWallet(tx);
    if (wallet === 'NEQUI') {
      nequiSum += amt;
      nequiCount++;
    } else {
      daviSum += amt;
      daviCount++;
    }
  }

  const totalSum = nequiSum + daviSum;
  const totalCount = nequiCount + daviCount;
  const avgTicket = totalCount > 0 ? Math.round(totalSum / totalCount) : 0;

  return {
    merchantName: params.merchantName,
    deviceLabel: params.deviceLabel || 'Todas las Cajas',
    scopeLabel: params.scopeLabel || 'Turno Actual',
    nequiSum,
    nequiCount,
    daviSum,
    daviCount,
    totalSum,
    totalCount,
    avgTicket,
  };
}

export function formatClosingWhatsAppMessage(summary: TurnClosingSummary, options?: { formattedDate?: string; firstPayment?: string; lastPayment?: string }): string {
  const fmt = (n: number) => Number(n || 0).toLocaleString('es-CO');
  const dateStr = options?.formattedDate || 'Hoy';

  return (
    `📊 *CIERRE DE CAJA — ${summary.merchantName.toUpperCase()}*\n` +
    `🗓️ *Fecha:* ${dateStr}\n` +
    `🏪 *Caja:* ${summary.deviceLabel}\n` +
    `⏱️ *Rango:* ${summary.scopeLabel}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🟣 *Total Nequi:* $ ${fmt(summary.nequiSum)} COP (${summary.nequiCount} ${summary.nequiCount === 1 ? 'pago' : 'pagos'})\n` +
    `🔴 *Total DaviPlata:* $ ${fmt(summary.daviSum)} COP (${summary.daviCount} ${summary.daviCount === 1 ? 'pago' : 'pagos'})\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *GRAN TOTAL DEL TURNO:* $ ${fmt(summary.totalSum)} COP (${summary.totalCount} pagos)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    (options?.firstPayment ? `⏱️ Primer pago: ${options.firstPayment}\n` : '') +
    (options?.lastPayment ? `⏱️ Último pago: ${options.lastPayment}\n` : '') +
    `📈 Ticket promedio: $ ${fmt(summary.avgTicket)} COP\n\n` +
    `_✅ Cuadre verificado en tiempo real con TransferYA_`
  );
}

