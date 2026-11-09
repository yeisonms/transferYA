import type { CapturedNotificationPayload } from '../../protocol/types.js';

/**
 * Contrato para el almacenamiento en base de datos (PostgreSQL / Supabase)
 * de las notificaciones capturadas por los Centinelas.
 */
export interface StoredNotificationRecord {
  id?: string;
  deviceId: string;
  walletPackage: string;
  rawTitle: string;
  rawText: string;
  capturedAt: number;
  dispatchedAt: number;
  receivedAt: number;
  latencyMs: number;
  isStale: boolean;
  status:
    | 'RECEIVED'
    | 'PROCESSING'
    | 'PROCESSED'
    | 'IGNORED_NON_PAYMENT'
    | 'DUPLICATE_PAYMENT'
    | 'ROUTING_FAILED'
    | 'DISPATCH_FAILED'
    | 'FAILED';
  amount?: number | null;
  senderName?: string | null;
  paymentReference?: string | null;
}

/**
 * Repositorio de base de datos para auditoría y persistencia de eventos de pago.
 */
export interface INotificationRepository {
  saveReceivedNotification(
    record: StoredNotificationRecord,
  ): Promise<{ id: string }>;
}

/**
 * Repositorio para la consulta y autenticación de Dispositivos Centinela.
 */
export interface IDeviceRepository {
  getDeviceSecret(deviceId: string): Promise<string | null>;
}

/**
 * Caché efímera / motor de sincronización para deduplicación atómica de nonces (Anti-Replay).
 */
export interface INonceCache {
  /**
   * Intenta adquirir un nonce de forma atómica para un dispositivo con un TTL en segundos.
   * Retorna `true` si el nonce era nuevo y fue registrado exitosamente.
   * Retorna `false` si el nonce ya existía en la ventana activa (ataque Replay o colisión).
   */
  acquireNonce(
    deviceId: string,
    nonce: string,
    ttlSeconds: number,
  ): Promise<boolean>;
}

export interface WebhookHandlerDependencies {
  deviceRepository: IDeviceRepository;
  nonceCache: INonceCache;
  notificationRepository: INotificationRepository;
  nowProvider?: () => number;
}

/**
 * Abstracción de petición HTTP desacoplada de cualquier framework (Express, Fastify, Next.js, Edge).
 */
export interface HttpRequest {
  headers: Record<string, string | undefined>;
  body: unknown;
  method?: string;
  path?: string;
}

/**
 * Abstracción de respuesta HTTP estándar.
 */
export interface HttpResponse {
  statusCode: number;
  body: {
    success: boolean;
    message?: string;
    data?: unknown;
    error?: string;
    details?: string;
  };
}

