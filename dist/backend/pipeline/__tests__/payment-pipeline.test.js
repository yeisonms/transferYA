import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryPaymentFingerprintRepository } from '../../../domain/idempotency/fingerprint.js';
import { InMemoryMerchantRoutingRepository, MerchantRoutingService, } from '../../../domain/routing/service.js';
import { PaymentProcessingPipeline } from '../orchestrator.js';
import { BillingReconciliationService } from '../../billing/reconciliation.js';
class InMemoryPipelineNotificationRepository {
    notifications = new Map();
    updates = [];
    seed(record) {
        this.notifications.set(record.id, record);
    }
    async getNotificationById(id) {
        return this.notifications.get(id) ?? null;
    }
    async updateNotification(id, update) {
        const existing = this.notifications.get(id);
        if (existing) {
            this.notifications.set(id, {
                ...existing,
                ...update,
            });
        }
        this.updates.push({ id, update });
    }
}
describe('Orquestador de Procesamiento de Pagos y Despacho WhatsApp (Ticket 12)', () => {
    let notificationRepo;
    let fingerprintRepo;
    let routingRepo;
    let routingService;
    let mockWhatsappClient;
    let pipeline;
    const now = 1715000000000;
    const deviceId = 'dev_centinela_caja_1';
    const merchant = {
        id: 'merchant_minimarket_el_sol',
        name: 'Minimarket El Sol',
        status: 'ACTIVE',
        subscriptionExpiresAt: now + 86400000 * 30,
        createdAt: now - 86400000,
    };
    const cashier1 = {
        id: 'caja_1',
        merchantId: merchant.id,
        deviceId: deviceId,
        name: 'Cajero Principal',
        phoneNumber: '+573001112233',
        isActive: true,
    };
    const cashier2 = {
        id: 'caja_2',
        merchantId: merchant.id,
        deviceId: null, // Global
        name: 'Dueño Administrador',
        phoneNumber: '+573009998877',
        isActive: true,
    };
    beforeEach(() => {
        notificationRepo = new InMemoryPipelineNotificationRepository();
        fingerprintRepo = new InMemoryPaymentFingerprintRepository();
        routingRepo = new InMemoryMerchantRoutingRepository();
        routingRepo.registerDeviceMerchant(deviceId, merchant);
        routingRepo.registerCashierRecipient(cashier1);
        routingRepo.registerCashierRecipient(cashier2);
        routingService = new MerchantRoutingService({
            repository: routingRepo,
            nowProvider: () => now,
        });
        mockWhatsappClient = {
            sendTemplate: vi.fn(),
            sendPaymentAlert: vi.fn(),
            sendSubscriptionNotice: vi.fn().mockResolvedValue({
                success: true,
                messageId: 'wamid.BILLING_NOTICE_DEFAULT',
            }),
            sendRenewalConfirmation: vi.fn().mockResolvedValue({
                success: true,
                messageId: 'wamid.RENEWAL_CONFIRM_DEFAULT',
            }),
        };
        pipeline = new PaymentProcessingPipeline({
            notificationRepository: notificationRepo,
            fingerprintRepository: fingerprintRepo,
            routingService,
            whatsappClient: mockWhatsappClient,
            nowProvider: () => now,
        });
    });
    it('1. Flujo Feliz E2E Completo (Nequi - Notificación Regular)', async () => {
        const notification = {
            id: 'notif_nequi_001',
            deviceId,
            walletPackage: 'com.nequi.MobileApp',
            rawTitle: 'Nequi',
            rawText: '¡Plata recibida! Juan Perez te envió $45.000 a tu Nequi.',
            capturedAt: now - 2000,
            dispatchedAt: now - 1500,
            receivedAt: now,
            latencyMs: 2000,
            isStale: false,
            status: 'RECEIVED',
        };
        notificationRepo.seed(notification);
        vi.spyOn(mockWhatsappClient, 'sendPaymentAlert').mockResolvedValue({
            success: true,
            messageId: 'wamid.HBgL_MSG_123',
        });
        const result = await pipeline.processCapturedNotification('notif_nequi_001');
        expect(result.status).toBe('PROCESSED');
        if (result.status === 'PROCESSED') {
            expect(result.receipt.amount).toBe(45000);
            expect(result.receipt.senderName).toBe('Juan Perez');
            expect(result.receipt.wallet).toBe('NEQUI');
            expect(result.merchantId).toBe(merchant.id);
            expect(result.dispatches).toHaveLength(2);
            expect(result.dispatches.every((d) => d.success)).toBe(true);
        }
        // Verificar que WhatsApp client fue llamado para cada cajero activo con isStale = false
        expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledTimes(2);
        expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledWith('+573001112233', expect.objectContaining({ amount: 45000 }), expect.objectContaining({ isStale: false }));
        // Verificar actualización final en el repositorio
        const updated = await notificationRepo.getNotificationById('notif_nequi_001');
        expect(updated?.status).toBe('PROCESSED');
        expect(updated?.amount).toBe(45000);
        expect(updated?.senderName).toBe('Juan Perez');
    });
    it('2. Flujo Feliz E2E con Stale Alert (Daviplata - Latencia > 90s)', async () => {
        const notification = {
            id: 'notif_daviplata_stale_002',
            deviceId,
            walletPackage: 'com.davivienda.daviplata',
            rawTitle: 'Daviplata',
            rawText: 'Recibiste una transferencia de $120.000 de MARIA GOMEZ',
            capturedAt: now - 120000,
            dispatchedAt: now - 500,
            receivedAt: now,
            latencyMs: 120000, // 2 minutos de retraso
            isStale: true,
            status: 'RECEIVED',
        };
        notificationRepo.seed(notification);
        vi.spyOn(mockWhatsappClient, 'sendPaymentAlert').mockResolvedValue({
            success: true,
            messageId: 'wamid.HBgL_STALE_MSG_456',
        });
        const result = await pipeline.processCapturedNotification('notif_daviplata_stale_002');
        expect(result.status).toBe('PROCESSED');
        if (result.status === 'PROCESSED') {
            expect(result.receipt.amount).toBe(120000);
            expect(result.receipt.senderName).toBe('Maria Gomez');
            expect(result.receipt.wallet).toBe('DAVIPLATA');
        }
        // Comprobar que sendPaymentAlert recibió isStale: true
        expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ amount: 120000 }), expect.objectContaining({ isStale: true, latencyMs: 120000 }));
    });
    it('3. Descarte de Falsos Positivos (Notificaciones no monetarias -> IGNORED_NON_PAYMENT)', async () => {
        const notification = {
            id: 'notif_promo_003',
            deviceId,
            walletPackage: 'com.nequi.MobileApp',
            rawTitle: 'Nequi',
            rawText: '¡Pide tu tarjeta de crédito Nequi sin cuota de manejo hoy!',
            capturedAt: now,
            dispatchedAt: now,
            receivedAt: now,
            latencyMs: 100,
            isStale: false,
            status: 'RECEIVED',
        };
        notificationRepo.seed(notification);
        const result = await pipeline.processCapturedNotification('notif_promo_003');
        expect(result.status).toBe('IGNORED_NON_PAYMENT');
        // WhatsApp NO debe ser invocado
        expect(mockWhatsappClient.sendPaymentAlert).not.toHaveBeenCalled();
        const updated = await notificationRepo.getNotificationById('notif_promo_003');
        expect(updated?.status).toBe('IGNORED_NON_PAYMENT');
    });
    it('4. Deduplicación por Huella de Idempotencia (DUPLICATE_PAYMENT)', async () => {
        const notificationA = {
            id: 'notif_payment_original',
            deviceId,
            walletPackage: 'com.nequi.MobileApp',
            rawTitle: 'Nequi',
            rawText: 'Carlos Andres te envio $30.000 a tu Nequi',
            capturedAt: now,
            dispatchedAt: now,
            receivedAt: now,
            latencyMs: 100,
            isStale: false,
            status: 'RECEIVED',
        };
        const notificationDuplicate = {
            id: 'notif_payment_sms_burst',
            deviceId,
            walletPackage: 'com.nequi.MobileApp',
            rawTitle: 'Nequi SMS',
            rawText: 'Carlos Andres te envio $30.000 a tu Nequi',
            capturedAt: now + 30000, // 30s después (mismo bucket de 5 min)
            dispatchedAt: now + 30000,
            receivedAt: now + 30000,
            latencyMs: 100,
            isStale: false,
            status: 'RECEIVED',
        };
        notificationRepo.seed(notificationA);
        notificationRepo.seed(notificationDuplicate);
        vi.spyOn(mockWhatsappClient, 'sendPaymentAlert').mockResolvedValue({
            success: true,
            messageId: 'wamid.FIRST_PAYMENT',
        });
        // 1er procesamiento: Exitoso
        const result1 = await pipeline.processCapturedNotification('notif_payment_original');
        expect(result1.status).toBe('PROCESSED');
        expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledTimes(2);
        // 2do procesamiento del duplicado en ráfaga: Debe ser descartado por idempotencia
        const result2 = await pipeline.processCapturedNotification('notif_payment_sms_burst');
        expect(result2.status).toBe('DUPLICATE_PAYMENT');
        if (result2.status === 'DUPLICATE_PAYMENT') {
            expect(result2.fingerprint).toBeDefined();
        }
        // Los llamados a WhatsApp no deben haber aumentado (siguen en 2)
        expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledTimes(2);
        const updatedDup = await notificationRepo.getNotificationById('notif_payment_sms_burst');
        expect(updatedDup?.status).toBe('DUPLICATE_PAYMENT');
    });
    it('5. Fallo de Enrutamiento (Dispositivo no mapeado -> ROUTING_FAILED)', async () => {
        const notification = {
            id: 'notif_merchant_unmapped',
            deviceId: 'dev_no_registrado',
            walletPackage: 'com.nequi.MobileApp',
            rawTitle: 'Nequi',
            rawText: 'Laura te envio $25.000 a tu Nequi',
            capturedAt: now,
            dispatchedAt: now,
            receivedAt: now,
            latencyMs: 100,
            isStale: false,
            status: 'RECEIVED',
        };
        notificationRepo.seed(notification);
        const result = await pipeline.processCapturedNotification('notif_merchant_unmapped');
        expect(result.status).toBe('ROUTING_FAILED');
        expect(mockWhatsappClient.sendPaymentAlert).not.toHaveBeenCalled();
        const updated = await notificationRepo.getNotificationById('notif_merchant_unmapped');
        expect(updated?.status).toBe('ROUTING_FAILED');
    });
    it('6. Fallo Total de Despacho en WhatsApp (DISPATCH_FAILED)', async () => {
        const notification = {
            id: 'notif_meta_down',
            deviceId,
            walletPackage: 'com.nequi.MobileApp',
            rawTitle: 'Nequi',
            rawText: 'Laura te envio $25.000 a tu Nequi',
            capturedAt: now,
            dispatchedAt: now,
            receivedAt: now,
            latencyMs: 100,
            isStale: false,
            status: 'RECEIVED',
        };
        notificationRepo.seed(notification);
        vi.spyOn(mockWhatsappClient, 'sendPaymentAlert').mockResolvedValue({
            success: false,
            error: 'RATE_LIMITED',
            message: 'Meta Cloud API rate limit exceeded',
        });
        const result = await pipeline.processCapturedNotification('notif_meta_down');
        expect(result.status).toBe('DISPATCH_FAILED');
        const updated = await notificationRepo.getNotificationById('notif_meta_down');
        expect(updated?.status).toBe('DISPATCH_FAILED');
    });
    it('7. Condición de Carrera 409 Conflict (isDuplicate: true sin existingRecord igual bloquea duplicado)', async () => {
        const notification = {
            id: 'notif_race_dup',
            deviceId,
            walletPackage: 'com.nequi.MobileApp',
            rawTitle: 'Envío',
            rawText: 'KAROLL SIERRA te envió 200, ¡lo mejor!',
            capturedAt: now,
            dispatchedAt: now,
            receivedAt: now,
            latencyMs: 50,
            isStale: false,
            status: 'RECEIVED',
        };
        notificationRepo.seed(notification);
        vi.spyOn(fingerprintRepo, 'registerFingerprint').mockResolvedValueOnce({
            isDuplicate: true,
        });
        const result = await pipeline.processCapturedNotification('notif_race_dup');
        expect(result.status).toBe('DUPLICATE_PAYMENT');
        expect(mockWhatsappClient.sendPaymentAlert).not.toHaveBeenCalled();
    });
    it('8. Kill Switch (PAST_DUE -> IGNORED_SUSPENDED_ACCOUNT, cero mensajes a cajeros, alerta al dueño)', async () => {
        const pastDueMerchant = {
            ...merchant,
            id: 'merchant_vencido_id',
            name: 'Tienda La Esquina',
            status: 'ACTIVE',
            subscriptionStatus: 'PAST_DUE',
            subscriptionEndsAt: now - 3600_000,
            billingPhone: '+573113654315',
        };
        routingRepo.registerDeviceMerchant('dev_vencido_kill', pastDueMerchant);
        routingRepo.registerCashierRecipient({
            id: 'cajero_vencido_1',
            merchantId: pastDueMerchant.id,
            deviceId: 'dev_vencido_kill',
            name: 'Cajero Bloqueado',
            phoneNumber: '+573001112233',
            isActive: true,
        });
        const notification = {
            id: 'notif_kill_past_due',
            deviceId: 'dev_vencido_kill',
            walletPackage: 'com.nequi.MobileApp',
            rawTitle: 'Nequi',
            rawText: 'Pedro Gomez te envió $15.000 a tu Nequi',
            capturedAt: now,
            dispatchedAt: now,
            receivedAt: now,
            latencyMs: 80,
            isStale: false,
            status: 'RECEIVED',
        };
        notificationRepo.seed(notification);
        const result = await pipeline.processCapturedNotification('notif_kill_past_due');
        expect(result.status).toBe('IGNORED_SUSPENDED_ACCOUNT');
        if (result.status === 'IGNORED_SUSPENDED_ACCOUNT') {
            expect(result.reason).toBe('SUBSCRIPTION_PAST_DUE');
            expect(result.receipt.amount).toBe(15000);
            expect(result.billingNoticeSent).toBe(true);
        }
        expect(mockWhatsappClient.sendPaymentAlert).not.toHaveBeenCalled();
        expect(mockWhatsappClient.sendSubscriptionNotice).toHaveBeenCalledTimes(1);
        expect(mockWhatsappClient.sendSubscriptionNotice).toHaveBeenCalledWith('+573113654315', expect.objectContaining({
            amount: 15000,
            storeName: 'Tienda La Esquina',
            isSuspended: false,
            renewalPriceCop: 50000,
        }));
        const updated = await notificationRepo.getNotificationById('notif_kill_past_due');
        expect(updated?.status).toBe('IGNORED_SUSPENDED_ACCOUNT');
        expect(updated?.amount).toBe(15000);
        expect(updated?.senderName).toBe('Pedro Gomez');
    });
    it('9. Kill Switch aplica cooldown anti-spam de 6h en avisos de cobro al dueño', async () => {
        const pastDueMerchant = {
            ...merchant,
            id: 'merchant_cooldown_id',
            status: 'ACTIVE',
            subscriptionStatus: 'TRIAL',
            subscriptionEndsAt: now - 1000, // Venció hace 1s -> PAST_DUE efectivo
            billingPhone: '+573113654315',
        };
        routingRepo.registerDeviceMerchant('dev_cooldown', pastDueMerchant);
        notificationRepo.seed({
            id: 'notif_cd_1',
            deviceId: 'dev_cooldown',
            walletPackage: 'com.nequi.MobileApp',
            rawTitle: 'Nequi',
            rawText: 'Ana te envió $15.000 a tu Nequi',
            capturedAt: now - 1000,
            dispatchedAt: now,
            receivedAt: now,
            latencyMs: 50,
            isStale: false,
            status: 'RECEIVED',
        });
        notificationRepo.seed({
            id: 'notif_cd_2',
            deviceId: 'dev_cooldown',
            walletPackage: 'com.nequi.MobileApp',
            rawTitle: 'Nequi',
            rawText: 'Luis te envió $22.000 a tu Nequi',
            capturedAt: now,
            dispatchedAt: now,
            receivedAt: now,
            latencyMs: 50,
            isStale: false,
            status: 'RECEIVED',
        });
        const r1 = await pipeline.processCapturedNotification('notif_cd_1');
        const r2 = await pipeline.processCapturedNotification('notif_cd_2');
        expect(r1.status).toBe('IGNORED_SUSPENDED_ACCOUNT');
        expect(r2.status).toBe('IGNORED_SUSPENDED_ACCOUNT');
        if (r1.status === 'IGNORED_SUSPENDED_ACCOUNT')
            expect(r1.billingNoticeSent).toBe(true);
        if (r2.status === 'IGNORED_SUSPENDED_ACCOUNT')
            expect(r2.billingNoticeSent).toBe(false);
        expect(mockWhatsappClient.sendSubscriptionNotice).toHaveBeenCalledTimes(1);
        expect(mockWhatsappClient.sendPaymentAlert).not.toHaveBeenCalled();
    });
    it('10. Kill Switch en cuenta SUSPENDED sin billingPhone aborta despacho sin error', async () => {
        const pausedMerchant = {
            ...merchant,
            id: 'merchant_paused_nophone',
            status: 'SUSPENDED',
            subscriptionStatus: 'SUSPENDED',
            billingPhone: null,
        };
        routingRepo.registerDeviceMerchant('dev_paused', pausedMerchant);
        notificationRepo.seed({
            id: 'notif_paused_1',
            deviceId: 'dev_paused',
            walletPackage: 'com.nequi.MobileApp',
            rawTitle: 'Nequi',
            rawText: 'Maria te envió $30.000 a tu Nequi',
            capturedAt: now,
            dispatchedAt: now,
            receivedAt: now,
            latencyMs: 50,
            isStale: false,
            status: 'RECEIVED',
        });
        const result = await pipeline.processCapturedNotification('notif_paused_1');
        expect(result.status).toBe('IGNORED_SUSPENDED_ACCOUNT');
        if (result.status === 'IGNORED_SUSPENDED_ACCOUNT') {
            expect(result.reason).toBe('SUBSCRIPTION_SUSPENDED');
            expect(result.billingNoticeSent).toBe(false);
        }
        expect(mockWhatsappClient.sendPaymentAlert).not.toHaveBeenCalled();
        expect(mockWhatsappClient.sendSubscriptionNotice).not.toHaveBeenCalled();
    });
    describe('Ticket 22 — Integración de Auto-Renovación por Dogfooding en el Pipeline', () => {
        const billingSentinelId = 'dev_mursat_billing_sentinel';
        let mockBillingRepo;
        let billingService;
        beforeEach(() => {
            mockBillingRepo = {
                findMerchantByBillingPhone: vi.fn(),
                findMerchantById: vi.fn(),
                findInvoiceByReference: vi.fn(),
                getPendingInvoiceForMerchant: vi.fn(),
                createInvoice: vi.fn(),
                markInvoicePaid: vi.fn(),
                extendMerchantSubscription: vi.fn(),
            };
            billingService = new BillingReconciliationService({
                config: {
                    billingSentinelDeviceId: billingSentinelId,
                    minPlanPriceCop: 50_000,
                    defaultPlanDays: 30,
                },
                repository: mockBillingRepo,
                whatsappClient: mockWhatsappClient,
                nowProvider: () => now,
            });
            pipeline = new PaymentProcessingPipeline({
                notificationRepository: notificationRepo,
                fingerprintRepository: fingerprintRepo,
                routingService,
                whatsappClient: mockWhatsappClient,
                billingReconciliationService: billingService,
                nowProvider: () => now,
            });
        });
        it('debe procesar exitosamente la auto-renovación dogfooding sin despachar a cajeros de tienda', async () => {
            const clientMerchant = {
                id: 'merchant_client_auto',
                name: 'Droguería El Alivio',
                status: 'ACTIVE',
                subscriptionStatus: 'ACTIVE',
                subscriptionEndsAt: now + 2 * 86_400_000,
                billingPhone: '+573113654315',
                createdAt: now - 86_400_000,
            };
            vi.mocked(mockBillingRepo.findInvoiceByReference).mockResolvedValueOnce({
                id: 'inv_dogfood_1',
                merchant_id: clientMerchant.id,
                amount_cop: 50_000,
                reference_code: 'TYA-7B8K2M',
                status: 'PENDING',
                notification_id: null,
                paid_at: null,
                expires_at: new Date(now + 30 * 86_400_000).toISOString(),
                created_at: new Date(now).toISOString(),
                updated_at: new Date(now).toISOString(),
            });
            vi.mocked(mockBillingRepo.findMerchantById).mockResolvedValueOnce(clientMerchant);
            vi.mocked(mockBillingRepo.extendMerchantSubscription).mockResolvedValueOnce({
                previousEndsAt: new Date(clientMerchant.subscriptionEndsAt).toISOString(),
                newEndsAt: new Date(now + 32 * 86_400_000).toISOString(),
                daysRemaining: 32,
            });
            vi.mocked(mockBillingRepo.markInvoicePaid).mockResolvedValueOnce({
                id: 'inv_dogfood_1',
                merchant_id: clientMerchant.id,
                amount_cop: 50_000,
                reference_code: 'TYA-7B8K2M',
                status: 'PAID',
                notification_id: 'notif_dogfood_ok',
                paid_at: new Date(now).toISOString(),
                expires_at: new Date(now + 30 * 86_400_000).toISOString(),
                created_at: new Date(now).toISOString(),
                updated_at: new Date(now).toISOString(),
            });
            vi.mocked(mockWhatsappClient.sendRenewalConfirmation).mockResolvedValueOnce({
                success: true,
                messageId: 'wamid.DOGFOOD_CONFIRM_1',
            });
            notificationRepo.seed({
                id: 'notif_dogfood_ok',
                deviceId: billingSentinelId, // Proviene de MurSat Billing Sentinel
                walletPackage: 'com.nequi.MobileApp',
                rawTitle: 'Nequi',
                rawText: 'EDWIN MURCIA te envió 50000, ¡lo mejor! Ref: TYA-7B8K2M',
                capturedAt: now,
                dispatchedAt: now,
                receivedAt: now,
                latencyMs: 50,
                isStale: false,
                status: 'RECEIVED',
            });
            const result = await pipeline.processCapturedNotification('notif_dogfood_ok');
            expect(result.status).toBe('PROCESSED');
            if (result.status === 'PROCESSED') {
                expect(result.isDogfooding).toBe(true);
                expect(result.merchantId).toBe(clientMerchant.id);
                expect(result.invoiceId).toBe('inv_dogfood_1');
                expect(result.daysRemaining).toBe(32);
            }
            // No debe despachar a cajeros de caja retail
            expect(mockWhatsappClient.sendPaymentAlert).not.toHaveBeenCalled();
            expect(mockWhatsappClient.sendRenewalConfirmation).toHaveBeenCalledWith('+573113654315', expect.objectContaining({
                amountCop: 50_000,
                storeName: 'Droguería El Alivio',
                referenceCode: 'TYA-7B8K2M',
            }));
            // La notificación en base de datos debe estar PROCESSED
            const updated = await notificationRepo.getNotificationById('notif_dogfood_ok');
            expect(updated?.status).toBe('PROCESSED');
            expect(updated?.whatsappMessageIds).toEqual(['wamid.DOGFOOD_CONFIRM_1']);
        });
        it('debe proteger contra duplicados (Huella SHA-256): el segundo intento no acredita doble renovación', async () => {
            const clientMerchant = {
                id: 'merchant_client_auto',
                name: 'Droguería El Alivio',
                status: 'ACTIVE',
                subscriptionStatus: 'ACTIVE',
                subscriptionEndsAt: now + 2 * 86_400_000,
                billingPhone: '+573113654315',
                createdAt: now - 86_400_000,
            };
            vi.mocked(mockBillingRepo.findInvoiceByReference).mockResolvedValue({
                id: 'inv_dogfood_1',
                merchant_id: clientMerchant.id,
                amount_cop: 50_000,
                reference_code: 'TYA-7B8K2M',
                status: 'PENDING',
                notification_id: null,
                paid_at: null,
                expires_at: new Date(now + 30 * 86_400_000).toISOString(),
                created_at: new Date(now).toISOString(),
                updated_at: new Date(now).toISOString(),
            });
            vi.mocked(mockBillingRepo.findMerchantById).mockResolvedValue(clientMerchant);
            vi.mocked(mockBillingRepo.extendMerchantSubscription).mockResolvedValue({
                previousEndsAt: new Date(clientMerchant.subscriptionEndsAt).toISOString(),
                newEndsAt: new Date(now + 32 * 86_400_000).toISOString(),
                daysRemaining: 32,
            });
            vi.mocked(mockBillingRepo.markInvoicePaid).mockResolvedValue({
                id: 'inv_dogfood_1',
                merchant_id: clientMerchant.id,
                amount_cop: 50_000,
                reference_code: 'TYA-7B8K2M',
                status: 'PAID',
                notification_id: 'notif_first_attempt',
                paid_at: new Date(now).toISOString(),
                expires_at: new Date(now + 30 * 86_400_000).toISOString(),
                created_at: new Date(now).toISOString(),
                updated_at: new Date(now).toISOString(),
            });
            notificationRepo.seed({
                id: 'notif_first_attempt',
                deviceId: billingSentinelId,
                walletPackage: 'com.nequi.MobileApp',
                rawTitle: 'Nequi',
                rawText: 'EDWIN MURCIA te envió 50000, ¡lo mejor! Ref: TYA-7B8K2M',
                capturedAt: now,
                dispatchedAt: now,
                receivedAt: now,
                latencyMs: 50,
                isStale: false,
                status: 'RECEIVED',
            });
            const firstResult = await pipeline.processCapturedNotification('notif_first_attempt');
            expect(firstResult.status).toBe('PROCESSED');
            expect(mockBillingRepo.extendMerchantSubscription).toHaveBeenCalledTimes(1);
            // Segundo intento con la misma huella/captura
            notificationRepo.seed({
                id: 'notif_duplicate_attempt',
                deviceId: billingSentinelId,
                walletPackage: 'com.nequi.MobileApp',
                rawTitle: 'Nequi',
                rawText: 'EDWIN MURCIA te envió 50000, ¡lo mejor! Ref: TYA-7B8K2M',
                capturedAt: now,
                dispatchedAt: now,
                receivedAt: now,
                latencyMs: 50,
                isStale: false,
                status: 'RECEIVED',
            });
            const duplicateResult = await pipeline.processCapturedNotification('notif_duplicate_attempt');
            expect(duplicateResult.status).toBe('DUPLICATE_PAYMENT');
            // No se volvió a llamar a extendMerchantSubscription
            expect(mockBillingRepo.extendMerchantSubscription).toHaveBeenCalledTimes(1);
        });
        it('debe registrar falla de enrutamiento y no renovar cuando el monto transferido a MurSat es inferior a 50.000 COP', async () => {
            notificationRepo.seed({
                id: 'notif_low_amount',
                deviceId: billingSentinelId,
                walletPackage: 'com.nequi.MobileApp',
                rawTitle: 'Nequi',
                rawText: 'EDWIN MURCIA te envió 10000, ¡lo mejor! Ref: TYA-7B8K2M',
                capturedAt: now,
                dispatchedAt: now,
                receivedAt: now,
                latencyMs: 50,
                isStale: false,
                status: 'RECEIVED',
            });
            const result = await pipeline.processCapturedNotification('notif_low_amount');
            expect(result.status).toBe('ROUTING_FAILED');
            if (result.status === 'ROUTING_FAILED') {
                expect(result.isDogfooding).toBe(true);
                expect(result.reason).toBe('INSUFFICIENT_AMOUNT');
            }
            expect(mockBillingRepo.extendMerchantSubscription).not.toHaveBeenCalled();
            const updated = await notificationRepo.getNotificationById('notif_low_amount');
            expect(updated?.status).toBe('ROUTING_FAILED');
            expect(updated?.failureReason).toContain('inferior al precio oficial del Plan Pro');
        });
    });
});
