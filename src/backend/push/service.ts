import * as rawWebpush from 'web-push';
import type {
  IPushSubscriptionRepository,
  PushNotificationPayload,
  WebPushSubscription,
} from './types.js';

const webpush: any = (rawWebpush as any).default || rawWebpush;

export const DEFAULT_VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  'BJSUuHPY2o3nBwXT_09Ggd5NPaZwwb9ArQz-u-oRDRi6Qpi0btc349pyL8gnaChk5HHyNhpjHMcAPUuIIEnIqgg';

export const DEFAULT_VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY || '3TcucAgFjFwHIVoyLx_ezvYtpKthUt3xMFIMgCdBCcU';

export const DEFAULT_VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || 'mailto:soporte@transferya.app';

export interface WebPushServiceConfig {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}

export class WebPushService {
  private publicKey: string;
  private privateKey: string;
  private subject: string;
  private repository: IPushSubscriptionRepository;

  constructor(repository: IPushSubscriptionRepository, config?: WebPushServiceConfig) {
    this.repository = repository;
    this.publicKey = config?.publicKey || DEFAULT_VAPID_PUBLIC_KEY;
    this.privateKey = config?.privateKey || DEFAULT_VAPID_PRIVATE_KEY;
    this.subject = config?.subject || DEFAULT_VAPID_SUBJECT;

    try {
      webpush.setVapidDetails(this.subject, this.publicKey, this.privateKey);
    } catch (err) {
      console.warn('Advertencia configurando VAPID en WebPushService:', err);
    }
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  async sendToSubscription(
    subscription: WebPushSubscription,
    payload: PushNotificationPayload,
  ): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    };

    const payloadString = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icons/icon-192.png',
      badge: payload.badge || '/icons/favicon-96x96.png',
      tag: payload.tag || 'transferya-payment',
      url: payload.url || '/',
      data: payload.data || {},
      timestamp: payload.timestamp || Date.now(),
    });

    try {
      const res = await webpush.sendNotification(pushSubscription, payloadString, {
        TTL: 3600,
        urgency: 'high',
      });
      return { success: true, statusCode: res.statusCode };
    } catch (err: any) {
      const statusCode = err?.statusCode;
      // 404 Not Found o 410 Gone indican que la suscripción caducó o fue revocada en el navegador
      if (statusCode === 404 || statusCode === 410) {
        try {
          await this.repository.deleteSubscription(subscription.endpoint);
        } catch (delErr) {
          console.error('Error eliminando suscripción caducada:', delErr);
        }
      }
      return {
        success: false,
        statusCode,
        error: err?.message || 'Error despachando Web Push',
      };
    }
  }

  async broadcastToMerchant(
    merchantId: string,
    payload: PushNotificationPayload,
  ): Promise<{
    total: number;
    sent: number;
    failed: number;
    details?: Array<{ endpointSuffix: string; success: boolean; statusCode?: number; error?: string }>;
  }> {
    if (!this.repository || typeof this.repository.getSubscriptionsByMerchantId !== 'function') {
      return { total: 0, sent: 0, failed: 0, details: [] };
    }

    const subscriptions = await this.repository.getSubscriptionsByMerchantId(merchantId);
    if (!subscriptions || subscriptions.length === 0) {
      return { total: 0, sent: 0, failed: 0, details: [] };
    }

    let sent = 0;
    let failed = 0;
    const details: Array<{ endpointSuffix: string; success: boolean; statusCode?: number; error?: string }> = [];

    await Promise.all(
      subscriptions.map(async (sub) => {
        const result = await this.sendToSubscription(sub, payload);
        if (result.success) sent++;
        else failed++;
        details.push({
          endpointSuffix: sub.endpoint.slice(-16),
          success: result.success,
          statusCode: result.statusCode,
          error: result.error,
        });
      }),
    );

    return { total: subscriptions.length, sent, failed, details };
  }
}
