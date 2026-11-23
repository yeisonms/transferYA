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
import type {
  AdminDeviceRow,
  AdminMerchantRow,
  IAdminSubscriptionsRepository,
} from '../admin/types.js';
import type {
  BillingInvoiceRecord,
  CreateBillingInvoiceInput,
  IBillingInvoicesRepository,
} from '../billing/types.js';
import { generateInvoiceReferenceCode } from '../billing/utils.js';
import { resolveSubscriptionEndsAt } from '../../domain/routing/billing.js';
import {
  normalizeSenderForFingerprint,
  isUniqueBankTransactionReference,
} from '../../domain/idempotency/fingerprint.js';
import { cleanCopAmount } from '../../domain/parser/engine.js';

export interface SupabaseConfig {
  supabaseUrl: string;
  serviceKey: string;
  bearerToken?: string;
}

export interface OwnedMerchantRecord {
  id: string;
  owner_id: string;
  name: string;
  status: string;
  subscription_expires_at: string | null;
  subscription_status?: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';
  subscription_ends_at?: string | null;
  billing_phone?: string | null;
  created_at: string;
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
    IAdminSubscriptionsRepository,
    IBillingInvoicesRepository,
    INonceCache
{
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly memoryNonceCache = new Map<string, number>();

  constructor(config: SupabaseConfig) {
    this.baseUrl = config.supabaseUrl.replace(/\/$/, '');
    this.headers = {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.bearerToken ?? config.serviceKey}`,
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

  async registerDevice(
    deviceId: string,
    merchantId: string,
    secretHash: string,
    label?: string,
  ): Promise<void> {
    return this.registerDeviceSecret(deviceId, merchantId, secretHash, label);
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
    // Nota: `captured_notifications` no tiene columna `failure_reason` en el esquema actual;
    // evitamos enviarla para que PostgREST no rechace el PATCH con 400 y deje el estado en PROCESSING.

    const res = await fetch(
      `${this.baseUrl}/rest/v1/captured_notifications?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Error actualizando notificación ${id} (${res.status}): ${errText}`);
    }
  }

  async findRecentDuplicatePayment(params: {
    merchantId: string;
    amount: number;
    capturedAt: number;
    currentDeviceId: string;
    currentNotificationId: string;
    reference?: string | null;
    senderName?: string;
    rawTitle?: string;
  }): Promise<{ id: string; deviceId?: string; capturedAt?: number; amount?: number; paymentReference?: string | null; senderName?: string | null } | null> {
    try {
      // 1. Obtener los IDs de todos los dispositivos de este comercio
      const devRes = await fetch(
        `${this.baseUrl}/rest/v1/devices?merchant_id=eq.${encodeURIComponent(params.merchantId)}&select=id`,
        { headers: this.headers }
      );
      if (!devRes.ok) return null;
      const devRows = (await devRes.json()) as Array<{ id: string }>;
      const deviceIds = new Set(devRows.map((d) => d.id));
      deviceIds.add(params.currentDeviceId);

      // 2. Buscar notificaciones activas o procesadas con el mismo monto o en procesamiento
      const notifRes = await fetch(
        `${this.baseUrl}/rest/v1/captured_notifications?status=in.(PROCESSED,PROCESSING,RECEIVED)&or=(amount.eq.${params.amount},amount.is.null)&select=id,device_id,amount,sender_name,payment_reference,captured_at,raw_title,raw_text,wallet_package&order=captured_at.desc&limit=25`,
        { headers: this.headers }
      );
      if (!notifRes.ok) return null;
      const candidates = (await notifRes.json()) as any[];

      let cleanSender = '';
      try {
        if (params.senderName) cleanSender = normalizeSenderForFingerprint(params.senderName);
      } catch {}

      for (const row of candidates) {
        if (row.id === params.currentNotificationId) continue;
        if (!deviceIds.has(row.device_id)) continue;

        let rowAmount = row.amount != null ? Number(row.amount) : null;
        if (rowAmount == null && row.raw_text) {
          try {
            const parsedCop = cleanCopAmount(row.raw_text);
            if (parsedCop > 0) rowAmount = parsedCop;
          } catch {}
        }
        if (rowAmount !== params.amount) continue;

        // Criterio 1: Misma referencia bancaria explícita de la entidad financiera
        const isOfficialBankRef =
          Boolean(params.reference && isUniqueBankTransactionReference(params.reference));

        if (
          isOfficialBankRef &&
          params.reference &&
          row.payment_reference &&
          params.reference.trim().toUpperCase() === row.payment_reference.trim().toUpperCase()
        ) {
          return {
            id: row.id,
            deviceId: row.device_id,
            capturedAt: Number(row.captured_at),
            amount: Number(rowAmount),
            paymentReference: row.payment_reference,
            senderName: row.sender_name ?? null,
          };
        }

        const rowTime = Number(row.captured_at);
        const timeDiff = Math.abs(rowTime - params.capturedAt);

        // Criterio 2: Cruce multicanal (Centinela vs Gmail) para el mismo pago (ventana de 2 minutos)
        const isCrossChannel =
          (row.device_id.startsWith('cloud_email_') && !params.currentDeviceId.startsWith('cloud_email_')) ||
          (!row.device_id.startsWith('cloud_email_') && params.currentDeviceId.startsWith('cloud_email_'));

        if (isCrossChannel && timeDiff <= 120_000) {
          let rowSender = '';
          try {
            if (row.sender_name) rowSender = normalizeSenderForFingerprint(row.sender_name);
          } catch {}

          const isBreB =
            /bre-b/i.test(row.raw_title || '') ||
            /bre-b/i.test(params.rawTitle || '') ||
            row.wallet_package === 'com.nequi.inbound.email' ||
            row.wallet_package === 'com.bancolombia.inbound.email' ||
            row.sender_name === 'Transferencia Bre-B' ||
            params.senderName === 'Transferencia Bre-B';

          if (isBreB || (cleanSender && rowSender && cleanSender === rowSender) || !cleanSender || !rowSender) {
            return {
              id: row.id,
              deviceId: row.device_id,
              capturedAt: rowTime,
              amount: Number(rowAmount),
              paymentReference: row.payment_reference ?? null,
              senderName: row.sender_name ?? null,
            };
          }
        }

        // Criterio 3: Re-envío duplicado del mismo dispositivo
        if (row.device_id === params.currentDeviceId && timeDiff <= 15_000) {
          let rowSender = '';
          try {
            if (row.sender_name) rowSender = normalizeSenderForFingerprint(row.sender_name);
          } catch {}

          if (!cleanSender || !rowSender || cleanSender === rowSender) {
            return {
              id: row.id,
              deviceId: row.device_id,
              capturedAt: rowTime,
              amount: Number(rowAmount),
              paymentReference: row.payment_reference ?? null,
              senderName: row.sender_name ?? null,
            };
          }
        }
      }

      return null;
    } catch (err) {
      console.error('[SupabaseRepository] Error en findRecentDuplicatePayment:', err);
      return null;
    }
  }

  async getLatestGoogleVerification(
    deviceId: string,
  ): Promise<{ code: string; url?: string; receivedAt: number } | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/rest/v1/captured_notifications?device_id=eq.${encodeURIComponent(deviceId)}&raw_title=eq.VERIFICACION_GMAIL&order=received_at.desc&limit=1&select=*`,
        { headers: this.headers },
      );
      if (!res.ok) return null;
      const rows = (await res.json()) as any[];
      if (!rows || rows.length === 0) return null;
      const rawText = rows[0].raw_text;
      if (!rawText) return null;
      const parsed = JSON.parse(rawText);
      return {
        code: parsed.code || '',
        url: parsed.url,
        receivedAt: Number(rows[0].received_at || Date.now()),
      };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------
  // IDeviceHealthRepository
  // -------------------------------------------------------------

  async upsertDeviceHeartbeat(record: DeviceHealthRecord): Promise<void> {
    const isoTimestamp = new Date(record.lastSeenAt).toISOString();
    const res = await fetch(
      `${this.baseUrl}/rest/v1/devices?id=eq.${encodeURIComponent(record.deviceId)}`,
      {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({
          last_heartbeat_at: isoTimestamp,
          updated_at: isoTimestamp,
          status: 'ACTIVE',
        }),
      },
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Error actualizando heartbeat de dispositivo ${record.deviceId}: ${errText}`,
      );
    }
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
    return rows
      .filter((r) => !r.id.startsWith('cloud_email_'))
      .map((r) => ({
        deviceId: r.id,
        merchantId: r.merchant_id,
        label: r.label,
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
    if (record.merchantId) {
      const existingByMerchant = await this.findByMerchantFingerprint(
        record.merchantId,
        record.fingerprint,
      );
      if (existingByMerchant) {
        return { isDuplicate: true, existingRecord: existingByMerchant };
      }
    }

    const existing = await this.findByFingerprint(
      record.deviceId,
      record.fingerprint,
    );
    if (existing) {
      return { isDuplicate: true, existingRecord: existing };
    }

    const payload: Record<string, any> = {
      device_id: record.deviceId,
      payment_fingerprint: record.fingerprint,
      wallet: record.wallet,
      amount: record.amount,
      sender_name: record.senderName,
      captured_at: record.capturedAt,
    };
    if (record.merchantId) {
      payload.merchant_id = record.merchantId;
    }

    let res = await fetch(`${this.baseUrl}/rest/v1/payment_fingerprints`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    // Si falló con 400 porque la columna merchant_id no existe en la base de datos de Supabase
    if (res.status === 400 && payload.merchant_id) {
      delete payload.merchant_id;
      res = await fetch(`${this.baseUrl}/rest/v1/payment_fingerprints`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
      });
    }

    // Únicamente el código HTTP 409 (Conflict) representa un duplicado real de llave única
    if (res.status === 409) {
      const conflictRecord = record.merchantId
        ? await this.findByMerchantFingerprint(record.merchantId, record.fingerprint)
        : await this.findByFingerprint(record.deviceId, record.fingerprint);
      return {
        isDuplicate: true,
        existingRecord: conflictRecord ?? record,
      };
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[SupabaseRepository] Error insertando payment_fingerprints (${res.status}): ${errText}`);
      return { isDuplicate: false };
    }

    return { isDuplicate: false };
  }

