import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrialNurtureService, type ITrialNurtureRepository } from '../trial-nurture.js';
import type { Merchant } from '../../../domain/routing/types.js';
import type { IWhatsAppCloudApiClient } from '../../../whatsapp/types.js';

class MockTrialNurtureRepository implements ITrialNurtureRepository {
  public merchants = new Map<string, Merchant>();
  public recordedNotices: Array<{ merchantId: string; noticeType: string; timestampIso?: string }> = [];

  async getMerchantById(merchantId: string): Promise<Merchant | null> {
    return this.merchants.get(merchantId) ?? null;
  }

  async getTrialMerchants(): Promise<Merchant[]> {
    return Array.from(this.merchants.values()).filter(
      (m) => m.subscriptionStatus === 'TRIAL',
    );
  }

  async recordTrialNoticeSent(
    merchantId: string,
    noticeType: 'WELCOME' | 'DAY_5' | 'DAY_7',
    timestampIso?: string,
  ): Promise<void> {
    this.recordedNotices.push({ merchantId, noticeType, timestampIso });
    const current = this.merchants.get(merchantId);
    if (current) {
      if (noticeType === 'WELCOME') current.trialWelcomeSentAt = Date.now();
      if (noticeType === 'DAY_5') current.trialDay5SentAt = Date.now();
      if (noticeType === 'DAY_7') current.trialDay7SentAt = Date.now();
    }
  }
}

