import { describe, expect, it } from 'vitest';
import {
  calculateTurnClosing,
  detectWallet,
  formatClosingWhatsAppMessage,
  isCountableTransaction,
  type TransactionSummaryItem,
} from '../calculator.js';

describe('Paso A — Módulo de Cierre de Turno y Cuadre de Caja en 1 Clic', () => {
  it('debe detectar correctamente si una transacción es Nequi o DaviPlata', () => {
    expect(detectWallet({ wallet_package: 'com.nequi.MobileApp' })).toBe('NEQUI');
    expect(detectWallet({ wallet_package: 'com.daviplata.appfintech' })).toBe('DAVIPLATA');
    expect(detectWallet({ raw_text: 'Recibiste $50.000 de Daviplata' })).toBe('DAVIPLATA');
    expect(detectWallet({ raw_title: 'Nequi: Te transfirieron $20.000' })).toBe('NEQUI');
  });

  it('debe filtrar transacciones no válidas o con monto cero', () => {
    expect(isCountableTransaction({ amount: 15000, status: 'VALIDATED' })).toBe(true);
    expect(isCountableTransaction({ amount: 50000, status: 'CONFIRMED' })).toBe(true);
    expect(isCountableTransaction({ amount: 20000, status: 'DELIVERED' })).toBe(true);
    expect(isCountableTransaction({ amount: 0, status: 'VALIDATED' })).toBe(false);
    expect(isCountableTransaction({ amount: 10000, status: 'IGNORED_SUSPENDED_ACCOUNT' })).toBe(false);
    expect(isCountableTransaction({ amount: 10000, status: 'FAILED' })).toBe(false);
  });

  it('debe calcular con precisión el cuadre solicitado por el usuario: Nequi $185.000 (12 pagos), DaviPlata $94.000 (6 pagos), Gran Total $279.000', () => {
    // 12 transacciones de Nequi que suman $185.000
    const nequiTxs: TransactionSummaryItem[] = [
      { amount: 50000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
      { amount: 25000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
      { amount: 20000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
      { amount: 15000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
      { amount: 15000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
      { amount: 10000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
      { amount: 10000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
      { amount: 10000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
      { amount: 10000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
      { amount: 10000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
      { amount: 5000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
      { amount: 5000, wallet_package: 'com.nequi.MobileApp', status: 'VALIDATED' },
    ];

    // 6 transacciones de DaviPlata que suman $94.000
    const daviTxs: TransactionSummaryItem[] = [
      { amount: 40000, wallet_package: 'com.daviplata.appfintech', status: 'VALIDATED' },
      { amount: 20000, wallet_package: 'com.daviplata.appfintech', status: 'VALIDATED' },
      { amount: 15000, wallet_package: 'com.daviplata.appfintech', status: 'VALIDATED' },
      { amount: 10000, wallet_package: 'com.daviplata.appfintech', status: 'VALIDATED' },
      { amount: 5000, wallet_package: 'com.daviplata.appfintech', status: 'VALIDATED' },
      { amount: 4000, wallet_package: 'com.daviplata.appfintech', status: 'VALIDATED' },
    ];

    // Transacción fallida o simulada de prueba que no debe sumar
    const invalidTx: TransactionSummaryItem = {
      amount: 999999,
      wallet_package: 'com.nequi.MobileApp',
      status: 'IGNORED_SUSPENDED_ACCOUNT',
    };

    const all = [...nequiTxs, ...daviTxs, invalidTx];

    const result = calculateTurnClosing({
      merchantName: 'Panadería La Esperanza',
      deviceLabel: 'Caja 1 - Principal',
      scopeLabel: 'Turno Mañana',
      transactions: all,
    });

    // Validar desglose Nequi
    expect(result.nequiSum).toBe(185000);
    expect(result.nequiCount).toBe(12);

    // Validar desglose DaviPlata
    expect(result.daviSum).toBe(94000);
    expect(result.daviCount).toBe(6);

    // Validar Gran Total
    expect(result.totalSum).toBe(279000);
    expect(result.totalCount).toBe(18);

    // Validar ticket promedio
    expect(result.avgTicket).toBe(15500); // 279.000 / 18 = 15.500
  });

  it('debe formatear el mensaje de WhatsApp con formato comercial impecable listo para enviar al dueño', () => {
    const summary = {
      merchantName: 'Minimarket Los Paisas',
      deviceLabel: 'Caja 1',
      scopeLabel: 'Turno Hoy Completo',
      nequiSum: 185000,
      nequiCount: 12,
      daviSum: 94000,
      daviCount: 6,
      totalSum: 279000,
      totalCount: 18,
      avgTicket: 15500,
    };

    const waMessage = formatClosingWhatsAppMessage(summary, {
      formattedDate: 'jue., 12 nov. 2026 • 10:20 p. m.',
      firstPayment: '08:14 a. m.',
      lastPayment: '10:15 p. m.',
    });

    expect(waMessage).toContain('*CIERRE DE CAJA — MINIMARKET LOS PAISAS*');
    expect(waMessage).toContain('🟣 *Total Nequi:* $ 185.000 COP (12 pagos)');
    expect(waMessage).toContain('🔴 *Total DaviPlata:* $ 94.000 COP (6 pagos)');
    expect(waMessage).toContain('💰 *GRAN TOTAL DEL TURNO:* $ 279.000 COP (18 pagos)');
    expect(waMessage).toContain('⏱️ Primer pago: 08:14 a. m.');
    expect(waMessage).toContain('⏱️ Último pago: 10:15 p. m.');
    expect(waMessage).toContain('TransferYA');
  });
});
