import type { ParsedPaymentReceipt, SupportedWallet } from '../parser/types.js';

/**
 * Datos mínimos requeridos para calcular la Huella de Idempotencia de una transferencia.
 */
export interface FingerprintSource {
  wallet: SupportedWallet;
  amount: number;
  senderName: string;
}

/**
 * Registro de persistencia de una huella de pago en base de datos (PostgreSQL/Supabase).
 * Restricción de base de datos: UNIQUE (device_id, fingerprint).
 */
export interface PaymentFingerprintRecord {
  id?: string;
  deviceId: string;
  fingerprint: string;
  wallet: SupportedWallet;
  amount: number;
  senderName: string;
  capturedAt: number;
  createdAt?: number;
}

/**
 * Resultado de la operación de registro atómico de huella.
 */
export interface RegisterFingerprintResult {
  isDuplicate: boolean;
  existingRecord?: PaymentFingerprintRecord;
}

/**
 * Repositorio de base de datos para registrar y deduplicar huellas de transferencias P2P.
 */
export interface IPaymentFingerprintRepository {
  /**
   * Intenta registrar atómicamente una huella de pago para un dispositivo específico.
   * Si ya existe un registro con la misma huella para ese deviceId, retorna `isDuplicate: true`.
   * Si es la primera vez que se observa, lo almacena y retorna `isDuplicate: false`.
   */
  registerFingerprint(
    record: PaymentFingerprintRecord,
  ): Promise<RegisterFingerprintResult>;

  /**
   * Consulta si existe una huella previamente registrada para un dispositivo.
   */
  findByFingerprint(
    deviceId: string,
    fingerprint: string,
  ): Promise<PaymentFingerprintRecord | null>;
}

