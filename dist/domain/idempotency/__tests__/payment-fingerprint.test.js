import { describe, expect, it } from 'vitest';
import { generatePaymentFingerprint, generateCanonicalPaymentFingerprint, InMemoryPaymentFingerprintRepository, normalizeSenderForFingerprint, } from '../fingerprint.js';
describe('Motor de Huella de Idempotencia para Pagos P2P (Ticket 09)', () => {
    const baseReceipt = {
        wallet: 'NEQUI',
        amount: 50000,
        senderName: 'Carlos Andres Gomez',
        reference: 'M123456',
        rawText: 'Carlos Andres Gomez te envio $50.000 a tu Nequi',
    };
    describe('1. Normalización Agresiva de Remitente (normalizeSenderForFingerprint)', () => {
        it('debe convertir a minúsculas y colapsar espacios múltiples y extremos', () => {
            const normalized = normalizeSenderForFingerprint('   CARLOS    ANDRES   GOMEZ   ');
            expect(normalized).toBe('carlos andres gomez');
        });
        it('debe remover tildes y diacríticos preservando los caracteres base (ej. PÉREZ -> perez)', () => {
            expect(normalizeSenderForFingerprint('MARÍA JOSÉ PÉREZ')).toBe('maria jose perez');
        });
        it('debe normalizar la eñe a n para coincidir con sistemas bancarios que degradan a ASCII (ej. MUÑOZ -> munoz)', () => {
            expect(normalizeSenderForFingerprint('Iñaki Muñoz')).toBe('inaki munoz');
            expect(normalizeSenderForFingerprint('INAKI MUNOZ')).toBe('inaki munoz');
        });
        it('debe remover caracteres especiales y símbolos no alfabéticos residuales', () => {
            expect(normalizeSenderForFingerprint('Juan-Pablo C. D’Angelo')).toBe('juan pablo c dangelo');
        });
        it('debe lanzar error si el nombre del remitente es vacío o solo espacios', () => {
            expect(() => normalizeSenderForFingerprint('')).toThrow(/nombre de remitente no puede estar vacio/i);
            expect(() => normalizeSenderForFingerprint('   \t\n  ')).toThrow(/nombre de remitente no puede estar vacio/i);
        });
    });
    describe('2. Generación Determinista de Huella (generatePaymentFingerprint)', () => {
        const fixedTimestamp = 1715000000000; // Epoch ms fijo
        it('debe retornar un hash SHA-256 hexadecimal en minúsculas de 64 caracteres', () => {
            const fp = generatePaymentFingerprint(baseReceipt, fixedTimestamp);
            expect(fp).toMatch(/^[a-f0-9]{64}$/);
        });
        it('debe ser estrictamente determinista ante idénticos parámetros', () => {
            const fp1 = generatePaymentFingerprint(baseReceipt, fixedTimestamp);
            const fp2 = generatePaymentFingerprint(baseReceipt, fixedTimestamp);
            expect(fp1).toBe(fp2);
        });
        it('debe generar la MISMA huella ante variaciones ortográficas de mayúsculas o tildes del remitente', () => {
            const receiptWithAccents = {
                ...baseReceipt,
                senderName: '  CARLOS ANDRÉS GÓMEZ  ',
            };
            const receiptPlain = {
                ...baseReceipt,
                senderName: 'carlos andres gomez',
            };
            const fpWithAccents = generatePaymentFingerprint(receiptWithAccents, fixedTimestamp);
            const fpPlain = generatePaymentFingerprint(receiptPlain, fixedTimestamp);
            expect(fpWithAccents).toBe(fpPlain);
        });
    });
    describe('3. Agrupamiento en Ventana Temporal (Time Bucketing 5 min)', () => {
        // Escogemos un timestamp base alineado al inicio de un bucket de 5 minutos
        // 5 min = 300_000 ms
        const bucketStart = 1715000100000;
        it('debe generar la MISMA huella para dos notificaciones separadas por 45s (ej. Push y SMS en ráfaga)', () => {
            const pushArrival = bucketStart + 5_000; // 5 segundos después
            const smsArrival = bucketStart + 50_000; // 50 segundos después (45s de diferencia)
            const pushFp = generatePaymentFingerprint(baseReceipt, pushArrival);
            const smsFp = generatePaymentFingerprint(baseReceipt, smsArrival);
            expect(pushFp).toBe(smsFp);
        });
        it('debe generar la MISMA huella para notificaciones dentro de la misma ventana de 5 minutos', () => {
            const t1 = bucketStart + 10_000;
            const t2 = bucketStart + 280_000; // 4 minutos y 40 segundos después, mismo bucket
            const fp1 = generatePaymentFingerprint(baseReceipt, t1);
            const fp2 = generatePaymentFingerprint(baseReceipt, t2);
            expect(fp1).toBe(fp2);
        });
        it('debe generar huellas DIFERENTES si la transacción ocurre en una ventana posterior (ej. 6 minutos después)', () => {
            const t1 = bucketStart + 10_000;
            const tNextBucket = bucketStart + 360_000; // 6 minutos después (bucket siguiente)
            const fp1 = generatePaymentFingerprint(baseReceipt, t1);
            const fp2 = generatePaymentFingerprint(baseReceipt, tNextBucket);
            expect(fp1).not.toBe(fp2);
        });
    });
    describe('4. Sensibilidad y Resistencia a Colisiones', () => {
        const fixedTimestamp = 1715000000000;
        it('debe generar huellas DIFERENTES si el monto varía en 1 peso', () => {
            const fp1 = generatePaymentFingerprint({ ...baseReceipt, amount: 50000 }, fixedTimestamp);
            const fp2 = generatePaymentFingerprint({ ...baseReceipt, amount: 50001 }, fixedTimestamp);
            expect(fp1).not.toBe(fp2);
        });
        it('debe generar huellas DIFERENTES si la billetera es distinta', () => {
            const fpNequi = generatePaymentFingerprint({ ...baseReceipt, wallet: 'NEQUI' }, fixedTimestamp);
            const fpDaviplata = generatePaymentFingerprint({ ...baseReceipt, wallet: 'DAVIPLATA' }, fixedTimestamp);
            expect(fpNequi).not.toBe(fpDaviplata);
        });
        it('debe generar huellas DIFERENTES si el remitente es otra persona', () => {
            const fp1 = generatePaymentFingerprint({ ...baseReceipt, senderName: 'Carlos Andres Gomez' }, fixedTimestamp);
            const fp2 = generatePaymentFingerprint({ ...baseReceipt, senderName: 'Carlos Andres Lopez' }, fixedTimestamp);
            expect(fp1).not.toBe(fp2);
        });
    });
    describe('5. Manejo de Parámetros Hostiles e Inválidos', () => {
        const validTimestamp = 1715000000000;
        it('debe rechazar montos menores o iguales a cero o no enteros', () => {
            expect(() => generatePaymentFingerprint({ ...baseReceipt, amount: 0 }, validTimestamp)).toThrow(/monto debe ser un entero positivo/i);
            expect(() => generatePaymentFingerprint({ ...baseReceipt, amount: -1000 }, validTimestamp)).toThrow(/monto debe ser un entero positivo/i);
            expect(() => generatePaymentFingerprint({ ...baseReceipt, amount: 1500.5 }, validTimestamp)).toThrow(/monto debe ser un entero positivo/i);
        });
        it('debe rechazar timestamps negativos o no numéricos', () => {
            expect(() => generatePaymentFingerprint(baseReceipt, -1)).toThrow(/timestamp de captura invalido/i);
            expect(() => generatePaymentFingerprint(baseReceipt, Number.NaN)).toThrow(/timestamp de captura invalido/i);
        });
        it('debe rechazar ventanas de tiempo no positivas', () => {
            expect(() => generatePaymentFingerprint(baseReceipt, validTimestamp, 0)).toThrow(/ventana de tiempo invalida/i);
            expect(() => generatePaymentFingerprint(baseReceipt, validTimestamp, -5)).toThrow(/ventana de tiempo invalida/i);
        });
    });
    describe('6. Contrato de Repositorio de Huellas de Idempotencia (InMemoryPaymentFingerprintRepository)', () => {
        it('debe registrar exitosamente un nuevo pago y marcar isDuplicate = false', async () => {
            const repo = new InMemoryPaymentFingerprintRepository();
            const record = {
                deviceId: 'dev_centinela_caja_1',
                fingerprint: 'a'.repeat(64),
                wallet: 'NEQUI',
                amount: 30000,
                senderName: 'Laura Restrepo',
                capturedAt: Date.now(),
            };
            const result = await repo.registerFingerprint(record);
            expect(result.isDuplicate).toBe(false);
            expect(result.existingRecord).toBeUndefined();
            const found = await repo.findByFingerprint(record.deviceId, record.fingerprint);
            expect(found).toBeDefined();
            expect(found?.deviceId).toBe(record.deviceId);
            expect(found?.fingerprint).toBe(record.fingerprint);
        });
        it('debe detectar duplicidad cuando se intenta registrar la misma huella en el mismo dispositivo', async () => {
            const repo = new InMemoryPaymentFingerprintRepository();
            const record = {
                deviceId: 'dev_centinela_caja_1',
                fingerprint: 'b'.repeat(64),
                wallet: 'DAVIPLATA',
                amount: 85000,
                senderName: 'Jhonathan Ruiz',
                capturedAt: Date.now(),
            };
            const firstResult = await repo.registerFingerprint(record);
            expect(firstResult.isDuplicate).toBe(false);
            // Segundo intento con la misma huella en el mismo Centinela
            const secondResult = await repo.registerFingerprint(record);
            expect(secondResult.isDuplicate).toBe(true);
            expect(secondResult.existingRecord).toBeDefined();
            expect(secondResult.existingRecord?.fingerprint).toBe(record.fingerprint);
        });
        it('NO debe colisionar si la misma huella ocurre en dos dispositivos Centinela distintos (aislamiento multi-tenant)', async () => {
            const repo = new InMemoryPaymentFingerprintRepository();
            const sharedFingerprint = 'c'.repeat(64);
            const recordDeviceA = {
                deviceId: 'dev_centinela_tienda_norte',
                fingerprint: sharedFingerprint,
                wallet: 'NEQUI',
                amount: 20000,
                senderName: 'Pedro Navaja',
                capturedAt: Date.now(),
            };
            const recordDeviceB = {
                deviceId: 'dev_centinela_tienda_sur',
                fingerprint: sharedFingerprint,
                wallet: 'NEQUI',
                amount: 20000,
                senderName: 'Pedro Navaja',
                capturedAt: Date.now(),
            };
            const resA = await repo.registerFingerprint(recordDeviceA);
            const resB = await repo.registerFingerprint(recordDeviceB);
            expect(resA.isDuplicate).toBe(false);
            expect(resB.isDuplicate).toBe(false);
        });
        it('DEBE colisionar y deduplicar si dos canales distintos (Centinela Push y Cloud Email) reportan el mismo pago para el MISMO comercio (merchantId)', async () => {
            const repo = new InMemoryPaymentFingerprintRepository();
            const sharedFingerprint = 'd'.repeat(64);
            const merchantId = 'merchant_sinverguenceria_123';
            // Canal A: Llega primero el Centinela Android (T = 0s)
            const recordPush = {
                deviceId: 'dev_centinela_caja_principal',
                merchantId,
                fingerprint: sharedFingerprint,
                wallet: 'NEQUI',
                amount: 50000,
                senderName: 'Carlos Andres Gomez',
                capturedAt: 1715000000000,
            };
            const pushResult = await repo.registerFingerprint(recordPush);
            expect(pushResult.isDuplicate).toBe(false);
            // Canal B: Llega 15 segundos después el Reenvío de Gmail a la Ruta Cloud
            const recordEmail = {
                deviceId: 'cloud_inbound_email',
                merchantId, // Mismo comercio
                fingerprint: sharedFingerprint,
                wallet: 'NEQUI',
                amount: 50000,
                senderName: 'Carlos Andres Gomez',
                capturedAt: 1715000015000,
            };
            const emailResult = await repo.registerFingerprint(recordEmail);
            expect(emailResult.isDuplicate).toBe(true);
            expect(emailResult.existingRecord).toBeDefined();
            expect(emailResult.existingRecord?.deviceId).toBe('dev_centinela_caja_principal');
        });
        it('NO debe colisionar si dos comercios distintos reciben una transferencia con huella idéntica (merchantId distinto)', async () => {
            const repo = new InMemoryPaymentFingerprintRepository();
            const sharedFingerprint = 'e'.repeat(64);
            const recordMerchantA = {
                deviceId: 'dev_centinela_1',
                merchantId: 'merchant_panaderia_a',
                fingerprint: sharedFingerprint,
                wallet: 'NEQUI',
                amount: 10000,
                senderName: 'Maria Lopez',
                capturedAt: Date.now(),
            };
            const recordMerchantB = {
                deviceId: 'cloud_inbound_email',
                merchantId: 'merchant_restaurante_b',
                fingerprint: sharedFingerprint,
                wallet: 'NEQUI',
                amount: 10000,
                senderName: 'Maria Lopez',
                capturedAt: Date.now(),
            };
            const resA = await repo.registerFingerprint(recordMerchantA);
            const resB = await repo.registerFingerprint(recordMerchantB);
            expect(resA.isDuplicate).toBe(false);
            expect(resB.isDuplicate).toBe(false);
        });
    });
    describe('7. Huella Canónica Multicanal (generateCanonicalPaymentFingerprint)', () => {
        it('debe generar la MISMA huella exacta para Push y Correo si ambos tienen la misma referencia de Nequi', () => {
            const pushReceipt = {
                wallet: 'NEQUI',
                amount: 45000,
                senderName: 'Juan Carlos Restrepo',
                reference: 'M87654321',
                rawText: 'Te enviaron $45.000. Ref: M87654321',
            };
            const emailReceipt = {
                wallet: 'NEQUI',
                amount: 45000,
                senderName: 'JUAN CARLOS RESTREPO',
                reference: 'M87654321',
                rawText: 'Comprobante Nequi. Monto: $45.000. Referencia: M87654321',
            };
            // Aunque lleguen con 20 minutos de diferencia (buckets temporales distintos)
            const fpPush = generateCanonicalPaymentFingerprint(pushReceipt, 1715000000000);
            const fpEmail = generateCanonicalPaymentFingerprint(emailReceipt, 1715001200000);
            expect(fpPush).toBe(fpEmail);
            expect(fpPush).toMatch(/^[a-f0-9]{64}$/);
        });
        it('debe recurrir al time-bucket de 10 min si no hay referencia explícita', () => {
            const receiptNoRef = {
                wallet: 'NEQUI',
                amount: 25000,
                senderName: 'Diana Uribe',
                reference: null,
                rawText: 'Te enviaron $25.000',
            };
            const t1 = 1715000000000;
            const t2 = t1 + 30_000; // 30 segundos después (mismo bucket de 10 min)
            const fp1 = generateCanonicalPaymentFingerprint(receiptNoRef, t1, 10);
            const fp2 = generateCanonicalPaymentFingerprint(receiptNoRef, t2, 10);
            expect(fp1).toBe(fp2);
        });
    });
});
