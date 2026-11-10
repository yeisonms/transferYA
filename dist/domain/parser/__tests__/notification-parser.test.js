import { describe, it, expect } from 'vitest';
import { parseBankingNotification, cleanCopAmount, normalizeSenderName, } from '../engine.js';
describe('Motor de Parsing de Notificaciones Bancarias (Ticket 08)', () => {
    describe('1. Utilidades Puras de Limpieza de Montos y Nombres', () => {
        it('debe limpiar montos en formato colombiano a numero entero estricto', () => {
            expect(cleanCopAmount('$15.000')).toBe(15000);
            expect(cleanCopAmount('15,000.00')).toBe(15000);
            expect(cleanCopAmount('$ 1.500.000')).toBe(1500000);
            expect(cleanCopAmount('50000')).toBe(50000);
            expect(cleanCopAmount('$25,000')).toBe(25000);
            expect(cleanCopAmount('$ 2.350.500,00')).toBe(2350500);
        });
        it('debe normalizar nombres latinos con tildes, enie y espacios multiples', () => {
            expect(normalizeSenderName('  JUAN   CARLOS   MUÑOZ  ')).toBe('Juan Carlos Muñoz');
            expect(normalizeSenderName('ÁNGEL MARÍA PEÑA')).toBe('Ángel María Peña');
            expect(normalizeSenderName('pepito perez')).toBe('Pepito Perez');
            expect(normalizeSenderName('ÍÑIGO BUSTAMANTE')).toBe('Íñigo Bustamante');
        });
    });
    describe('2. Extracción Exitosa en Nequi', () => {
        it('debe parsear abono estandar: ¡Plata recibida! Juan Perez te envió $15.000 a tu Nequi', () => {
            const rawText = '¡Plata recibida! Juan Perez te envió $15.000 a tu Nequi.';
            const res = parseBankingNotification(rawText, 'Nequi', 'com.nequi.MobileApp');
            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.payment.wallet).toBe('NEQUI');
                expect(res.payment.amount).toBe(15000);
                expect(res.payment.senderName).toBe('Juan Perez');
                expect(res.payment.rawText).toBe(rawText);
            }
        });
        it('debe parsear formato con saldo: Te transfirieron $50.000 de Pepito Pérez (Saldo: $150.000)', () => {
            const rawText = 'Te transfirieron $50.000 de Pepito Pérez (Saldo: $150.000)';
            const res = parseBankingNotification(rawText, 'Nequi', 'com.nequi.MobileApp');
            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.payment.wallet).toBe('NEQUI');
                expect(res.payment.amount).toBe(50000);
                expect(res.payment.senderName).toBe('Pepito Pérez');
            }
        });
        it('debe parsear transferencias por Transfiya entrantes a Nequi', () => {
            const rawText = 'Te enviaron $30.000 por Transfiya de Carlos Mendoza.';
            const res = parseBankingNotification(rawText, 'Nequi', 'com.nequi.MobileApp');
            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.payment.wallet).toBe('NEQUI');
                expect(res.payment.amount).toBe(30000);
                expect(res.payment.senderName).toBe('Carlos Mendoza');
            }
        });
        it('debe parsear montos millonarios y nombres en mayusculas sostenidas', () => {
            const rawText = 'Te pasaron $1.250.000 de ANDRES FELIPE RUIZ';
            const res = parseBankingNotification(rawText, 'Nequi');
            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.payment.wallet).toBe('NEQUI');
                expect(res.payment.amount).toBe(1250000);
                expect(res.payment.senderName).toBe('Andres Felipe Ruiz');
            }
        });
        it('debe parsear notificacion estandar y referencia: Te acaban de enviar $1.000 en Nequi. Ref: M78998319', () => {
            const rawText = 'Te acaban de enviar $1.000 en Nequi. Ref: M78998319';
            const res = parseBankingNotification(rawText, 'Nequi', 'com.nequi.MobileApp');
            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.payment.wallet).toBe('NEQUI');
                expect(res.payment.amount).toBe(1000);
                expect(res.payment.senderName).toBe('Nequi');
                expect(res.payment.reference).toBe('M78998319');
            }
        });
        it('debe parsear notificacion generica de Nequi sin remitente explicito', () => {
            const rawText = '¡Te llegó plata! Te enviaron $10.000 a tu Nequi.';
            const res = parseBankingNotification(rawText, 'Nequi', 'com.nequi.MobileApp');
            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.payment.wallet).toBe('NEQUI');
                expect(res.payment.amount).toBe(10000);
                expect(res.payment.senderName).toBe('Nequi');
            }
        });
    });
    describe('3. Extracción Exitosa en Daviplata', () => {
        it('debe parsear abono oficial: DaviPlata le informa que recibio $25.000 de Laura Gomez', () => {
            const rawText = 'DaviPlata le informa que recibio $25.000 de Laura Gomez';
            const res = parseBankingNotification(rawText, 'DaviPlata', 'com.davivienda.daviplata');
            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.payment.wallet).toBe('DAVIPLATA');
                expect(res.payment.amount).toBe(25000);
                expect(res.payment.senderName).toBe('Laura Gomez');
            }
        });
        it('debe parsear formato con mayusculas: Recibiste una transferencia de $50.000 de MARIA GOMEZ', () => {
            const rawText = 'Recibiste una transferencia de $50.000 de MARIA GOMEZ';
            const res = parseBankingNotification(rawText, 'DaviPlata', 'com.davivienda.daviplata');
            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.payment.wallet).toBe('DAVIPLATA');
                expect(res.payment.amount).toBe(50000);
                expect(res.payment.senderName).toBe('Maria Gomez');
            }
        });
        it('debe parsear formato con decimales: DaviPlata: Recibiste $100,000.00 de Pedro Picapiedra', () => {
            const rawText = 'DaviPlata: Recibiste $100,000.00 de Pedro Picapiedra';
            const res = parseBankingNotification(rawText, 'DaviPlata');
            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.payment.wallet).toBe('DAVIPLATA');
                expect(res.payment.amount).toBe(100000);
                expect(res.payment.senderName).toBe('Pedro Picapiedra');
            }
        });
    });
    describe('4. Rechazo Estricto de Falsos Positivos (Anti-Fraude y Publicidad)', () => {
        it('debe rechazar notificaciones promocionales de Nequi y Daviplata', () => {
            const promo1 = '¡Pide tu tarjeta Nequi hoy y disfruta de descuentos!';
            const promo2 = 'Conoce el nuevo crédito salvavidas que DaviPlata tiene para ti.';
            const res1 = parseBankingNotification(promo1, 'Nequi');
            const res2 = parseBankingNotification(promo2, 'DaviPlata');
            expect(res1.success).toBe(false);
            if (!res1.success) {
                expect(res1.error).toBe('NOT_A_PAYMENT');
            }
            expect(res2.success).toBe(false);
            if (!res2.success) {
                expect(res2.error).toBe('NOT_A_PAYMENT');
            }
        });
        it('debe rechazar retiros de cajero o corresponsal bancario', () => {
            const retiro1 = 'Retiro exitoso de cajero por $50.000. Tu nuevo saldo es $20.000.';
            const retiro2 = 'Sacaste $100.000 de tu Nequi en cajero Bancolombia.';
            const res1 = parseBankingNotification(retiro1, 'DaviPlata');
            const res2 = parseBankingNotification(retiro2, 'Nequi');
            expect(res1.success).toBe(false);
            if (!res1.success) {
                expect(res1.error).toBe('NOT_A_PAYMENT');
            }
            expect(res2.success).toBe(false);
            if (!res2.success) {
                expect(res2.error).toBe('NOT_A_PAYMENT');
            }
        });
        it('debe rechazar pagos salientes y débitos (evitar falsos abonos)', () => {
            const salida1 = 'Enviaste plata a 3001234567 por $20.000.';
            const salida2 = 'Pagaste $45.000 en Supermercado La 14 con tu tarjeta.';
            const salida3 = 'Enviaste $15.000 de tu Nequi a Juan Perez.';
            const res1 = parseBankingNotification(salida1, 'Nequi');
            const res2 = parseBankingNotification(salida2, 'DaviPlata');
            const res3 = parseBankingNotification(salida3, 'Nequi');
            expect(res1.success).toBe(false);
            if (!res1.success) {
                expect(res1.error).toBe('NOT_A_PAYMENT');
            }
            expect(res2.success).toBe(false);
            if (!res2.success) {
                expect(res2.error).toBe('NOT_A_PAYMENT');
            }
            expect(res3.success).toBe(false);
            if (!res3.success) {
                expect(res3.error).toBe('NOT_A_PAYMENT');
            }
        });
        it('debe rechazar avisos de seguridad y claves dinamicas', () => {
            const seguridad1 = 'Tu clave dinámica es 948123. No la compartas con nadie.';
            const seguridad2 = 'Detectamos un nuevo inicio de sesión en tu cuenta Nequi.';
            const res1 = parseBankingNotification(seguridad1, 'DaviPlata');
            const res2 = parseBankingNotification(seguridad2, 'Nequi');
            expect(res1.success).toBe(false);
            if (!res1.success) {
                expect(res1.error).toBe('NOT_A_PAYMENT');
            }
            expect(res2.success).toBe(false);
            if (!res2.success) {
                expect(res2.error).toBe('NOT_A_PAYMENT');
            }
        });
    });
});
