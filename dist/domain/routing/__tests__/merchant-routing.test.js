import { beforeEach, describe, expect, it } from 'vitest';
import { isValidE164, normalizePhoneNumberE164 } from '../phone-utils.js';
import { InMemoryMerchantRoutingRepository, MerchantRoutingService, } from '../service.js';
describe('Módulo de Mapeo Comercio-Dispositivo-Cajero (Ticket 10)', () => {
    describe('1. Utilidades de Validación y Normalización E.164 (phone-utils)', () => {
        it('isValidE164 debe retornar true para números con prefijo internacional válido', () => {
            expect(isValidE164('+573001234567')).toBe(true); // Celular Colombia
            expect(isValidE164('+14155552671')).toBe(true); // USA
            expect(isValidE164('+34612345678')).toBe(true); // España
        });
        it('isValidE164 debe retornar false para números sin el signo más (+)', () => {
            expect(isValidE164('573001234567')).toBe(false);
            expect(isValidE164('3001234567')).toBe(false);
        });
        it('isValidE164 debe retornar false para números con caracteres inválidos o longitud fuera de estándar', () => {
            expect(isValidE164('+57300ABC456')).toBe(false);
            expect(isValidE164('+123')).toBe(false); // Demasiado corto (< 7 dígitos)
            expect(isValidE164('+12345678901234567')).toBe(false); // Demasiado largo (> 15 dígitos)
            expect(isValidE164('')).toBe(false);
        });
        it('normalizePhoneNumberE164 debe limpiar espacios, guiones y paréntesis', () => {
            expect(normalizePhoneNumberE164('+57 300 123-4567')).toBe('+573001234567');
            expect(normalizePhoneNumberE164('+57 (300) 123 4567')).toBe('+573001234567');
        });
        it('normalizePhoneNumberE164 debe anteponer el prefijo internacional por defecto si es celular local de 10 dígitos', () => {
            expect(normalizePhoneNumberE164('3001234567')).toBe('+573001234567');
            expect(normalizePhoneNumberE164('  310 987 6543  ')).toBe('+573109876543');
        });
        it('normalizePhoneNumberE164 debe lanzar error si el número resultante es inválido', () => {
            expect(() => normalizePhoneNumberE164('12345')).toThrow(/numero de telefono no valido en formato e.164/i);
            expect(() => normalizePhoneNumberE164('abc-xyz')).toThrow(/numero de telefono no valido en formato e.164/i);
        });
    });
    describe('2. Servicio de Enrutamiento de Comercios y Cajeros (MerchantRoutingService)', () => {
        let repo;
        let service;
        const now = 1715000000000;
        const activeMerchant = {
            id: 'merchant_farmacia_123',
            name: 'Farmacia San Jorge',
            status: 'ACTIVE',
            subscriptionExpiresAt: now + 86400000 * 30, // 30 días de vigencia
            createdAt: now - 86400000,
        };
        const cashierPrincipal = {
            id: 'caja_1',
            merchantId: activeMerchant.id,
            deviceId: 'dev_centinela_caja_1',
            name: 'Caja 1 Turno Mañana',
            phoneNumber: '+573001112233',
            isActive: true,
        };
        const cashierSecundario = {
            id: 'caja_2',
            merchantId: activeMerchant.id,
            deviceId: null, // Aplica a todas las cajas del comercio
            name: 'Supervisor General',
            phoneNumber: '+573009998877',
            isActive: true,
        };
        const cashierInactivo = {
            id: 'caja_inactiva',
            merchantId: activeMerchant.id,
            deviceId: 'dev_centinela_caja_1',
            name: 'Cajero Despedido',
            phoneNumber: '+573005554433',
            isActive: false,
        };
        beforeEach(() => {
            repo = new InMemoryMerchantRoutingRepository();
            service = new MerchantRoutingService({
                repository: repo,
                nowProvider: () => now,
            });
        });
        it('debe enrutar exitosamente a un comercio activo y retornar únicamente cajeros activos normalizados', async () => {
            repo.registerDeviceMerchant('dev_centinela_caja_1', activeMerchant);
            repo.registerCashierRecipient(cashierPrincipal);
            repo.registerCashierRecipient(cashierSecundario);
            repo.registerCashierRecipient(cashierInactivo);
            const result = await service.resolveRoute('dev_centinela_caja_1');
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.merchant.id).toBe(activeMerchant.id);
                expect(result.recipients).toHaveLength(2);
                expect(result.recipients.map((r) => r.id)).toEqual(['caja_1', 'caja_2']);
                // Verificar que el inactivo fue excluido
                expect(result.recipients.some((r) => r.id === 'caja_inactiva')).toBe(false);
            }
        });
        it('debe fallar si el Dispositivo Centinela no está mapeado a ningún comercio', async () => {
            const result = await service.resolveRoute('dev_desconocido');
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.reason).toBe('DEVICE_NOT_MAPPED');
                expect(result.message).toMatch(/dispositivo centinela no vinculado/i);
            }
        });
        it('debe bloquear el despacho si el comercio se encuentra en estado SUSPENDED', async () => {
            const suspendedMerchant = {
                ...activeMerchant,
                status: 'SUSPENDED',
            };
            repo.registerDeviceMerchant('dev_centinela_suspendido', suspendedMerchant);
            repo.registerCashierRecipient({
                ...cashierPrincipal,
                merchantId: suspendedMerchant.id,
            });
            const result = await service.resolveRoute('dev_centinela_suspendido');
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.reason).toBe('SUBSCRIPTION_SUSPENDED');
                expect(result.message).toMatch(/pausado o suspendido/i);
                expect(result.merchant?.status).toBe('SUSPENDED');
            }
        });
        it('debe bloquear el despacho si la suscripción del comercio está vencida', async () => {
            const expiredMerchant = {
                ...activeMerchant,
                subscriptionExpiresAt: now - 1000, // Expiró hace 1 segundo
            };
            repo.registerDeviceMerchant('dev_centinela_vencido', expiredMerchant);
            repo.registerCashierRecipient({
                ...cashierPrincipal,
                merchantId: expiredMerchant.id,
            });
            const result = await service.resolveRoute('dev_centinela_vencido');
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.reason).toBe('SUBSCRIPTION_PAST_DUE');
                expect(result.message).toMatch(/suscripcion del comercio expirada/i);
            }
        });
        it('debe fallar si el comercio no tiene ningún cajero activo registrado', async () => {
            repo.registerDeviceMerchant('dev_centinela_sin_cajeros', activeMerchant);
            repo.registerCashierRecipient(cashierInactivo); // Único cajero está inactivo
            const result = await service.resolveRoute('dev_centinela_sin_cajeros');
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.reason).toBe('NO_ACTIVE_RECIPIENTS');
                expect(result.message).toMatch(/no hay destinatarios de caja activos/i);
            }
        });
        it('debe descartar cajeros con números telefónicos inválidos y normalizar los válidos', async () => {
            const cashierBadNumber = {
                id: 'caja_bad_phone',
                merchantId: activeMerchant.id,
                deviceId: 'dev_centinela_caja_1',
                name: 'Cajero Con Mal Teléfono',
                phoneNumber: 'invalido_123',
                isActive: true,
            };
            const cashierLocalPhone = {
                id: 'caja_local_phone',
                merchantId: activeMerchant.id,
                deviceId: 'dev_centinela_caja_1',
                name: 'Cajero Con Teléfono Local',
                phoneNumber: '315 123 4567', // Requiere normalización a +573151234567
                isActive: true,
            };
            repo.registerDeviceMerchant('dev_centinela_caja_1', activeMerchant);
            repo.registerCashierRecipient(cashierBadNumber);
            repo.registerCashierRecipient(cashierLocalPhone);
            const result = await service.resolveRoute('dev_centinela_caja_1');
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.recipients).toHaveLength(1);
                expect(result.recipients[0].id).toBe('caja_local_phone');
                expect(result.recipients[0].phoneNumber).toBe('+573151234567');
            }
        });
    });
});
