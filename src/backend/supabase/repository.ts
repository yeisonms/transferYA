import { createHash } from 'node:crypto';
import type {
  EnrollmentTokenRecord,
  IEnrollmentRepository,
} from '../enrollment/types.js';
import type {
  IDeviceHealthRepository,
  DeviceHealthRecord,
} from '../heartbeat/types.js';
import type {
  IPaymentFingerprintRepository,
  PaymentFingerprintRecord,
  RegisterFingerprintResult,
} from '../../domain/idempotency/types.js';
import type {
  IMerchantRoutingRepository,
  Merchant,
  CashierRecipient,
} from '../../domain/routing/types.js';
import type {
  IDeviceRepository,
  INonceCache,
  INotificationRepository,
  StoredNotificationRecord,
} from '../webhook/types.js';
import type {
  IPipelineNotificationRepository,
  PipelineNotificationUpdate,
} from '../pipeline/types.js';

export interface SupabaseConfig {
  supabaseUrl: string;
  serviceKey: string;
}

/**
 * Adaptador de producción que conecta el Core Backend con Supabase (PostgreSQL)
 * a través de su interfaz REST nativa (PostgREST) con cero dependencias externas.
 */
export class SupabaseRepository
  implements
    IEnrollmentRepository,
    IDeviceRepository,
    INotificationRepository,
    IPipelineNotificationRepository,
    IDeviceHealthRepository,
    IPaymentFingerprintRepository,
    IMerchantRoutingRepository,
    INonceCache
{
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly memoryNonceCache = new Map<string, number>();

  constructor(config: SupabaseConfig) {
    this.baseUrl = config.supabaseUrl.replace(/\/$/, '');
    this.headers = {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
  }

  // -------------------------------------------------------------
  // IEnrollmentRepository
  // -------------------------------------------------------------

  async ensureMerchantExists(merchantId: string): Promise<void> {
    try {
      const checkRes = await fetch(
        `${this.baseUrl}/rest/v1/merchants?id=eq.${encodeURIComponent(merchantId)}&select=id`,
        { headers: this.headers },
      );
      if (checkRes.ok) {
        const rows = (await checkRes.json()) as any[];
        if (Array.isArray(rows) && rows.length > 0) return;
      }

      await fetch(`${this.baseUrl}/rest/v1/merchants`, {
        method: 'POST',
        headers: {
          ...this.headers,
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({
          id: merchantId,
          owner_id: '00000000-0000-0000-0000-000000000000',
          name: 'Comercio Piloto Alpha',
          status: 'ACTIVE',
        }),
      });
    } catch {
      // Fallback transparente
    }
  }

  async createEnrollmentToken(record: EnrollmentTokenRecord): Promise<void> {
    await this.ensureMerchantExists(record.merchantId);

    const res = await fetch(`${this.baseUrl}/rest/v1/enrollment_tokens`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        token: record.token,
        merchant_id: record.merchantId,
        device_id: record.deviceId,
        label: record.label ?? null,
        expires_at: record.expiresAt,
        is_consumed: false,
        created_at: record.createdAt,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error creando enrollment token en Supabase: ${errText}`);
    }
  }

  async getEnrollmentToken(token: string): Promise<EnrollmentTokenRecord | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/enrollment_tokens?token=eq.${encodeURIComponent(token)}&select=*`,
      {
        headers: this.headers,
      },
    );

    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;

    const row = rows[0];
    return {
      token: row.token,
      merchantId: row.merchant_id,
      deviceId: row.device_id,
      label: row.label ?? undefined,
      expiresAt: Number(row.expires_at),
      isConsumed: Boolean(row.is_consumed),
      createdAt: Number(row.created_at),
    };
  }

  async consumeEnrollmentToken(token: string): Promise<boolean> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/enrollment_tokens?token=eq.${encodeURIComponent(token)}&is_consumed=eq.false`,
      {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({ is_consumed: true }),
      },
    );

    if (!res.ok) return false;
    const updated = (await res.json()) as any[];
    return Array.isArray(updated) && updated.length > 0;
  }

  async registerDeviceSecret(
    deviceId: string,
    merchantId: string,
    secretHash: string,
    label?: string,
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/rest/v1/devices`, {
      method: 'POST',
      headers: {
        ...this.headers,
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        id: deviceId,
        merchant_id: merchantId,
        secret_hash: secretHash,
        label: label ?? 'Caja Principal',
        status: 'ACTIVE',
        updated_at: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error registrando dispositivo en Supabase: ${errText}`);
    }
  }

  async revokeDevice(deviceId: string, merchantId: string): Promise<boolean> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/devices?id=eq.${encodeURIComponent(deviceId)}&merchant_id=eq.${encodeURIComponent(merchantId)}`,
      {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({ status: 'REVOKED', updated_at: new Date().toISOString() }),
      },
    );

    if (!res.ok) return false;
    const updated = (await res.json()) as any[];
    return Array.isArray(updated) && updated.length > 0;
  }

  async getDeviceStatus(
    deviceId: string,
  ): Promise<'ACTIVE' | 'REVOKED' | 'NOT_FOUND'> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/devices?id=eq.${encodeURIComponent(deviceId)}&select=status`,
      {
        headers: this.headers,
      },
    );

    if (!res.ok) return 'NOT_FOUND';
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return 'NOT_FOUND';

    const status = rows[0].status;
    return status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED';
  }

  // -------------------------------------------------------------
  // IDeviceRepository
  // -------------------------------------------------------------

  async getDeviceSecret(deviceId: string): Promise<string | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/devices?id=eq.${encodeURIComponent(deviceId)}&status=eq.ACTIVE&select=secret_hash`,
      {
        headers: this.headers,
      },
    );

    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;

    return rows[0].secret_hash ?? null;
  }

  // -------------------------------------------------------------
  // INotificationRepository
  // -------------------------------------------------------------

  async saveReceivedNotification(
    record: StoredNotificationRecord,
  ): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/rest/v1/captured_notifications`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        device_id: record.deviceId,
        wallet_package: record.walletPackage,
        raw_title: record.rawTitle,
        raw_text: record.rawText,
        captured_at: record.capturedAt,
        dispatched_at: record.dispatchedAt,
        received_at: record.receivedAt,
        latency_ms: record.latencyMs,
        is_stale: record.isStale,
        status: record.status,
        amount: record.amount ?? null,
        sender_name: record.senderName ?? null,
        payment_reference: record.paymentReference ?? null,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error guardando notificación en Supabase: ${errText}`);
    }

    const inserted = (await res.json()) as any[];
    return { id: inserted[0]?.id ?? 'saved' };
  }

  async getNotificationById(id: string): Promise<StoredNotificationRecord | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/captured_notifications?id=eq.${encodeURIComponent(id)}&select=*`,
      { headers: this.headers }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      deviceId: r.device_id,
      walletPackage: r.wallet_package,
      rawTitle: r.raw_title,
      rawText: r.raw_text,
      capturedAt: Number(r.captured_at),
      dispatchedAt: Number(r.dispatched_at),
      receivedAt: Number(r.received_at),
      latencyMs: Number(r.latency_ms),
      isStale: Boolean(r.is_stale),
      status: r.status,
      amount: r.amount ? Number(r.amount) : null,
      senderName: r.sender_name ?? null,
      paymentReference: r.payment_reference ?? null,
    };
  }

  async updateNotification(
    id: string,
    update: PipelineNotificationUpdate,
  ): Promise<void> {
    const body: Record<string, any> = {
      status: update.status,
    };
    if (update.amount !== undefined) body.amount = update.amount;
    if (update.senderName !== undefined) body.sender_name = update.senderName;
    if (update.paymentReference !== undefined) body.payment_reference = update.paymentReference;
    if (update.whatsappMessageIds !== undefined) body.whatsapp_message_ids = update.whatsappMessageIds;
    if (update.processedAt !== undefined) body.processed_at = update.processedAt;
    if (update.failureReason !== undefined) body.failure_reason = update.failureReason;

    await fetch(
      `${this.baseUrl}/rest/v1/captured_notifications?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify(body),
      }
    );
  }

  // -------------------------------------------------------------
  // IDeviceHealthRepository
  // -------------------------------------------------------------

  async upsertDeviceHeartbeat(record: DeviceHealthRecord): Promise<void> {
    await fetch(
      `${this.baseUrl}/rest/v1/devices?id=eq.${encodeURIComponent(record.deviceId)}`,
      {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({
          last_heartbeat_at: new Date(record.lastSeenAt).toISOString(),
          status: 'ACTIVE',
        }),
      },
    );
  }

  async getDeviceHealth(deviceId: string): Promise<DeviceHealthRecord | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/devices?id=eq.${encodeURIComponent(deviceId)}&select=*`,
      {
        headers: this.headers,
      },
    );

    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;

    const r = rows[0];
    return {
      deviceId: r.id,
      lastSeenAt: r.last_heartbeat_at ? new Date(r.last_heartbeat_at).getTime() : 0,
      batteryLevel: 100,
      isCharging: false,
      networkType: 'WIFI',
      appVersion: '0.1.0',
      status: r.status === 'ACTIVE' ? 'ONLINE' : 'OFFLINE',
    };
  }

  async findOfflineDevices(
    inactivityThresholdMs: number,
    now: number,
  ): Promise<DeviceHealthRecord[]> {
    const cutoff = new Date(now - inactivityThresholdMs).toISOString();
    const res = await fetch(
      `${this.baseUrl}/rest/v1/devices?last_heartbeat_at=lt.${cutoff}&status=eq.ACTIVE&select=*`,
      {
        headers: this.headers,
      },
    );

    if (!res.ok) return [];
    const rows = (await res.json()) as any[];
    return rows.map((r) => ({
      deviceId: r.id,
      lastSeenAt: new Date(r.last_heartbeat_at).getTime(),
      batteryLevel: 0,
      isCharging: false,
      networkType: 'WIFI',
      appVersion: '0.1.0',
      status: 'OFFLINE',
    }));
  }

  // -------------------------------------------------------------
  // IPaymentFingerprintRepository
  // -------------------------------------------------------------

  async registerFingerprint(
    record: PaymentFingerprintRecord,
  ): Promise<RegisterFingerprintResult> {
    const existing = await this.findByFingerprint(
      record.deviceId,
      record.fingerprint,
    );
    if (existing) {
      return { isDuplicate: true, existingRecord: existing };
    }

    const res = await fetch(`${this.baseUrl}/rest/v1/payment_fingerprints`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        device_id: record.deviceId,
        payment_fingerprint: record.fingerprint,
        wallet: record.wallet,
        amount: record.amount,
        sender_name: record.senderName,
        captured_at: record.capturedAt,
      }),
    });

    if (!res.ok) {
      // Si falló por restricción única (409 / conflict)
      return { isDuplicate: true };
    }

    return { isDuplicate: false };
  }

  async findByFingerprint(
    deviceId: string,
    fingerprint: string,
  ): Promise<PaymentFingerprintRecord | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/payment_fingerprints?device_id=eq.${encodeURIComponent(deviceId)}&payment_fingerprint=eq.${encodeURIComponent(fingerprint)}&select=*`,
      {
        headers: this.headers,
      },
    );

    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;

    const r = rows[0];
    return {
      id: r.id,
      deviceId: r.device_id,
      fingerprint: r.payment_fingerprint,
      wallet: r.wallet,
      amount: Number(r.amount),
      senderName: r.sender_name,
      capturedAt: Number(r.captured_at),
    };
  }

  // -------------------------------------------------------------
  // IMerchantRoutingRepository
  // -------------------------------------------------------------

  async getMerchantByDeviceId(deviceId: string): Promise<Merchant | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/devices?id=eq.${encodeURIComponent(deviceId)}&select=merchants(id,name,status,subscription_expires_at,created_at)`,
      {
        headers: this.headers,
      },
    );

    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;

    const m = rows[0].merchants;
    if (!m) return null;

    return {
      id: m.id,
      name: m.name,
      status: m.status,
      subscriptionExpiresAt: m.subscription_expires_at
        ? new Date(m.subscription_expires_at).getTime()
        : null,
      createdAt: new Date(m.created_at).getTime(),
    };
  }

  async getCashierRecipients(
    merchantId: string,
    deviceId?: string,
  ): Promise<CashierRecipient[]> {
    let url = `${this.baseUrl}/rest/v1/cashier_recipients?merchant_id=eq.${encodeURIComponent(merchantId)}&is_active=eq.true&select=*`;
    if (deviceId) {
      url += `&or=(device_id.is.null,device_id.eq.${encodeURIComponent(deviceId)})`;
    }

    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) return [];

    const rows = (await res.json()) as any[];
    return rows.map((r) => ({
      id: r.id,
      merchantId: r.merchant_id,
      deviceId: r.device_id ?? null,
      name: r.name,
      phoneNumber: r.phone_number,
      isActive: Boolean(r.is_active),
    }));
  }

  // -------------------------------------------------------------
  // INonceCache (Anti-Replay)
  // -------------------------------------------------------------

  async acquireNonce(
    deviceId: string,
    nonce: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const key = `${deviceId}:${nonce}`;
    const now = Date.now();

    const existingExpiry = this.memoryNonceCache.get(key);
    if (existingExpiry && existingExpiry > now) {
      return false; // Ya consumido
    }

    this.memoryNonceCache.set(key, now + ttlSeconds * 1000);

    // Limpieza oportunista de nonces expirados
    if (this.memoryNonceCache.size > 500) {
      for (const [k, exp] of this.memoryNonceCache.entries()) {
        if (exp <= now) this.memoryNonceCache.delete(k);
      }
    }

    return true;
  }
}
