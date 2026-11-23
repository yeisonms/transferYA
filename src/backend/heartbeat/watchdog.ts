import type { IWhatsAppClient } from '../../whatsapp/types.js';
import type { DeviceHealthRecord, IDeviceHealthRepository } from './types.js';

export interface WatchdogRepository extends IDeviceHealthRepository {
  getMerchantByDeviceId?(deviceId: string): Promise<any>;
  getMerchantById?(merchantId: string): Promise<any>;
  getCashierRecipients?(merchantId: string): Promise<any[]>;
}

export interface SentinelWatchdogDependencies {
  repository: WatchdogRepository;
  whatsappClient: IWhatsAppClient;
  nowProvider?: () => number;
}

export interface WatchdogAlertItem {
  deviceId: string;
  merchantId?: string;
  merchantName?: string;
  deviceLabel: string;
  recipientPhone: string;
  minutesOffline: number;
  success: boolean;
  messageId?: string;
  error?: string;
}

export class SentinelWatchdogService {
  private static cooldowns = new Map<string, number>();

  private nowProvider: () => number;

  constructor(private deps: SentinelWatchdogDependencies) {
    this.nowProvider = deps.nowProvider ?? (() => Date.now());
  }

  /**
   * Resetea el cooldown de un dispositivo cuando vuelve a emitir Heartbeat (vuelve a estar ONLINE).
   */
  static resetCooldown(deviceId: string): void {
    SentinelWatchdogService.cooldowns.delete(deviceId);
  }

  /**
   * Limpia todos los cooldowns en memoria (útil para tests unitarios).
   */
  static clearAllCooldowns(): void {
    SentinelWatchdogService.cooldowns.clear();
  }

  /**
   * Escanea dispositivos físicos activos que llevan más de 5 minutos sin emitir Heartbeat
   * y despacha una alerta preventiva por WhatsApp al dueño del comercio respectivo.
   */
  async checkAndAlertOfflineDevices(options: {
    inactivityThresholdMs?: number;
    cooldownMs?: number;
  } = {}): Promise<WatchdogAlertItem[]> {
    const thresholdMs = options.inactivityThresholdMs ?? 300_000; // 5 minutos por defecto
    const cooldownMs = options.cooldownMs ?? 10_800_000; // 3 horas por defecto
    const now = this.nowProvider();

    const offlineDevices: DeviceHealthRecord[] =
      await this.deps.repository.findOfflineDevices(thresholdMs, now);

    const alerts: WatchdogAlertItem[] = [];

    for (const dev of offlineDevices) {
      // Ignorar dispositivos virtuales de respaldo en la nube (cloud_email_*)
      if (dev.deviceId.startsWith('cloud_email_')) continue;

      // Verificar cooldown para no saturar al dueño con mensajes repetitivos
      const lastAlertedAt = SentinelWatchdogService.cooldowns.get(dev.deviceId);
      if (lastAlertedAt && now - lastAlertedAt < cooldownMs) {
        continue;
      }

      // Resolver comercio y teléfono de notificación (billing_phone o cajeros)
      let merchant: any = null;
      try {
        if (typeof this.deps.repository.getMerchantByDeviceId === 'function') {
          merchant = await this.deps.repository.getMerchantByDeviceId(dev.deviceId);
        }
        if (!merchant && dev.merchantId && typeof this.deps.repository.getMerchantById === 'function') {
          merchant = await this.deps.repository.getMerchantById(dev.merchantId);
        }
      } catch (err) {
        console.warn(`[SentinelWatchdog] Error resolviendo comercio para dispositivo ${dev.deviceId}:`, err);
      }

      const targetPhone =
        merchant?.billing_phone ||
        merchant?.billingPhone ||
        null;

      if (!targetPhone) {
        continue;
      }

      const minutesOffline = Math.max(5, Math.round((now - dev.lastSeenAt) / 60_000));
      const deviceLabel = dev.label || 'Caja Mostrador';
      const merchantName = merchant?.name || undefined;

      try {
        let sendResult: any = { success: false, message: 'Cliente WhatsApp sin soporte para alertas offline' };
        if (typeof this.deps.whatsappClient.sendOfflineSentinelAlert === 'function') {
          sendResult = await this.deps.whatsappClient.sendOfflineSentinelAlert(
            targetPhone,
            {
              deviceLabel,
              merchantName,
              minutesOffline,
            },
          );
        }

        SentinelWatchdogService.cooldowns.set(dev.deviceId, now);

        alerts.push({
          deviceId: dev.deviceId,
          merchantId: merchant?.id || dev.merchantId,
          merchantName,
          deviceLabel,
          recipientPhone: targetPhone,
          minutesOffline,
          success: sendResult.success,
          messageId: sendResult.success ? sendResult.messageId : undefined,
          error: !sendResult.success ? sendResult.message : undefined,
        });
      } catch (sendErr: any) {
        alerts.push({
          deviceId: dev.deviceId,
          merchantId: merchant?.id || dev.merchantId,
          merchantName,
          deviceLabel,
          recipientPhone: targetPhone,
          minutesOffline,
          success: false,
          error: sendErr?.message || 'Error desconocido enviando alerta WhatsApp',
        });
      }
    }

    return alerts;
  }
}
