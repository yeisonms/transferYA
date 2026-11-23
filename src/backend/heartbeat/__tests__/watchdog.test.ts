import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SentinelWatchdogService, type WatchdogRepository } from '../watchdog.js';
import type { IWhatsAppCloudApiClient } from '../../../whatsapp/types.js';
import type { DeviceHealthRecord } from '../types.js';

describe('SentinelWatchdogService (Bloque 2 / Heartbeat Watchdog)', () => {
  const fixedNow = 1700000000000;
  let mockRepo: WatchdogRepository;
  let mockWhatsAppClient: IWhatsAppCloudApiClient;

  beforeEach(() => {
    SentinelWatchdogService.clearAllCooldowns();

    mockRepo = {
      findOfflineDevices: vi.fn(),
      getMerchantByDeviceId: vi.fn(),
      getMerchantById: vi.fn(),
      getCashierRecipients: vi.fn(),
      getDeviceHealth: vi.fn(),
      upsertDeviceHeartbeat: vi.fn(),
    };

    mockWhatsAppClient = {
      sendTemplate: vi.fn(),
      sendPaymentAlert: vi.fn(),
      sendSubscriptionNotice: vi.fn(),
      sendRenewalConfirmation: vi.fn(),
      sendTrialWelcome: vi.fn(),
      sendTrialReminder: vi.fn(),
      sendOfflineSentinelAlert: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'msg-alert-123',
      }),
    };
  });

  it('despacha alerta preventiva a WhatsApp si un dispositivo físico lleva más de 5 min offline', async () => {
    const offlineRecord: DeviceHealthRecord = {
      deviceId: 'centinela-caja-01',
      merchantId: 'merchant-abc',
      label: 'Caja Principal',
      status: 'OFFLINE',
      batteryLevel: 20,
      isCharging: false,
      networkType: 'WIFI',
      appVersion: '1.0.0',
      lastSeenAt: fixedNow - 360_000, // 6 min offline
    };

    vi.mocked(mockRepo.findOfflineDevices).mockResolvedValue([offlineRecord]);
    vi.mocked(mockRepo.getMerchantByDeviceId!).mockResolvedValue({
      id: 'merchant-abc',
      name: 'Supermercado Central',
      billing_phone: '+573113654315',
    });

    const watchdog = new SentinelWatchdogService({
      repository: mockRepo,
      whatsappClient: mockWhatsAppClient,
      nowProvider: () => fixedNow,
    });

    const alerts = await watchdog.checkAndAlertOfflineDevices();

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      deviceId: 'centinela-caja-01',
      recipientPhone: '+573113654315',
      deviceLabel: 'Caja Principal',
      minutesOffline: 6,
      success: true,
    });
    expect(mockWhatsAppClient.sendOfflineSentinelAlert).toHaveBeenCalledWith(
      '+573113654315',
      {
        deviceLabel: 'Caja Principal',
        merchantName: 'Supermercado Central',
        minutesOffline: 6,
      },
    );
  });

  it('ignora dispositivos virtuales en la nube (cloud_email_*)', async () => {
    const virtualOffline: DeviceHealthRecord = {
      deviceId: 'cloud_email_merchant-123',
      merchantId: 'merchant-123',
      status: 'OFFLINE',
      batteryLevel: 100,
      isCharging: true,
      networkType: 'WIFI',
      appVersion: '1.0.0',
      lastSeenAt: fixedNow - 600_000,
    };

    vi.mocked(mockRepo.findOfflineDevices).mockResolvedValue([virtualOffline]);

    const watchdog = new SentinelWatchdogService({
      repository: mockRepo,
      whatsappClient: mockWhatsAppClient,
      nowProvider: () => fixedNow,
    });

    const alerts = await watchdog.checkAndAlertOfflineDevices();

    expect(alerts).toHaveLength(0);
    expect(mockWhatsAppClient.sendOfflineSentinelAlert).not.toHaveBeenCalled();
  });

  it('respeta el cooldown de 3 horas para evitar spam al comerciante', async () => {
    const offlineRecord: DeviceHealthRecord = {
      deviceId: 'centinela-caja-01',
      merchantId: 'merchant-abc',
      label: 'Caja 1',
      status: 'OFFLINE',
      batteryLevel: 10,
      isCharging: false,
      networkType: 'CELLULAR',
      appVersion: '1.0.0',
      lastSeenAt: fixedNow - 400_000,
    };

    vi.mocked(mockRepo.findOfflineDevices).mockResolvedValue([offlineRecord]);
    vi.mocked(mockRepo.getMerchantByDeviceId!).mockResolvedValue({
      id: 'merchant-abc',
      name: 'Tienda Pepe',
      billing_phone: '+573113654315',
    });

    let currentTime = fixedNow;
    const watchdog = new SentinelWatchdogService({
      repository: mockRepo,
      whatsappClient: mockWhatsAppClient,
      nowProvider: () => currentTime,
    });

    // Primera alerta: Debe enviarse
    const alerts1 = await watchdog.checkAndAlertOfflineDevices();
    expect(alerts1).toHaveLength(1);
    expect(mockWhatsAppClient.sendOfflineSentinelAlert).toHaveBeenCalledTimes(1);

    // Segunda ejecución a los 10 minutos (dentro del cooldown de 3 horas): No debe reenviar
    currentTime += 600_000;
    const alerts2 = await watchdog.checkAndAlertOfflineDevices();
    expect(alerts2).toHaveLength(0);
    expect(mockWhatsAppClient.sendOfflineSentinelAlert).toHaveBeenCalledTimes(1);

    // Tercera ejecución tras 3 horas y 1 minuto: Debe volver a alertar
    currentTime += 10_800_000 + 1_000;
    const alerts3 = await watchdog.checkAndAlertOfflineDevices();
    expect(alerts3).toHaveLength(1);
    expect(mockWhatsAppClient.sendOfflineSentinelAlert).toHaveBeenCalledTimes(2);
  });

  it('resetCooldown permite volver a alertar de inmediato si el dispositivo se reconectó y luego volvió a caer', async () => {
    const offlineRecord: DeviceHealthRecord = {
      deviceId: 'centinela-caja-01',
      merchantId: 'merchant-abc',
      label: 'Caja 1',
      status: 'OFFLINE',
      batteryLevel: 10,
      isCharging: false,
      networkType: 'CELLULAR',
      appVersion: '1.0.0',
      lastSeenAt: fixedNow - 400_000,
    };

    vi.mocked(mockRepo.findOfflineDevices).mockResolvedValue([offlineRecord]);
    vi.mocked(mockRepo.getMerchantByDeviceId!).mockResolvedValue({
      id: 'merchant-abc',
      name: 'Tienda Pepe',
      billing_phone: '+573113654315',
    });

    let currentTime = fixedNow;
    const watchdog = new SentinelWatchdogService({
      repository: mockRepo,
      whatsappClient: mockWhatsAppClient,
      nowProvider: () => currentTime,
    });

    // 1. Envía alerta
    await watchdog.checkAndAlertOfflineDevices();
    expect(mockWhatsAppClient.sendOfflineSentinelAlert).toHaveBeenCalledTimes(1);

    // 2. Dispositivo emite heartbeat y se resetea cooldown
    SentinelWatchdogService.resetCooldown('centinela-caja-01');

    // 3. 10 minutos después se vuelve a desconectar
    currentTime += 600_000;
    const alerts = await watchdog.checkAndAlertOfflineDevices();
    expect(alerts).toHaveLength(1);
    expect(mockWhatsAppClient.sendOfflineSentinelAlert).toHaveBeenCalledTimes(2);
  });
});
