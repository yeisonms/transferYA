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
 * Implementación en memoria del repositorio de huellas para tests unitarios y decoupling de dominio.
 * Aplica la restricción de unicidad lógica: UNIQUE (deviceId, fingerprint).
 */
export class InMemoryPaymentFingerprintRepository {
    records = new Map();
    async registerFingerprint(record) {
        const key = `${record.deviceId}:${record.fingerprint}`;
        const existing = this.records.get(key);
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
        this.records.set(key, stored);
        return {
            isDuplicate: false,
        };
    }
    async findByFingerprint(deviceId, fingerprint) {
        const key = `${deviceId}:${fingerprint}`;
        return this.records.get(key) ?? null;
    }
}
