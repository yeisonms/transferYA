import { createHash } from 'node:crypto';
import type { ParsedPaymentReceipt } from '../parser/types.js';
import type {
  FingerprintSource,
  IPaymentFingerprintRepository,
  PaymentFingerprintRecord,
  RegisterFingerprintResult,
} from './types.js';

/**
 * Normaliza agresivamente el nombre del remitente para hacerlo resistente
 * a variaciones ortográficas, diacríticos (tildes, eñes), mayúsculas/minúsculas
 * y espaciado redundante.
 */
export function normalizeSenderForFingerprint(name: string): string {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('El nombre de remitente no puede estar vacio');
  }

  return (
    name
      .trim()
      .toLowerCase()
      // Descomponer diacríticos (ej. é -> e + \u0301, ñ -> n + \u0303)
      .normalize('NFD')
      // Eliminar marcas de acentuación diacríticas
      .replace(/[\u0300-\u036f]/g, '')
      // Reemplazar guiones, barras o separadores de palabras con espacio
      .replace(/[-_/]/g, ' ')
      // Eliminar comillas y apóstrofes (ej. D'Angelo -> dangelo)
      .replace(/['"’`]/g, '')
      // Reemplazar cualquier caracter que no sea alfanumérico ASCII por espacio
      .replace(/[^a-z0-9\s]/g, ' ')
      // Colapsar espacios múltiples y recortar extremos
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Genera la Huella de Idempotencia determinista (SHA-256) para una transferencia P2P.
 *
 * Agrupa la transacción en una ventana temporal (time-bucket) de N minutos
 * para tolerar retrasos de red y ráfagas push/SMS de la misma transferencia.
 */
export function generatePaymentFingerprint(
  receipt: ParsedPaymentReceipt | FingerprintSource,
  captureTimestamp: number,
  windowBucketMinutes = 5,
): string {
  if (
    typeof receipt.amount !== 'number' ||
    Number.isNaN(receipt.amount) ||
    receipt.amount <= 0 ||
    !Number.isInteger(receipt.amount)
  ) {
    throw new Error(
      'El monto debe ser un entero positivo en pesos colombianos (COP)',
    );
  }

  if (
    typeof captureTimestamp !== 'number' ||
    Number.isNaN(captureTimestamp) ||
    captureTimestamp < 0
  ) {
    throw new Error('Timestamp de captura invalido');
  }

  if (
    typeof windowBucketMinutes !== 'number' ||
    Number.isNaN(windowBucketMinutes) ||
    windowBucketMinutes <= 0
  ) {
    throw new Error('Ventana de tiempo invalida');
  }

  const normalizedSender = normalizeSenderForFingerprint(receipt.senderName);
  const bucketMs = windowBucketMinutes * 60 * 1000;
  const bucketIndex = Math.floor(captureTimestamp / bucketMs);

  const canonicalString = `${receipt.wallet.toUpperCase()}|${receipt.amount}|${normalizedSender}|${bucketIndex}`;

  return createHash('sha256').update(canonicalString, 'utf-8').digest('hex');
}

/**
 * Determina si una referencia corresponde a un identificador único de transacción emitido por la entidad bancaria
 * (ej. "M1234567" de Nequi o número de comprobante único), o si por el contrario es un identificador de cuenta/destino
 * (ej. máscara de cuenta "*1082", o llave Bre-B "3113278414", "@usuario") o un prefijo sintético del sistema ("BREB-", "TRF-").
 *
 * Los identificadores de cuenta y llaves NUNCA deben utilizarse como identificador único de transacción
 * porque provocarían colisiones masivas entre pagos distintos recibidos en la misma cuenta.
 */
export function isUniqueBankTransactionReference(ref?: string | null): boolean {
  if (!ref || typeof ref !== 'string') return false;
  const clean = ref.trim().toUpperCase();
  if (!clean) return false;

  // Prefijos sintéticos generados internamente por TransferYA
  if (clean.startsWith('BREB-') || clean.startsWith('TRF-')) return false;

  // Máscaras de cuentas bancarias (ej. *1082, *5871)
  if (clean.startsWith('*')) return false;

  // Llaves de Bre-B numéricas o telefónicas (ej. 3113278414, 0079127304)
  if (/^[0-9]{8,15}$/.test(clean)) return false;

  // Llaves de Bre-B alfanuméricas con @ (ej. @jefferson0769)
  if (clean.startsWith('@')) return false;

  // Longitud mínima para un comprobante bancario real
  return clean.length >= 5;
}

/**
 * Genera la Huella Canónica Multicanal para arquitecturas híbridas (Centinela Push + Inbound Email).
 *
 * 1. Si el comprobante cuenta con una Referencia Bancaria explícita y única (ej. "Ref: M123456" de Nequi),
 *    la huella se basa exclusivamente en la billetera y la referencia. Esto garantiza que
 *    el Push (T=0s) y el Correo (T=15s) generen EXACTAMENTE la misma huella determinista,
 *    independiente de variaciones en el timestamp o milisegundos.
 *
 * 2. Si el comprobante NO incluye referencia bancaria única (ej. notificaciones cortas, DaviPlata básico,
 *    o transferencias de Bancolombia que solo traen máscara de cuenta "*1082"),
 *    delega en `generatePaymentFingerprint` utilizando un time-bucket de 10 minutos para
 *    absorber retrasos entre la red celular y el encolado de correos sin provocar colisiones permanentes por cuenta.
 */
export function generateCanonicalPaymentFingerprint(
  receipt: ParsedPaymentReceipt | FingerprintSource,
  captureTimestamp: number,
  windowBucketMinutes = 10,
): string {
  if (
    'reference' in receipt &&
    receipt.reference &&
    isUniqueBankTransactionReference(receipt.reference)
  ) {
    const cleanRef = receipt.reference.trim().toUpperCase();
    const canonical = `${receipt.wallet.toUpperCase()}|REF:${cleanRef}`;
    return createHash('sha256').update(canonical, 'utf-8').digest('hex');
  }

  return generatePaymentFingerprint(
    receipt,
    captureTimestamp,
    windowBucketMinutes,
  );
}

/**
 * Implementación en memoria del repositorio de huellas para tests unitarios y decoupling de dominio.
 * Aplica la restricción de unicidad lógica:
 * - A nivel dispositivo: UNIQUE (deviceId, fingerprint)
 * - A nivel comercio multicanal (si merchantId está presente): UNIQUE (merchantId, fingerprint)
 */
export class InMemoryPaymentFingerprintRepository
  implements IPaymentFingerprintRepository
{
  private records = new Map<string, PaymentFingerprintRecord>();
  private recordsByMerchant = new Map<string, PaymentFingerprintRecord>();

  async registerFingerprint(
    record: PaymentFingerprintRecord,
  ): Promise<RegisterFingerprintResult> {
    // Si viene merchantId, evaluamos unicidad por comercio (multicanal híbrido)
    if (record.merchantId) {
      const merchantKey = `${record.merchantId}:${record.fingerprint}`;
      const existingByMerchant = this.recordsByMerchant.get(merchantKey);
      if (existingByMerchant) {
        return {
          isDuplicate: true,
          existingRecord: existingByMerchant,
        };
      }
    }

    const deviceKey = `${record.deviceId}:${record.fingerprint}`;
    const existing = this.records.get(deviceKey);

    if (existing) {
      return {
        isDuplicate: true,
        existingRecord: existing,
      };
    }

    const stored: PaymentFingerprintRecord = {
      ...record,
      id: record.id ?? `fp_${Math.random().toString(36).substring(2, 11)}`,
      createdAt: record.createdAt ?? Date.now(),
    };

    this.records.set(deviceKey, stored);
    if (record.merchantId) {
      this.recordsByMerchant.set(
        `${record.merchantId}:${record.fingerprint}`,
        stored,
      );
    }

    return {
      isDuplicate: false,
    };
  }

  async findByFingerprint(
    deviceId: string,
    fingerprint: string,
  ): Promise<PaymentFingerprintRecord | null> {
    const key = `${deviceId}:${fingerprint}`;
    return this.records.get(key) ?? null;
  }

  async findByMerchantFingerprint(
    merchantId: string,
    fingerprint: string,
  ): Promise<PaymentFingerprintRecord | null> {
    const key = `${merchantId}:${fingerprint}`;
    return this.recordsByMerchant.get(key) ?? null;
  }
}
