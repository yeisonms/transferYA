import type { HttpRequest, HttpResponse } from '../webhook/types.js';

/**
 * Registro de base de datos para tokens efímeros de enrolamiento de dispositivos.
 */
export interface EnrollmentTokenRecord {
  token: string;
  merchantId: string;
  deviceId: string;
  label?: string;
  expiresAt: number; // Timestamp epoch ms
  isConsumed: boolean;
  createdAt: number;
}

/**
 * Contrato de repositorio para el ciclo de vida de enrolamiento y secretos de Centinelas.
 */
export interface IEnrollmentRepository {
  /**
   * Almacena un nuevo token efímero de enrolamiento.
   */
  createEnrollmentToken(record: EnrollmentTokenRecord): Promise<void>;

  /**
   * Obtiene la información de un token de enrolamiento.
   */
  getEnrollmentToken(token: string): Promise<EnrollmentTokenRecord | null>;

  /**
   * Marca atómicamente un token como consumido.
   * Retorna `true` si el token estaba activo y se consumió exitosamente.
   * Retorna `false` si ya había sido consumido o no existe.
   */
  consumeEnrollmentToken(token: string): Promise<boolean>;

  /**
   * Registra o actualiza el hash criptográfico del secreto de un dispositivo en la tabla devices.
   */
  registerDeviceSecret(
    deviceId: string,
    merchantId: string,
    secretHash: string,
    label?: string,
  ): Promise<void>;

  /**
   * Marca el estado de un dispositivo como REVOKED, impidiendo autenticación HMAC futura.
   */
  revokeDevice(deviceId: string, merchantId: string): Promise<boolean>;

  /**
   * Consulta el estado actual de un Dispositivo Centinela.
   */
  getDeviceStatus(
    deviceId: string,
  ): Promise<'ACTIVE' | 'REVOKED' | 'NOT_FOUND'>;
}

export interface DeviceEnrollmentHandlerDependencies {
  enrollmentRepository: IEnrollmentRepository;
  nowProvider?: () => number;
  tokenTtlSeconds?: number; // Default: 300 (5 minutos)
  secretGenerator?: () => string; // Default: 32 bytes hex aleatorio
}

