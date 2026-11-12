import type { SubscriptionStatus } from '../../domain/routing/types.js';

/**
 * Tipos de estado de salud del Dispositivo Centinela (ADR-0003).
 */
export type DeviceHealthStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE';

export interface HeartbeatPayload {
  device_id: string;
  battery_level: number; // 0 - 100
  is_charging: boolean;
  network_type: 'WIFI' | 'CELLULAR';
  app_version: string;
  sent_at: number; // Unix epoch ms
}

export interface DeviceHealthRecord {
  deviceId: string;
  lastSeenAt: number;
  batteryLevel: number;
  isCharging: boolean;
  networkType: 'WIFI' | 'CELLULAR';
  appVersion: string;
  status: DeviceHealthStatus;
}

export interface HeartbeatBillingConfig {
  qrPayload?: string;
  planAmountCop?: number;
}

export interface HeartbeatResponseBody {
  success: boolean;
  message: string;
  subscription_status?: SubscriptionStatus;
  subscription_ends_at?: string | null;
  subscription_ends_at_ms?: number | null;
  remaining_days?: number;
  billing_qr_payload?: string;
  billing_amount_cop?: number;
}

export interface IDeviceHealthRepository {
  upsertDeviceHeartbeat(record: DeviceHealthRecord): Promise<void>;
  getDeviceHealth(deviceId: string): Promise<DeviceHealthRecord | null>;
  findOfflineDevices(
    inactivityThresholdMs: number,
    now: number,
  ): Promise<DeviceHealthRecord[]>;
}

