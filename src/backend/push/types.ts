export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface WebPushSubscription {
  id?: string;
  merchantId: string;
  endpoint: string;
  keys: PushSubscriptionKeys;
  userAgent?: string;
  createdAt?: number;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  data?: Record<string, unknown>;
  timestamp?: number;
}

export interface IPushSubscriptionRepository {
  saveSubscription(subscription: WebPushSubscription): Promise<void>;
  deleteSubscription(endpoint: string): Promise<void>;
  getSubscriptionsByMerchantId(merchantId: string): Promise<WebPushSubscription[]>;
}
