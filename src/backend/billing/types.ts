import type { Merchant } from '../../domain/routing/types.js';

export type BillingInvoiceStatus = 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED';
export type BillingItemType = 'plan_subscription' | 'addon_alerts' | 'addon_cashier';

export interface BillingInvoiceRecord {
  id: string;
  merchant_id: string;
  amount_cop: number;
  reference_code: string;
  status: BillingInvoiceStatus;
  item_type?: BillingItemType;
  item_description?: string;
  notification_id: string | null;
  paid_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface CreateBillingInvoiceInput {
  merchantId: string;
  amountCop?: number;
  referenceCode?: string;
  status?: BillingInvoiceStatus;
  itemType?: BillingItemType;
  itemDescription?: string;
  notificationId?: string;
  paidAt?: string | null;
  expiresAt?: string;
}

export type ReconciliationStrategy = 'REFERENCE_CODE' | 'BILLING_PHONE';

export interface BillingReconciliationConfig {
  billingSentinelDeviceId: string;
  minPlanPriceCop?: number; // Default: 7_900 COP
  defaultPlanDays?: number; // Default: 30 días
}

export interface ReconciliationResult {
  isBillingSentinel: boolean;
  isDogfooding: boolean;
  success: boolean;
  matchedMerchant?: Merchant;
  matchedInvoice?: BillingInvoiceRecord;
  strategy?: ReconciliationStrategy;
  matchedReference?: string;
  matchedPhone?: string;
  amountCop?: number;
  minRequiredCop?: number;
  itemType?: BillingItemType;
  planId?: string;
  extraAlertsAdded?: number;
  extraCashiersAdded?: number;
  newEndsAtIso?: string;
  previousEndsAtIso?: string | null;
  daysRemaining?: number;
  whatsappSent?: boolean;
  whatsappMessageId?: string;
  failureReason?:
    | 'NOT_BILLING_SENTINEL'
    | 'INSUFFICIENT_AMOUNT'
    | 'UNMATCHED_MERCHANT'
    | 'ALREADY_PAID'
    | 'INTERNAL_ERROR';
  details?: string;
}

export interface IBillingInvoicesRepository {
  findMerchantByBillingPhone(normalizedPhone: string): Promise<Merchant | null>;
  findMerchantById(merchantId: string): Promise<Merchant | null>;
  findInvoiceByReference(referenceCode: string): Promise<BillingInvoiceRecord | null>;
  getPendingInvoiceForMerchant(merchantId: string): Promise<BillingInvoiceRecord | null>;
  createInvoice(input: CreateBillingInvoiceInput): Promise<BillingInvoiceRecord>;
  markInvoicePaid(
    invoiceId: string,
    notificationId: string,
    paidAtMs?: number,
  ): Promise<BillingInvoiceRecord>;
  extendMerchantSubscription(
    merchantId: string,
    days?: number,
    nowMs?: number,
    planId?: string,
  ): Promise<{
    previousEndsAt: string | null;
    newEndsAt: string;
    daysRemaining: number;
  }>;
  applyAddonPurchase?(
    merchantId: string,
    addonType: 'addon_alerts' | 'addon_cashier',
    amountCop: number,
    notificationId?: string,
    nowMs?: number,
  ): Promise<{
    extraAlerts: number;
    extraCashiers: number;
  }>;
}

