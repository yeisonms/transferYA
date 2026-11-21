import { normalizePhoneNumberE164 } from '../../domain/routing/phone-utils.js';
import {
  getRemainingSubscriptionDays,
  resolveSubscriptionEndsAt,
} from '../../domain/routing/billing.js';
import type { Merchant } from '../../domain/routing/types.js';
import type { IWhatsAppCloudApiClient } from '../../whatsapp/types.js';

export interface ITrialNurtureRepository {
  getMerchantById(merchantId: string): Promise<Merchant | null>;
  getTrialMerchants(): Promise<Merchant[]>;
  recordTrialNoticeSent(
    merchantId: string,
    noticeType: 'WELCOME' | 'DAY_5' | 'DAY_7',
    timestampIso?: string,
  ): Promise<void>;
}

export interface TrialNurtureDependencies {
  repository: ITrialNurtureRepository;
  whatsappClient: IWhatsAppCloudApiClient;
  nowProvider?: () => number;
}

/**
 * Servicio de nutrición, bienvenida y retención preventiva para comercios en período de prueba gratuito (Trial).
 *
 * Flujo de acompañamiento comercial:
 * - Día 1: Mensaje de bienvenida y confirmación de que la caja está protegida.
 * - Día 5: Recordatorio preventivo suave (faltan 2 días para el corte).
 * - Día 7: Aviso de último día de prueba para asegurar renovación antes del fin de semana.
 * - Día 8+: Corte automático (Kill Switch) en orchestrator.ts al detectar cobros con suscripción vencida.
 */
export class TrialNurtureService {
  private readonly nowProvider: () => number;

  constructor(private readonly deps: TrialNurtureDependencies) {
    this.nowProvider = deps.nowProvider ?? (() => Date.now());
  }

  /**
   * Envía mensaje de bienvenida al dueño al vincular su primera caja durante el Trial (Día 1).
   */
  async sendWelcomeIfEligible(merchantId: string): Promise<boolean> {
    try {
      const merchant = await this.deps.repository.getMerchantById(merchantId);
      if (!merchant || !merchant.billingPhone) return false;
      if (merchant.trialWelcomeSentAt) return false;

      const ownerPhone = normalizePhoneNumberE164(merchant.billingPhone);
      const res = await this.deps.whatsappClient.sendTrialWelcome(ownerPhone, {
        storeName: merchant.name,
        trialDays: 7,
      });

      if (res.success) {
        await this.deps.repository.recordTrialNoticeSent(
          merchantId,
          'WELCOME',
          new Date(this.nowProvider()).toISOString(),
        );
        return true;
      }
    } catch (err) {
      console.error('Error enviando bienvenida de trial a WhatsApp:', err);
    }
    return false;
  }

  /**
   * Evalúa un comercio específico en Trial y envía el recordatorio correspondiente (Día 5 o Día 7).
   */
  async evaluateMerchantTrial(
    merchant: Merchant,
  ): Promise<{ sent: boolean; step?: 'DAY_5' | 'DAY_7' }> {
    if (merchant.subscriptionStatus !== 'TRIAL') {
      return { sent: false };
    }
    if (!merchant.billingPhone) {
      return { sent: false };
    }

    const now = this.nowProvider();
    const endsAtMs = resolveSubscriptionEndsAt(merchant);
    if (!endsAtMs || endsAtMs <= now) {
      // Ya expiró; el Kill Switch en el orquestador maneja este estado
      return { sent: false };
    }

    const daysRemaining = getRemainingSubscriptionDays(endsAtMs, now);
    let ownerPhone: string;
    try {
      ownerPhone = normalizePhoneNumberE164(merchant.billingPhone);
    } catch {
      return { sent: false };
    }

    // Caso 1: Faltan 2 días (Día 5 del trial de 7 días)
    if (daysRemaining === 2 && !merchant.trialDay5SentAt) {
      try {
        const res = await this.deps.whatsappClient.sendTrialReminder(ownerPhone, {
          storeName: merchant.name,
          daysRemaining: 2,
          minPriceCop: 29900,
        });
        if (res.success) {
          await this.deps.repository.recordTrialNoticeSent(
            merchant.id,
            'DAY_5',
            new Date(now).toISOString(),
          );
          return { sent: true, step: 'DAY_5' };
        }
      } catch (err) {
        console.error('Error enviando recordatorio Día 5:', err);
      }
    }

    // Caso 2: Último día (Día 7 del trial, daysRemaining <= 1)
    if (daysRemaining <= 1 && daysRemaining >= 0 && !merchant.trialDay7SentAt) {
      try {
        const res = await this.deps.whatsappClient.sendTrialReminder(ownerPhone, {
          storeName: merchant.name,
          daysRemaining,
          minPriceCop: 29900,
        });
        if (res.success) {
          await this.deps.repository.recordTrialNoticeSent(
            merchant.id,
            'DAY_7',
            new Date(now).toISOString(),
          );
          return { sent: true, step: 'DAY_7' };
        }
      } catch (err) {
        console.error('Error enviando recordatorio Día 7:', err);
      }
    }

    return { sent: false };
  }

  /**
   * Evalúa todos los comercios activos en Trial (para ser ejecutado por Cron diario).
   */
  async evaluateAllTrialMerchants(): Promise<{
    processed: number;
    sentDay5: number;
    sentDay7: number;
  }> {
    const merchants = await this.deps.repository.getTrialMerchants();
    let sentDay5 = 0;
    let sentDay7 = 0;

    for (const merchant of merchants) {
      const res = await this.evaluateMerchantTrial(merchant);
      if (res.sent) {
        if (res.step === 'DAY_5') sentDay5++;
        if (res.step === 'DAY_7') sentDay7++;
      }
    }

    return {
      processed: merchants.length,
      sentDay5,
      sentDay7,
    };
  }
}
