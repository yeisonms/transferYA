import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedPaymentReceipt } from '../../../domain/parser/types.js';
import type { Merchant } from '../../../domain/routing/types.js';
import type { IWhatsAppCloudApiClient, WhatsAppSendResult } from '../../../whatsapp/types.js';
import { BillingReconciliationService } from '../reconciliation.js';
import type {
  BillingInvoiceRecord,
  CreateBillingInvoiceInput,
  IBillingInvoicesRepository,
} from '../types.js';
import type { StoredNotificationRecord } from '../../webhook/types.js';

describe('Ticket 22 — Automatización de Cobros por Dogfooding (MurSat Solutions Auto-Renovación)', () => {
  const BILLING_SENTINEL_ID = 'dev_5f38cd_caja_1';
  const CLIENT_STORE_SENTINEL_ID = 'dev_client_store_caja_9';
  const FIXED_NOW = new Date('2026-11-15T12:00:00.000Z').getTime();

  let mockRepo: IBillingInvoicesRepository;
  let mockWhatsApp: IWhatsAppCloudApiClient;
  let service: BillingReconciliationService;

  const sampleMerchant: Merchant = {
    id: 'merchant-uuid-1234',
    name: 'Panadería La Central',
    status: 'ACTIVE',
    subscriptionStatus: 'ACTIVE',
    subscriptionEndsAt: new Date('2026-11-20T12:00:00.000Z').getTime(), // 5 días restantes
    billingPhone: '+573113654315',
    createdAt: FIXED_NOW - 86_400_000,
  };

  const samplePendingInvoice: BillingInvoiceRecord = {
    id: 'inv-uuid-999',
    merchant_id: sampleMerchant.id,
    amount_cop: 50_000,
    reference_code: 'TYA-7B8K2M',
    status: 'PENDING',
    notification_id: null,
    paid_at: null,
    expires_at: '2026-12-15T12:00:00.000Z',
    created_at: '2026-11-10T12:00:00.000Z',
    updated_at: '2026-11-10T12:00:00.000Z',
  };

  beforeEach(() => {
    mockRepo = {
      findMerchantByBillingPhone: vi.fn(),
      findMerchantById: vi.fn(),
      findInvoiceByReference: vi.fn(),
      getPendingInvoiceForMerchant: vi.fn(),
      createInvoice: vi.fn(),
      markInvoicePaid: vi.fn(),
      extendMerchantSubscription: vi.fn(),
    };

    mockWhatsApp = {
      sendTemplate: vi.fn(),
      sendPaymentAlert: vi.fn(),
      sendSubscriptionNotice: vi.fn(),
      sendRenewalConfirmation: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'wamid.RENEWAL_CONFIRMED_123',
      } as WhatsAppSendResult),
    };

    service = new BillingReconciliationService({
      config: {
        billingSentinelDeviceId: BILLING_SENTINEL_ID,
        minPlanPriceCop: 50_000,
        defaultPlanDays: 30,
      },
      repository: mockRepo,
      whatsappClient: mockWhatsApp,
      nowProvider: () => FIXED_NOW,
    });
  });

  describe('1. Criterio de Aislamiento Estricto de Dispositivos (Solo MurSat Dogfooding)', () => {
    it('debe rechazar y no conciliar notificaciones que provengan de cajas de comercios clientes', async () => {
      const clientNotification: StoredNotificationRecord = {
        id: 'notif-1',
        deviceId: CLIENT_STORE_SENTINEL_ID, // Dispositivo cliente, NO MurSat
        walletPackage: 'com.nequi.MobileApp',
        rawTitle: 'Nequi',
        rawText: 'EDWIN MURCIA te envió 50000, ¡lo mejor! Ref: TYA-7B8K2M',
        capturedAt: FIXED_NOW - 1000,
        dispatchedAt: FIXED_NOW - 500,
        receivedAt: FIXED_NOW,
        latencyMs: 1000,
        isStale: false,
        status: 'RECEIVED',
      };

      const receipt: ParsedPaymentReceipt = {
        wallet: 'NEQUI',
        amount: 50_000,
        senderName: 'Edwin Murcia',
        reference: 'TYA-7B8K2M',
        rawText: clientNotification.rawText,
      };

      const result = await service.reconcile(clientNotification, receipt);

      expect(result.isBillingSentinel).toBe(false);
      expect(result.isDogfooding).toBe(false);
      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('NOT_BILLING_SENTINEL');

      // Nunca debe tocar facturación ni base de datos
      expect(mockRepo.findInvoiceByReference).not.toHaveBeenCalled();
      expect(mockRepo.extendMerchantSubscription).not.toHaveBeenCalled();
      expect(mockWhatsApp.sendRenewalConfirmation).not.toHaveBeenCalled();
    });

    it('debe reconocer el Dispositivo Centinela de MurSat Solutions como nodo de Dogfooding', () => {
      expect(service.isBillingSentinel(BILLING_SENTINEL_ID)).toBe(true);
      expect(service.isBillingSentinel('dev_other_random')).toBe(false);
    });
  });

  describe('2. Criterio de Monto Mínimo del Plan Pro', () => {
    it('debe registrar auditoría y NO renovar si el monto transferido es inferior a 50.000 COP', async () => {
      const notification: StoredNotificationRecord = {
        id: 'notif-below-min',
        deviceId: BILLING_SENTINEL_ID,
        walletPackage: 'com.nequi.MobileApp',
        rawTitle: 'Nequi',
        rawText: 'JUAN PEREZ te envió 15000, ¡lo mejor! Ref: TYA-7B8K2M',
        capturedAt: FIXED_NOW - 1000,
        dispatchedAt: FIXED_NOW - 500,
        receivedAt: FIXED_NOW,
        latencyMs: 1000,
        isStale: false,
        status: 'RECEIVED',
      };

      const receipt: ParsedPaymentReceipt = {
        wallet: 'NEQUI',
        amount: 15_000, // Menor a 50.000
        senderName: 'Juan Perez',
        reference: 'TYA-7B8K2M',
        rawText: notification.rawText,
      };

      const result = await service.reconcile(notification, receipt);

      expect(result.isBillingSentinel).toBe(true);
      expect(result.isDogfooding).toBe(true);
      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('INSUFFICIENT_AMOUNT');
      expect(result.amountCop).toBe(15_000);
      expect(result.minRequiredCop).toBe(50_000);

      expect(mockRepo.extendMerchantSubscription).not.toHaveBeenCalled();
      expect(mockRepo.markInvoicePaid).not.toHaveBeenCalled();
      expect(mockWhatsApp.sendRenewalConfirmation).not.toHaveBeenCalled();
    });
  });

  describe('3. Conciliación Estrategia A: Por Código de Referencia Comercial', () => {
    it('debe conciliar exitosamente cuando la referencia coincide con una factura pendiente', async () => {
      const notification: StoredNotificationRecord = {
        id: 'notif-ref-match',
        deviceId: BILLING_SENTINEL_ID,
        walletPackage: 'com.nequi.MobileApp',
        rawTitle: 'Nequi',
        rawText: 'Plata recibida. Te acaban de enviar $50.000 en Nequi. Ref: TYA-7B8K2M',
        capturedAt: FIXED_NOW - 1000,
        dispatchedAt: FIXED_NOW - 500,
        receivedAt: FIXED_NOW,
        latencyMs: 1000,
        isStale: false,
        status: 'RECEIVED',
      };

      const receipt: ParsedPaymentReceipt = {
        wallet: 'NEQUI',
        amount: 50_000,
        senderName: 'Panadería La Central',
        reference: 'TYA-7B8K2M',
        rawText: notification.rawText,
      };

      vi.mocked(mockRepo.findInvoiceByReference).mockResolvedValueOnce(samplePendingInvoice);
      vi.mocked(mockRepo.findMerchantById).mockResolvedValueOnce(sampleMerchant);
      vi.mocked(mockRepo.extendMerchantSubscription).mockResolvedValueOnce({
        previousEndsAt: new Date(sampleMerchant.subscriptionEndsAt!).toISOString(),
        newEndsAt: '2026-12-20T12:00:00.000Z',
        daysRemaining: 35,
      });
      vi.mocked(mockRepo.markInvoicePaid).mockResolvedValueOnce({
        ...samplePendingInvoice,
        status: 'PAID',
        notification_id: notification.id ?? null,
        paid_at: new Date(FIXED_NOW).toISOString(),
      });

      const result = await service.reconcile(notification, receipt);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('REFERENCE_CODE');
      expect(result.matchedMerchant?.id).toBe(sampleMerchant.id);
      expect(result.matchedInvoice?.id).toBe(samplePendingInvoice.id);
      expect(result.matchedInvoice?.status).toBe('PAID');
      expect(result.daysRemaining).toBe(35);
      expect(result.whatsappSent).toBe(true);

      // Verificaciones de persistencia y comunicación
      expect(mockRepo.findInvoiceByReference).toHaveBeenCalledWith('TYA-7B8K2M');
      expect(mockRepo.findMerchantById).toHaveBeenCalledWith(sampleMerchant.id);
      expect(mockRepo.extendMerchantSubscription).toHaveBeenCalledWith(sampleMerchant.id, 30, FIXED_NOW);
      expect(mockRepo.markInvoicePaid).toHaveBeenCalledWith(samplePendingInvoice.id, notification.id, FIXED_NOW);
      expect(mockWhatsApp.sendRenewalConfirmation).toHaveBeenCalledWith(
        '+573113654315',
        expect.objectContaining({
          amountCop: 50_000,
          storeName: 'Panadería La Central',
          newEndsAtIso: '2026-12-20T12:00:00.000Z',
          daysRemaining: 35,
          referenceCode: 'TYA-7B8K2M',
        }),
      );
    });

    it('debe rechazar si la factura encontrada ya fue pagada previamente (Anti-Replay de Factura)', async () => {
      const notification: StoredNotificationRecord = {
        id: 'notif-already-paid',
        deviceId: BILLING_SENTINEL_ID,
        walletPackage: 'com.nequi.MobileApp',
        rawTitle: 'Nequi',
        rawText: 'EDWIN MURCIA te envió 50000, ¡lo mejor! Ref: TYA-7B8K2M',
        capturedAt: FIXED_NOW - 1000,
        dispatchedAt: FIXED_NOW - 500,
        receivedAt: FIXED_NOW,
        latencyMs: 1000,
        isStale: false,
        status: 'RECEIVED',
      };

      const receipt: ParsedPaymentReceipt = {
        wallet: 'NEQUI',
        amount: 50_000,
        senderName: 'Edwin Murcia',
        reference: 'TYA-7B8K2M',
        rawText: notification.rawText,
      };

      vi.mocked(mockRepo.findInvoiceByReference).mockResolvedValueOnce({
        ...samplePendingInvoice,
        status: 'PAID', // Ya pagada
      });

      const result = await service.reconcile(notification, receipt);

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('ALREADY_PAID');
      expect(mockRepo.extendMerchantSubscription).not.toHaveBeenCalled();
    });
  });

  describe('4. Conciliación Estrategia B: Por Teléfono del Dueño (billing_phone)', () => {
    it('debe conciliar por número de celular cuando el pago no contiene código TYA', async () => {
      const notification: StoredNotificationRecord = {
        id: 'notif-phone-match',
        deviceId: BILLING_SENTINEL_ID,
        walletPackage: 'com.nequi.MobileApp',
        rawTitle: 'Nequi',
        rawText: 'EDWIN MURCIA (3113654315) te envió 50000, ¡lo mejor!',
        capturedAt: FIXED_NOW - 1000,
        dispatchedAt: FIXED_NOW - 500,
        receivedAt: FIXED_NOW,
        latencyMs: 1000,
        isStale: false,
        status: 'RECEIVED',
      };

      const receipt: ParsedPaymentReceipt = {
        wallet: 'NEQUI',
        amount: 50_000,
        senderName: 'Edwin Murcia (3113654315)',
        reference: null,
        rawText: notification.rawText,
      };

      vi.mocked(mockRepo.findInvoiceByReference).mockResolvedValue(null);
      vi.mocked(mockRepo.findMerchantByBillingPhone).mockResolvedValueOnce(sampleMerchant);
      vi.mocked(mockRepo.getPendingInvoiceForMerchant).mockResolvedValueOnce(samplePendingInvoice);
      vi.mocked(mockRepo.extendMerchantSubscription).mockResolvedValueOnce({
        previousEndsAt: new Date(sampleMerchant.subscriptionEndsAt!).toISOString(),
        newEndsAt: '2026-12-20T12:00:00.000Z',
        daysRemaining: 35,
      });
      vi.mocked(mockRepo.markInvoicePaid).mockResolvedValueOnce({
        ...samplePendingInvoice,
        status: 'PAID',
        notification_id: notification.id ?? null,
      });

      const result = await service.reconcile(notification, receipt);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('BILLING_PHONE');
      expect(result.matchedMerchant?.id).toBe(sampleMerchant.id);
      expect(result.matchedPhone).toBe('+573113654315');
      expect(result.daysRemaining).toBe(35);
      expect(mockRepo.findMerchantByBillingPhone).toHaveBeenCalledWith('+573113654315');
      expect(mockRepo.extendMerchantSubscription).toHaveBeenCalledWith(sampleMerchant.id, 30, FIXED_NOW);
    });

    it('debe crear una nueva factura en estado PAID si el comercio no tenía factura pendiente previa', async () => {
      const notification: StoredNotificationRecord = {
        id: 'notif-auto-invoice',
        deviceId: BILLING_SENTINEL_ID,
        walletPackage: 'com.nequi.MobileApp',
        rawTitle: 'Nequi',
        rawText: 'Te pasaron $50.000 de 3113654315',
        capturedAt: FIXED_NOW - 1000,
        dispatchedAt: FIXED_NOW - 500,
        receivedAt: FIXED_NOW,
        latencyMs: 1000,
        isStale: false,
        status: 'RECEIVED',
      };

      const receipt: ParsedPaymentReceipt = {
        wallet: 'NEQUI',
        amount: 50_000,
        senderName: '3113654315',
        reference: null,
        rawText: notification.rawText,
      };

      vi.mocked(mockRepo.findInvoiceByReference).mockResolvedValue(null);
      vi.mocked(mockRepo.findMerchantByBillingPhone).mockResolvedValueOnce(sampleMerchant);
      vi.mocked(mockRepo.getPendingInvoiceForMerchant).mockResolvedValueOnce(null); // Sin factura previa
      vi.mocked(mockRepo.extendMerchantSubscription).mockResolvedValueOnce({
        previousEndsAt: null,
        newEndsAt: '2026-12-15T12:00:00.000Z',
        daysRemaining: 30,
      });
      vi.mocked(mockRepo.createInvoice).mockImplementationOnce(async (input: CreateBillingInvoiceInput) => ({
        id: 'new-inv-123',
        merchant_id: input.merchantId,
        amount_cop: input.amountCop ?? 50_000,
        reference_code: input.referenceCode ?? 'TYA-AUTO12',
        status: 'PAID',
        notification_id: input.notificationId ?? null,
        paid_at: input.paidAt ?? null,
        expires_at: '2026-12-15T12:00:00.000Z',
        created_at: '2026-11-15T12:00:00.000Z',
        updated_at: '2026-11-15T12:00:00.000Z',
      }));

      const result = await service.reconcile(notification, receipt);

      expect(result.success).toBe(true);
      expect(result.matchedInvoice?.id).toBe('new-inv-123');
      expect(result.matchedInvoice?.status).toBe('PAID');
      expect(mockRepo.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          merchantId: sampleMerchant.id,
          amountCop: 50_000,
          status: 'PAID',
          notificationId: notification.id,
        }),
      );
    });
  });

  describe('5. Manejo de Pagos No Identificados / Auditoría', () => {
    it('debe registrar falla de conciliación cuando ni la referencia ni el teléfono coinciden', async () => {
      const notification: StoredNotificationRecord = {
        id: 'notif-unmatched',
        deviceId: BILLING_SENTINEL_ID,
        walletPackage: 'com.nequi.MobileApp',
        rawTitle: 'Nequi',
        rawText: 'Te enviaron $50.000 de Carlos Desconocido.',
        capturedAt: FIXED_NOW - 1000,
        dispatchedAt: FIXED_NOW - 500,
        receivedAt: FIXED_NOW,
        latencyMs: 1000,
        isStale: false,
        status: 'RECEIVED',
      };

      const receipt: ParsedPaymentReceipt = {
        wallet: 'NEQUI',
        amount: 50_000,
        senderName: 'Carlos Desconocido',
        reference: null,
        rawText: notification.rawText,
      };

      vi.mocked(mockRepo.findInvoiceByReference).mockResolvedValue(null);
      vi.mocked(mockRepo.findMerchantByBillingPhone).mockResolvedValue(null);

      const result = await service.reconcile(notification, receipt);

      expect(result.isBillingSentinel).toBe(true);
      expect(result.isDogfooding).toBe(true);
      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('UNMATCHED_MERCHANT');
      expect(mockRepo.extendMerchantSubscription).not.toHaveBeenCalled();
      expect(mockWhatsApp.sendRenewalConfirmation).not.toHaveBeenCalled();
    });

    it('debe tolerar fallos en el envío de WhatsApp sin abortar la renovación en base de datos', async () => {
      const notification: StoredNotificationRecord = {
        id: 'notif-wa-error',
        deviceId: BILLING_SENTINEL_ID,
        walletPackage: 'com.nequi.MobileApp',
        rawTitle: 'Nequi',
        rawText: 'EDWIN MURCIA (3113654315) te envió 50000, ¡lo mejor!',
        capturedAt: FIXED_NOW - 1000,
        dispatchedAt: FIXED_NOW - 500,
        receivedAt: FIXED_NOW,
        latencyMs: 1000,
        isStale: false,
        status: 'RECEIVED',
      };

      const receipt: ParsedPaymentReceipt = {
        wallet: 'NEQUI',
        amount: 50_000,
        senderName: 'Edwin Murcia (3113654315)',
        reference: null,
        rawText: notification.rawText,
      };

      vi.mocked(mockRepo.findInvoiceByReference).mockResolvedValue(null);
      vi.mocked(mockRepo.findMerchantByBillingPhone).mockResolvedValueOnce(sampleMerchant);
      vi.mocked(mockRepo.extendMerchantSubscription).mockResolvedValueOnce({
        previousEndsAt: null,
        newEndsAt: '2026-12-15T12:00:00.000Z',
        daysRemaining: 30,
      });
      vi.mocked(mockRepo.createInvoice).mockResolvedValueOnce({
        ...samplePendingInvoice,
        status: 'PAID',
      });
      vi.mocked(mockWhatsApp.sendRenewalConfirmation).mockRejectedValueOnce(
        new Error('Meta WhatsApp Rate Limit 429'),
      );

      const result = await service.reconcile(notification, receipt);

      // La renovación en BD fue exitosa aunque el WhatsApp haya fallado
      expect(result.success).toBe(true);
      expect(result.whatsappSent).toBe(false);
      expect(mockRepo.extendMerchantSubscription).toHaveBeenCalled();
    });
  });
});
