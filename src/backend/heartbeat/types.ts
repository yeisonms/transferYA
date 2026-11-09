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

export interface IDeviceHealthRepository {
  upsertDeviceHeartbeat(record: DeviceHealthRecord): Promise<void>;
  getDeviceHealth(deviceId: string): Promise<DeviceHealthRecord | null>;
  findOfflineDevices(
    inactivityThresholdMs: number,
    now: number,
  ): Promise<DeviceHealthRecord[]>;
}