  /**
   * Formatea (limpia) las tablas operativas de pruebas (`payment_fingerprints` y
   * `captured_notifications`) para un Dispositivo Centinela específico.
   */
  async resetDeviceTestData(deviceId: string): Promise<{
    deletedFingerprints: number;
    deletedNotifications: number;
  }> {
    const encodedDeviceId = encodeURIComponent(deviceId);

    const fpRes = await fetch(
      `${this.baseUrl}/rest/v1/payment_fingerprints?device_id=eq.${encodedDeviceId}`,
      { method: 'DELETE', headers: this.headers },
    );
    if (!fpRes.ok) {
      const errText = await fpRes.text();
      throw new Error(`Error eliminando huellas de idempotencia: ${errText}`);
    }
    const deletedFp = (await fpRes.json()) as any[];

    const notifRes = await fetch(
      `${this.baseUrl}/rest/v1/captured_notifications?device_id=eq.${encodedDeviceId}`,
      { method: 'DELETE', headers: this.headers },
    );
    if (!notifRes.ok) {
      const errText = await notifRes.text();
      throw new Error(`Error eliminando notificaciones capturadas: ${errText}`);
    }
    const deletedNotifs = (await notifRes.json()) as any[];

    return {
      deletedFingerprints: Array.isArray(deletedFp) ? deletedFp.length : 0,
      deletedNotifications: Array.isArray(deletedNotifs) ? deletedNotifs.length : 0,
    };
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
      merchantId: r.merchant_id,
      fingerprint: r.payment_fingerprint,
      wallet: r.wallet,
      amount: Number(r.amount),
      senderName: r.sender_name,
      capturedAt: Number(r.captured_at),
    };
  }

  async findByMerchantFingerprint(
    merchantId: string,
    fingerprint: string,
  ): Promise<PaymentFingerprintRecord | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/payment_fingerprints?merchant_id=eq.${encodeURIComponent(merchantId)}&payment_fingerprint=eq.${encodeURIComponent(fingerprint)}&select=*`,
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
      merchantId: r.merchant_id,
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

  private mapMerchantRow(m: any): Merchant & { ownerId: string } {
    return {
      id: m.id,
      ownerId: m.owner_id,
      name: m.name,
      status: m.status,
      subscriptionStatus: m.subscription_status ?? undefined,
      subscriptionEndsAt: m.subscription_ends_at
        ? new Date(m.subscription_ends_at).getTime()
        : null,
      subscriptionExpiresAt: m.subscription_expires_at
        ? new Date(m.subscription_expires_at).getTime()
        : null,
      planId: m.plan_id ?? null,
      billingPhone: m.billing_phone ?? null,
      createdAt: new Date(m.created_at).getTime(),
      trialWelcomeSentAt: m.trial_welcome_sent_at
        ? new Date(m.trial_welcome_sent_at).getTime()
        : null,
      trialDay5SentAt: m.trial_day5_sent_at
        ? new Date(m.trial_day5_sent_at).getTime()
        : null,
      trialDay7SentAt: m.trial_day7_sent_at
        ? new Date(m.trial_day7_sent_at).getTime()
        : null,
    };
  }

  async getTrialMerchants(): Promise<Merchant[]> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/merchants?subscription_status=eq.TRIAL&select=*`,
      { headers: this.headers },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as any[];
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => {
      const { ownerId: _ownerId, ...m } = this.mapMerchantRow(r);
      return m;
    });
  }

  async recordTrialNoticeSent(
    merchantId: string,
    noticeType: 'WELCOME' | 'DAY_5' | 'DAY_7',
    timestampIso: string = new Date().toISOString(),
  ): Promise<void> {
    const field =
      noticeType === 'WELCOME'
        ? 'trial_welcome_sent_at'
        : noticeType === 'DAY_5'
          ? 'trial_day5_sent_at'
          : 'trial_day7_sent_at';

    await fetch(
      `${this.baseUrl}/rest/v1/merchants?id=eq.${encodeURIComponent(merchantId)}`,
      {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({ [field]: timestampIso }),
      },
    );
  }

  async getMerchantByDeviceId(deviceId: string): Promise<Merchant | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/devices?id=eq.${encodeURIComponent(deviceId)}&select=merchants(*)`,
      {
        headers: this.headers,
      },
    );

    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;

    const m = rows[0].merchants;
    if (!m) return null;

    const { ownerId: _ownerId, ...merchant } = this.mapMerchantRow(m);
    return merchant;
  }

  async getMerchantWithOwner(
    merchantId: string,
  ): Promise<(Merchant & { ownerId: string }) | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/merchants?id=eq.${encodeURIComponent(merchantId)}&select=*`,
      { headers: this.headers },
    );

    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;

    return this.mapMerchantRow(rows[0]);
  }

  async getMerchantByDeviceWithOwner(
    deviceId: string,
  ): Promise<(Merchant & { ownerId: string }) | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/devices?id=eq.${encodeURIComponent(deviceId)}&select=merchants(*)`,
      { headers: this.headers },
    );

    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;

    const m = rows[0].merchants;
    if (!m) return null;

    return this.mapMerchantRow(m);
  }

  async getMerchantsByOwner(ownerId: string): Promise<OwnedMerchantRecord[]> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/merchants?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=created_at.asc&limit=1`,
      { headers: this.headers },
    );
    if (!res.ok) {
      return [];
    }
    const rows = (await res.json()) as OwnedMerchantRecord[];
    return Array.isArray(rows) ? rows : [];
  }

  async createMerchantForOwner(
    ownerId: string,
    name: string,
  ): Promise<{
    data: OwnedMerchantRecord | null;
    status: number;
    errorMessage?: string;
  }> {
    const res = await fetch(`${this.baseUrl}/rest/v1/merchants?select=*`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        owner_id: ownerId,
        name,
        status: 'ACTIVE',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        data: null,
        status: res.status,
        errorMessage: errText || `HTTP ${res.status}`,
      };
    }

    const rows = (await res.json()) as OwnedMerchantRecord[];
    return {
      data: rows?.[0] ?? null,
      status: res.status,
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

  // -------------------------------------------------------------
  // IAdminSubscriptionsRepository
  // -------------------------------------------------------------

  async getAllMerchants(): Promise<AdminMerchantRow[]> {
    const res = await fetch(`${this.baseUrl}/rest/v1/merchants?select=*&order=created_at.desc`, {
      headers: this.headers,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error obteniendo comercios para Super-Admin (${res.status}): ${errText}`);
    }
    const rows = (await res.json()) as any[];
    return Array.isArray(rows) ? rows : [];
  }

  async getAllDevices(): Promise<AdminDeviceRow[]> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/devices?select=id,merchant_id,label,status,last_heartbeat_at`,
      { headers: this.headers },
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error obteniendo dispositivos para Super-Admin (${res.status}): ${errText}`);
    }
    const rows = (await res.json()) as any[];
    return Array.isArray(rows) ? rows : [];
  }

  async getMerchantById(merchantId: string): Promise<AdminMerchantRow | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/merchants?id=eq.${encodeURIComponent(merchantId)}&select=*`,
      { headers: this.headers },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;
    return rows[0] as AdminMerchantRow;
  }

  async updateMerchantSubscription(
    merchantId: string,
    updates: {
      subscription_status?: string;
      subscription_ends_at?: string;
      subscription_expires_at?: string;
      status?: string;
      billing_phone?: string;
      updated_at?: string;
    },
  ): Promise<AdminMerchantRow | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/merchants?id=eq.${encodeURIComponent(merchantId)}`,
      {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify(updates),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Error actualizando suscripción de comercio ${merchantId} (${res.status}): ${errText}`,
      );
    }

    const updated = (await res.json()) as any[];
    if (!Array.isArray(updated) || updated.length === 0) return null;
    return updated[0] as AdminMerchantRow;
  }

  async deleteMerchant(merchantId: string): Promise<boolean> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/merchants?id=eq.${encodeURIComponent(merchantId)}`,
      {
        method: 'DELETE',
        headers: this.headers,
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Error eliminando comercio ${merchantId} (${res.status}): ${errText}`,
      );
    }

    return true;
  }

  // -------------------------------------------------------------
  // IBillingInvoicesRepository (Ticket 22)
  // -------------------------------------------------------------

  async findMerchantByBillingPhone(normalizedPhone: string): Promise<Merchant | null> {
    const clean = normalizedPhone.trim();
    const noPlus = clean.replace(/^\+/, '');
    const last10 = clean.slice(-10);

    const res = await fetch(
      `${this.baseUrl}/rest/v1/merchants?or=(billing_phone.eq.${encodeURIComponent(clean)},billing_phone.eq.${encodeURIComponent(noPlus)},billing_phone.ilike.*${encodeURIComponent(last10)})&select=*&limit=1`,
      { headers: this.headers },
    );
    if (res.ok) {
      const rows = (await res.json()) as any[];
      if (rows && rows.length > 0) {
        const { ownerId: _ownerId, ...merchant } = this.mapMerchantRow(rows[0]);
        return merchant;
      }
    }

    // Fallback: Si el celular remitente no está configurado en `billing_phone` del comercio,
    // buscar si coincide con el teléfono de algún cajero o dueño registrado en `cashier_recipients`
    const cashierRes = await fetch(
      `${this.baseUrl}/rest/v1/cashier_recipients?or=(phone_number.eq.${encodeURIComponent(clean)},phone_number.eq.${encodeURIComponent(noPlus)},phone_number.ilike.*${encodeURIComponent(last10)})&select=merchant_id&limit=1`,
      { headers: this.headers },
    );
    if (cashierRes.ok) {
      const cRows = (await cashierRes.json()) as any[];
      if (cRows && cRows.length > 0 && cRows[0].merchant_id) {
        return this.findMerchantById(cRows[0].merchant_id);
      }
    }

    return null;
  }

  async findMerchantBySenderName(senderName: string): Promise<Merchant | null> {
    if (!senderName || senderName.trim().length < 3) return null;
    const clean = senderName.trim().toUpperCase();

    // 1. Buscar en cashier_recipients por coincidencia de nombre de cajero o dueño
    const cashierRes = await fetch(
      `${this.baseUrl}/rest/v1/cashier_recipients?select=merchant_id,name`,
      { headers: this.headers },
    );
    if (cashierRes.ok) {
      const cRows = (await cashierRes.json()) as any[];
      if (Array.isArray(cRows)) {
        for (const row of cRows) {
          const cName = (row.name || '').trim().toUpperCase();
          if (cName.length >= 3 && (clean.includes(cName) || cName.includes(clean))) {
            return this.findMerchantById(row.merchant_id);
          }
        }
      }
    }

    // 2. Buscar en merchants por coincidencia con el nombre del comercio
    const merchantRes = await fetch(
      `${this.baseUrl}/rest/v1/merchants?select=*`,
      { headers: this.headers },
    );
    if (merchantRes.ok) {
      const mRows = (await merchantRes.json()) as any[];
      if (Array.isArray(mRows)) {
        for (const row of mRows) {
          const mName = (row.name || '').trim().toUpperCase();
          if (mName.length >= 3 && (clean.includes(mName) || mName.includes(clean))) {
            const { ownerId: _ownerId, ...merchant } = this.mapMerchantRow(row);
            return merchant;
          }
        }
      }
    }

    return null;
  }

  async findMerchantById(merchantId: string): Promise<Merchant | null> {
    const row = await this.getMerchantById(merchantId);
    if (!row) return null;
    const { ownerId: _ownerId, ...merchant } = this.mapMerchantRow(row);
    return merchant;
  }

  async findInvoiceByReference(referenceCode: string): Promise<BillingInvoiceRecord | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/billing_invoices?reference_code=ilike.${encodeURIComponent(referenceCode.trim())}&select=*&limit=1`,
      { headers: this.headers },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;
    return rows[0] as BillingInvoiceRecord;
  }

  async getPendingInvoiceForMerchant(merchantId: string): Promise<BillingInvoiceRecord | null> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/billing_invoices?merchant_id=eq.${encodeURIComponent(merchantId)}&status=eq.PENDING&order=created_at.desc&select=*&limit=1`,
      { headers: this.headers },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows || rows.length === 0) return null;
    return rows[0] as BillingInvoiceRecord;
  }

  async createInvoice(input: CreateBillingInvoiceInput): Promise<BillingInvoiceRecord> {
    const referenceCode = input.referenceCode || generateInvoiceReferenceCode();
    const payload: Record<string, any> = {
      merchant_id: input.merchantId,
      amount_cop: input.amountCop ?? 50_000,
      reference_code: referenceCode,
      status: input.status ?? 'PENDING',
      notification_id: input.notificationId ?? null,
      paid_at: input.paidAt ?? null,
      expires_at: input.expiresAt ?? new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
    if (input.itemType) payload.item_type = input.itemType;
    if (input.itemDescription) payload.item_description = input.itemDescription;
    if (input.payerName) payload.payer_name = input.payerName;
    if (input.payerPhone) payload.payer_phone = input.payerPhone;

    let res = await fetch(`${this.baseUrl}/rest/v1/billing_invoices`, {
      method: 'POST',
      headers: {
        ...this.headers,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });

    // Fallback si columnas opcionales adicionales no existen en el esquema cache
    if (res.status === 400 && (payload.payer_name || payload.payer_phone || payload.item_type)) {
      delete payload.payer_name;
      delete payload.payer_phone;
      delete payload.item_type;
      delete payload.item_description;
      res = await fetch(`${this.baseUrl}/rest/v1/billing_invoices`, {
        method: 'POST',
        headers: {
          ...this.headers,
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Error creando factura comercial (${res.status}): ${err}`);
    }

    const rows = (await res.json()) as any[];
    return rows[0] as BillingInvoiceRecord;
  }

  async markInvoicePaid(
    invoiceId: string,
    notificationId: string,
    paidAtMs: number = Date.now(),
  ): Promise<BillingInvoiceRecord> {
    const res = await fetch(
      `${this.baseUrl}/rest/v1/billing_invoices?id=eq.${encodeURIComponent(invoiceId)}`,
      {
        method: 'PATCH',
        headers: {
          ...this.headers,
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          status: 'PAID',
          notification_id: notificationId,
          paid_at: new Date(paidAtMs).toISOString(),
          updated_at: new Date(paidAtMs).toISOString(),
        }),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Error marcando factura pagada (${res.status}): ${err}`);
    }

    const rows = (await res.json()) as any[];
    return rows[0] as BillingInvoiceRecord;
  }

  async updateInvoiceStatusByReference(
    referenceCode: string,
    status: string = 'PAID',
    paidAtMs: number = Date.now(),
  ): Promise<BillingInvoiceRecord | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/rest/v1/billing_invoices?reference_code=ilike.${encodeURIComponent(referenceCode.trim())}`,
        {
          method: 'PATCH',
          headers: {
            ...this.headers,
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            status,
            paid_at: new Date(paidAtMs).toISOString(),
            updated_at: new Date(paidAtMs).toISOString(),
          }),
        },
      );
      if (!res.ok) return null;
      const rows = (await res.json()) as any[];
      return rows && rows.length > 0 ? (rows[0] as BillingInvoiceRecord) : null;
    } catch {
      return null;
    }
  }

  async extendMerchantSubscription(
    merchantId: string,
    days: number = 30,
    nowMs: number = Date.now(),
    planId?: string,
  ): Promise<{ previousEndsAt: string | null; newEndsAt: string; daysRemaining: number }> {
    const merchant = await this.getMerchantById(merchantId);
    if (!merchant) {
      throw new Error(`Comercio con ID ${merchantId} no encontrado para renovación.`);
    }

    const currentEndsAtMs = resolveSubscriptionEndsAt({
      subscriptionEndsAt: merchant.subscription_ends_at
        ? new Date(merchant.subscription_ends_at).getTime()
        : null,
      subscriptionExpiresAt: merchant.subscription_expires_at
        ? new Date(merchant.subscription_expires_at).getTime()
        : null,
    });

    const baseMs = currentEndsAtMs && currentEndsAtMs > nowMs ? currentEndsAtMs : nowMs;
    const endsAtMs = baseMs + days * 86_400_000;
    const iso = new Date(endsAtMs).toISOString();

    const updatePayload: Record<string, any> = {
      subscription_status: 'ACTIVE',
      subscription_ends_at: iso,
      subscription_expires_at: iso,
      status: 'ACTIVE',
      updated_at: new Date(nowMs).toISOString(),
    };

    if (planId) {
      updatePayload.plan_id = planId;
    }

    await this.updateMerchantSubscription(merchantId, updatePayload);

    const daysRemaining = Math.max(1, Math.ceil((endsAtMs - nowMs) / 86_400_000));

    return {
      previousEndsAt: currentEndsAtMs ? new Date(currentEndsAtMs).toISOString() : null,
      newEndsAt: iso,
      daysRemaining,
    };
  }

  async applyAddonPurchase(
    merchantId: string,
    addonType: 'addon_alerts' | 'addon_cashier',
    amountCop: number,
    notificationId?: string,
    nowMs: number = Date.now(),
  ): Promise<{ extraAlerts: number; extraCashiers: number }> {
    const merchant = await this.getMerchantById(merchantId);
    if (!merchant) {
      throw new Error(`Comercio con ID ${merchantId} no encontrado para aplicar add-on.`);
    }

    let extraAlertsDelta = 0;
    let extraCashiersDelta = 0;

    if (addonType === 'addon_alerts') {
      extraAlertsDelta = 1000;
    } else if (addonType === 'addon_cashier') {
      extraCashiersDelta = 1;
      extraAlertsDelta = 1200;
    }

    const currentExtraAlerts = (merchant as any).extra_alerts_quota || 0;
    const currentExtraCashiers = (merchant as any).extra_cashiers_quota || 0;
    const newExtraAlerts = currentExtraAlerts + extraAlertsDelta;
    const newExtraCashiers = currentExtraCashiers + extraCashiersDelta;

    const updatePayload: Record<string, any> = {
      extra_alerts_quota: newExtraAlerts,
      extra_cashiers_quota: newExtraCashiers,
      updated_at: new Date(nowMs).toISOString(),
    };

    if ((merchant as any).whatsapp_quota_status === 'paused_100') {
      updatePayload.whatsapp_quota_status = 'normal';
      updatePayload.whatsapp_paused_at = null;
    }

    await this.updateMerchantSubscription(merchantId, updatePayload);

    // Registro de auditoría opcional en merchant_addons si existe la tabla
    try {
      await fetch(`${this.baseUrl}/rest/v1/merchant_addons`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          merchant_id: merchantId,
          addon_type: addonType === 'addon_alerts' ? 'extra_alerts_1000' : 'extra_cashier_1',
          price_cop: amountCop,
          status: 'active',
          extra_alerts: extraAlertsDelta,
          extra_cashiers: extraCashiersDelta,
          notification_id: notificationId || null,
        }),
      });
    } catch {
      // Ignorar si el endpoint REST no está activo
    }

    return {
      extraAlerts: newExtraAlerts,
      extraCashiers: newExtraCashiers,
    };
  }
}
