import { createHash } from 'node:crypto';
/**
 * Normaliza agresivamente el nombre del remitente para hacerlo resistente
 * a variaciones ortográficas, diacríticos (tildes, eñes), mayúsculas/minúsculas
 * y espaciado redundante.
 */
export function normalizeSenderForFingerprint(name) {
    if (!name || typeof name !== 'string' || !name.trim()) {
        throw new Error('El nombre de remitente no puede estar vacio');
    }
    return (name
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
        .trim());
}
/**
 * Genera la Huella de Idempotencia determinista (SHA-256) para una transferencia P2P.
 *
 * Agrupa la transacción en una ventana temporal (time-bucket) de N minutos
 * para tolerar retrasos de red y ráfagas push/SMS de la misma transferencia.
 */
export function generatePaymentFingerprint(receipt, captureTimestamp, windowBucketMinutes = 5) {
    if (typeof receipt.amount !== 'number' ||
        Number.isNaN(receipt.amount) ||
        receipt.amount <= 0 ||
        !Number.isInteger(receipt.amount)) {
        throw new Error('El monto debe ser un entero positivo en pesos colombianos (COP)');
    }
    if (typeof captureTimestamp !== 'number' ||
        Number.isNaN(captureTimestamp) ||
        captureTimestamp < 0) {
        throw new Error('Timestamp de captura invalido');
    }
    if (typeof windowBucketMinutes !== 'number' ||
        Number.isNaN(windowBucketMinutes) ||
        windowBucketMinutes <= 0) {
        throw new Error('Ventana de tiempo invalida');
    }
    const normalizedSender = normalizeSenderForFingerprint(receipt.senderName);
    const bucketMs = windowBucketMinutes * 60 * 1000;
    const bucketIndex = Math.floor(captureTimestamp / bucketMs);
    const canonicalString = `${receipt.wallet.toUpperCase()}|${receipt.amount}|${normalizedSender}|${bucketIndex}`;
    return createHash('sha256').update(canonicalString, 'utf-8').digest('hex');
}
/**
 * Genera la Huella Canónica Multicanal para arquitecturas híbridas (Centinela Push + Inbound Email).
 *
 * 1. Si el comprobante cuenta con una Referencia Bancaria explícita (ej. "Ref: M123456" de Nequi),
 *    la huella se basa exclusivamente en la billetera y la referencia. Esto garantiza que
 *    el Push (T=0s) y el Correo (T=15s) generen EXACTAMENTE la misma huella determinista,
 *    independiente de variaciones en el timestamp o milisegundos.
 *
 * 2. Si el comprobante NO incluye referencia bancaria (ej. notificaciones cortas o DaviPlata básico),
 *    delega en `generatePaymentFingerprint` utilizando un time-bucket de 10 minutos para
 *    absorber retrasos entre la red celular y el encolado de correos.
 */
export function generateCanonicalPaymentFingerprint(receipt, captureTimestamp, windowBucketMinutes = 10) {
    if ('reference' in receipt && receipt.reference && receipt.reference.trim()) {
        const cleanRef = receipt.reference.trim().toUpperCase();
        const canonical = `${receipt.wallet.toUpperCase()}|REF:${cleanRef}`;
        return createHash('sha256').update(canonical, 'utf-8').digest('hex');
    }
    return generatePaymentFingerprint(receipt, captureTimestamp, windowBucketMinutes);
}
/**
 * Implementación en memoria del repositorio de huellas para tests unitarios y decoupling de dominio.
 * Aplica la restricción de unicidad lógica:
 * - A nivel dispositivo: UNIQUE (deviceId, fingerprint)
 * - A nivel comercio multicanal (si merchantId está presente): UNIQUE (merchantId, fingerprint)
 */
export class InMemoryPaymentFingerprintRepository {
    records = new Map();
    recordsByMerchant = new Map();
    async registerFingerprint(record) {
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
        const stored = {
            ...record,
            id: record.id ?? `fp_${Math.random().toString(36).substring(2, 11)}`,
            createdAt: record.createdAt ?? Date.now(),
        };
        this.records.set(deviceKey, stored);
        if (record.merchantId) {
            this.recordsByMerchant.set(`${record.merchantId}:${record.fingerprint}`, stored);
        }
        return {
            isDuplicate: false,
        };
    }
    async findByFingerprint(deviceId, fingerprint) {
        const key = `${deviceId}:${fingerprint}`;
        return this.records.get(key) ?? null;
    }
    async findByMerchantFingerprint(merchantId, fingerprint) {
        const key = `${merchantId}:${fingerprint}`;
        return this.recordsByMerchant.get(key) ?? null;
    }
}