describe('TrialNurtureService — Acompañamiento, Bienvenida y Recordatorios de Prueba Gratuita', () => {
  let repository: MockTrialNurtureRepository;
  let mockWhatsappClient: IWhatsAppCloudApiClient;
  const now = 1732180000000; // Epoch fijo

  beforeEach(() => {
    repository = new MockTrialNurtureRepository();
    mockWhatsappClient = {
      sendTemplate: vi.fn().mockResolvedValue({ success: true, messageId: 'wamid.TEMPLATE_1' }),
      sendPaymentAlert: vi.fn().mockResolvedValue({ success: true, messageId: 'wamid.ALERT_1' }),
      sendSubscriptionNotice: vi.fn().mockResolvedValue({ success: true, messageId: 'wamid.SUB_1' }),
      sendRenewalConfirmation: vi.fn().mockResolvedValue({ success: true, messageId: 'wamid.RENEW_1' }),
      sendTrialWelcome: vi.fn().mockResolvedValue({ success: true, messageId: 'wamid.WELCOME_1' }),
      sendTrialReminder: vi.fn().mockResolvedValue({ success: true, messageId: 'wamid.REMINDER_1' }),
    };
  });

  describe('1. Touch 1 — Bienvenida al Enrolar Caja (Día 1)', () => {
    it('debe enviar la bienvenida de prueba de 7 días al teléfono del dueño si no se ha enviado antes', async () => {
      const merchant: Merchant = {
        id: 'merchant_trial_1',
        name: 'Panadería La Abuela',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIAL',
        subscriptionEndsAt: now + 7 * 86_400_000,
        billingPhone: '+573113654315',
        createdAt: now,
      };
      repository.merchants.set(merchant.id, merchant);

      const service = new TrialNurtureService({
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      const sent = await service.sendWelcomeIfEligible(merchant.id);

      expect(sent).toBe(true);
      expect(mockWhatsappClient.sendTrialWelcome).toHaveBeenCalledTimes(1);
      expect(mockWhatsappClient.sendTrialWelcome).toHaveBeenCalledWith(
        '+573113654315',
        expect.objectContaining({
          storeName: 'Panadería La Abuela',
          trialDays: 7,
        }),
      );
      expect(repository.recordedNotices).toHaveLength(1);
      expect(repository.recordedNotices[0]?.noticeType).toBe('WELCOME');
    });

    it('no debe enviar la bienvenida si ya fue despachada previamente (idempotencia)', async () => {
      const merchant: Merchant = {
        id: 'merchant_trial_already_welcomed',
        name: 'Restaurante Central',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIAL',
        billingPhone: '+573113654315',
        trialWelcomeSentAt: now - 3600_000,
        createdAt: now,
      };
      repository.merchants.set(merchant.id, merchant);

      const service = new TrialNurtureService({
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      const sent = await service.sendWelcomeIfEligible(merchant.id);

      expect(sent).toBe(false);
      expect(mockWhatsappClient.sendTrialWelcome).not.toHaveBeenCalled();
    });

    it('no debe enviar bienvenida si el comercio no tiene teléfono de facturación registrado', async () => {
      const merchant: Merchant = {
        id: 'merchant_no_phone',
        name: 'Sin Telefono',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIAL',
        billingPhone: null,
        createdAt: now,
      };
      repository.merchants.set(merchant.id, merchant);

      const service = new TrialNurtureService({
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      const sent = await service.sendWelcomeIfEligible(merchant.id);
      expect(sent).toBe(false);
      expect(mockWhatsappClient.sendTrialWelcome).not.toHaveBeenCalled();
    });
  });

  describe('2. Touch 2 — Recordatorio Preventivo (Día 5 / Quedan 2 días)', () => {
    it('debe enviar recordatorio suave del Día 5 cuando faltan exactamente 2 días para el corte', async () => {
      // 2 días restantes exactos (entre 1.1 y 2.0 días)
      const endsAt = now + 2 * 86_400_000 - 3600_000;
      const merchant: Merchant = {
        id: 'merchant_day_5',
        name: 'Boutique Dama',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIAL',
        subscriptionEndsAt: endsAt,
        billingPhone: '+573113654315',
        createdAt: now - 5 * 86_400_000,
      };
      repository.merchants.set(merchant.id, merchant);

      const service = new TrialNurtureService({
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      const result = await service.evaluateMerchantTrial(merchant);

      expect(result.sent).toBe(true);
      expect(result.step).toBe('DAY_5');
      expect(mockWhatsappClient.sendTrialReminder).toHaveBeenCalledWith(
        '+573113654315',
        expect.objectContaining({
          storeName: 'Boutique Dama',
          daysRemaining: 2,
          minPriceCop: 29900,
        }),
      );
      expect(repository.recordedNotices).toEqual([
        expect.objectContaining({
          merchantId: 'merchant_day_5',
          noticeType: 'DAY_5',
        }),
      ]);
    });

    it('no debe reenviar el recordatorio del Día 5 si ya fue notificado previamente', async () => {
      const merchant: Merchant = {
        id: 'merchant_day_5_already_notified',
        name: 'Boutique Dama',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIAL',
        subscriptionEndsAt: now + 2 * 86_400_000 - 3600_000,
        billingPhone: '+573113654315',
        trialDay5SentAt: now - 7200_000,
        createdAt: now - 5 * 86_400_000,
      };
      repository.merchants.set(merchant.id, merchant);

      const service = new TrialNurtureService({
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      const result = await service.evaluateMerchantTrial(merchant);
      expect(result.sent).toBe(false);
      expect(mockWhatsappClient.sendTrialReminder).not.toHaveBeenCalled();
    });
  });

  describe('3. Touch 3 — Aviso de Último Día (Día 7 / Vence hoy)', () => {
    it('debe enviar aviso urgente del Día 7 cuando queda 1 día o vence hoy', async () => {
      // Menos de 24 horas restantes
      const endsAt = now + 12 * 3600_000;
      const merchant: Merchant = {
        id: 'merchant_day_7',
        name: 'Supermercado Don Pepe',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIAL',
        subscriptionEndsAt: endsAt,
        billingPhone: '+573113654315',
        createdAt: now - 7 * 86_400_000,
      };
      repository.merchants.set(merchant.id, merchant);

      const service = new TrialNurtureService({
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      const result = await service.evaluateMerchantTrial(merchant);

      expect(result.sent).toBe(true);
      expect(result.step).toBe('DAY_7');
      expect(mockWhatsappClient.sendTrialReminder).toHaveBeenCalledWith(
        '+573113654315',
        expect.objectContaining({
          storeName: 'Supermercado Don Pepe',
          daysRemaining: 1,
          minPriceCop: 29900,
        }),
      );
    });

    it('no debe enviar recordatorio si la cuenta ya está expirada (el Kill Switch se encarga)', async () => {
      const expiredMerchant: Merchant = {
        id: 'merchant_expired',
        name: 'Ya Venció',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIAL',
        subscriptionEndsAt: now - 3600_000, // Expiró hace 1 hora
        billingPhone: '+573113654315',
        createdAt: now - 8 * 86_400_000,
      };
      repository.merchants.set(expiredMerchant.id, expiredMerchant);

      const service = new TrialNurtureService({
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      const result = await service.evaluateMerchantTrial(expiredMerchant);
      expect(result.sent).toBe(false);
      expect(mockWhatsappClient.sendTrialReminder).not.toHaveBeenCalled();
    });
  });

  describe('4. Evaluación Masiva por Cron (evaluateAllTrialMerchants)', () => {
    it('debe procesar todos los comercios en Trial y enviar sólo a los elegibles', async () => {
      // 1 comercio en Día 5
      const m1: Merchant = {
        id: 'm1_day5',
        name: 'Local 1',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIAL',
        subscriptionEndsAt: now + 2 * 86_400_000 - 1000,
        billingPhone: '+573113654315',
        createdAt: now - 5 * 86_400_000,
      };
      // 1 comercio en Día 7
      const m2: Merchant = {
        id: 'm2_day7',
        name: 'Local 2',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIAL',
        subscriptionEndsAt: now + 10 * 3600_000,
        billingPhone: '+573113654315',
        createdAt: now - 7 * 86_400_000,
      };
      // 1 comercio en Día 2 (aún no corresponde recordatorio)
      const m3: Merchant = {
        id: 'm3_day2',
        name: 'Local 3',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIAL',
        subscriptionEndsAt: now + 5 * 86_400_000,
        billingPhone: '+573113654315',
        createdAt: now - 2 * 86_400_000,
      };

      repository.merchants.set(m1.id, m1);
      repository.merchants.set(m2.id, m2);
      repository.merchants.set(m3.id, m3);

      const service = new TrialNurtureService({
        repository,
        whatsappClient: mockWhatsappClient,
        nowProvider: () => now,
      });

      const summary = await service.evaluateAllTrialMerchants();

      expect(summary.processed).toBe(3);
      expect(summary.sentDay5).toBe(1);
      expect(summary.sentDay7).toBe(1);
      expect(mockWhatsappClient.sendTrialReminder).toHaveBeenCalledTimes(2);
    });
  });
});
