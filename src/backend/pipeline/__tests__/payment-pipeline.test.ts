import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryPaymentFingerprintRepository } from '../../../domain/idempotency/fingerprint.js';
import {
  InMemoryMerchantRoutingRepository,
  MerchantRoutingService,
} from '../../../domain/routing/service.js';
import type { CashierRecipient, Merchant } from '../../../domain/routing/types.js';
import type {
  IWhatsAppCloudApiClient,
  PaymentAlertOptions,
  WhatsAppSendResult,
} from '../../../whatsapp/types.js';
import type { StoredNotificationRecord } from '../../webhook/types.js';
import { PaymentProcessingPipeline } from '../orchestrator.js';
import type {
  IPipelineNotificationRepository,
  PipelineNotificationUpdate,
} from '../types.js';

class InMemoryPipelineNotificationRepository
  implements IPipelineNotificationRepository
{
  private notifications = new Map<string, StoredNotificationRecord>();
  public updates: Array<{ id: string; update: PipelineNotificationUpdate }> = [];

  seed(record: StoredNotificationRecord & { id: string }): void {
    this.notifications.set(record.id, record);
  }

  async getNotificationById(id: string): Promise<StoredNotificationRecord | null> {
    return this.notifications.get(id) ?? null;
  }

  async updateNotification(
    id: string,
    update: PipelineNotificationUpdate,
  ): Promise<void> {
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
  let notificationRepo: InMemoryPipelineNotificationRepository;
  let fingerprintRepo: InMemoryPaymentFingerprintRepository;
  let routingRepo: InMemoryMerchantRoutingRepository;
  let routingService: MerchantRoutingService;
  let mockWhatsappClient: IWhatsAppCloudApiClient;
  let pipeline: PaymentProcessingPipeline;

  const now = 1715000000000;
  const deviceId = 'dev_centinela_caja_1';

  const merchant: Merchant = {
    id: 'merchant_minimarket_el_sol',
    name: 'Minimarket El Sol',
    status: 'ACTIVE',
    subscriptionExpiresAt: now + 86400000 * 30,
    createdAt: now - 86400000,
  };

  const cashier1: CashierRecipient = {
    id: 'caja_1',
    merchantId: merchant.id,
    deviceId: deviceId,
    name: 'Cajero Principal',
    phoneNumber: '+573001112233',
    isActive: true,
  };

  const cashier2: CashierRecipient = {
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
    const notification: StoredNotificationRecord & { id: string } = {
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
    expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledWith(
      '+573001112233',
      expect.objectContaining({ amount: 45000 }),
      expect.objectContaining({ isStale: false }),
    );

    // Verificar actualización final en el repositorio
    const updated = await notificationRepo.getNotificationById('notif_nequi_001');
    expect(updated?.status).toBe('PROCESSED');
    expect(updated?.amount).toBe(45000);
    expect(updated?.senderName).toBe('Juan Perez');
  });

  it('2. Flujo Feliz E2E con Stale Alert (Daviplata - Latencia > 90s)', async () => {
    const notification: StoredNotificationRecord & { id: string } = {
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

    const result = await pipeline.processCapturedNotification(
      'notif_daviplata_stale_002',
    );

    expect(result.status).toBe('PROCESSED');
    if (result.status === 'PROCESSED') {
      expect(result.receipt.amount).toBe(120000);
      expect(result.receipt.senderName).toBe('Maria Gomez');
      expect(result.receipt.wallet).toBe('DAVIPLATA');
    }

    // Comprobar que sendPaymentAlert recibió isStale: true
    expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ amount: 120000 }),
      expect.objectContaining({ isStale: true, latencyMs: 120000 }),
    );
  });

  it('3. Descarte de Falsos Positivos (Notificaciones no monetarias -> IGNORED_NON_PAYMENT)', async () => {
    const notification: StoredNotificationRecord & { id: string } = {
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
    const notificationA: StoredNotificationRecord & { id: string } = {
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

    const notificationDuplicate: StoredNotificationRecord & { id: string } = {
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
    const result1 = await pipeline.processCapturedNotification(
      'notif_payment_original',
    );
    expect(result1.status).toBe('PROCESSED');
    expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledTimes(2);

    // 2do procesamiento del duplicado en ráfaga: Debe ser descartado por idempotencia
    const result2 = await pipeline.processCapturedNotification(
      'notif_payment_sms_burst',
    );
    expect(result2.status).toBe('DUPLICATE_PAYMENT');
    if (result2.status === 'DUPLICATE_PAYMENT') {
      expect(result2.fingerprint).toBeDefined();
    }

    // Los llamados a WhatsApp no deben haber aumentado (siguen en 2)
    expect(mockWhatsappClient.sendPaymentAlert).toHaveBeenCalledTimes(2);

    const updatedDup = await notificationRepo.getNotificationById(
      'notif_payment_sms_burst',
    );
    expect(updatedDup?.status).toBe('DUPLICATE_PAYMENT');
  });

  it('5. Fallo de Enrutamiento (Comercio Inactivo o Suspendido -> ROUTING_FAILED)', async () => {
    const suspendedMerchant: Merchant = {
      ...merchant,
      id: 'merchant_suspendido_id',
      status: 'SUSPENDED',
    };
    routingRepo.registerDeviceMerchant('dev_suspendido', suspendedMerchant);

    const notification: StoredNotificationRecord & { id: string } = {
      id: 'notif_merchant_suspendido',
      deviceId: 'dev_suspendido',
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

    const result = await pipeline.processCapturedNotification(
      'notif_merchant_suspendido',
    );

    expect(result.status).toBe('ROUTING_FAILED');
    expect(mockWhatsappClient.sendPaymentAlert).not.toHaveBeenCalled();

    const updated = await notificationRepo.getNotificationById(
      'notif_merchant_suspendido',
    );
    expect(updated?.status).toBe('ROUTING_FAILED');
  });

  it('6. Fallo Total de Despacho en WhatsApp (DISPATCH_FAILED)', async () => {
    const notification: StoredNotificationRecord & { id: string } = {
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
    const notification: StoredNotificationRecord & { id: string } = {
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
});
