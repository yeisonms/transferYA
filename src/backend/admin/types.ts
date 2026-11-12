import type { SubscriptionStatus } from '../../domain/routing/types.js';

export type AdminSubscriptionAction =
  | 'ACTIVATE_TRIAL'
  | 'EXTEND_30_DAYS'
  | 'PAUSE'
  | 'RESUME'
  | 'UPDATE_BILLING_PHONE';

export interface AdminSubscriptionActionPayload {
  merchantId: string;
  action: AdminSubscriptionAction;
  days?: number;
  billingPhone?: string;
}

export interface AdminMerchantSummary {
  id: string;
  name: string;
  ownerId: string;
  status: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionEndsAt: number | null;
  subscriptionEndsAtIso: string | null;
  effectiveSubscriptionStatus: SubscriptionStatus;
  remainingDays: number;
  billingPhone: string | null;
  totalDevices: number;
  onlineDevices: number;
  lastHeartbeatAt: number | null;
  createdAt: number;
}

export interface AdminMerchantRow {
  id: string;
  name: string;
  owner_id: string;
  status: string;
  subscription_status?: string | null;
  subscription_ends_at?: string | null;
  subscription_expires_at?: string | null;
  billing_phone?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface AdminDeviceRow {
  id: string;
  merchant_id: string;
  label?: string | null;
  status: string;
  last_heartbeat_at?: string | null;
}

export interface IAdminSubscriptionsRepository {
  getAllMerchants(): Promise<AdminMerchantRow[]>;
  getAllDevices(): Promise<AdminDeviceRow[]>;
  getMerchantById(merchantId: string): Promise<AdminMerchantRow | null>;
  updateMerchantSubscription(
    merchantId: string,
    updates: {
      subscription_status?: string;
      subscription_ends_at?: string;
      subscription_expires_at?: string;
      status?: string;
      billing_phone?: string;
      updated_at?: string;
    },
  ): Promise<AdminMerchantRow | null>;
}
