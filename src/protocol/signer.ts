import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type {
  CanonicalRequestParams,
  CapturedNotificationPayload,
  VerificationOptions,
  VerificationResult,
} from './types.js';

/**
 * Calcula el hash SHA-256 en formato hexadecimal de una cadena UTF-8.
 */
export function computeSha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Construye la representación canónica del request para firma/verificación.
 * Formato: METHOD|PATH|TIMESTAMP|NONCE|BODY_SHA256
 */
export function buildCanonicalString(params: CanonicalRequestParams): string {
  const method = params.method.toUpperCase();
  const path = params.path;
  const timestamp = String(params.timestamp);
  const nonce = params.nonce;

  const bodyStr =
    typeof params.body === 'string'
      ? params.body
      : JSON.stringify(params.body);

  const bodyHash = computeSha256(bodyStr);

  return `${method}|${path}|${timestamp}|${nonce}|${bodyHash}`;
}

/**
 * Genera la firma criptográfica HMAC-SHA256 sobre la cadena canónica.
 */
export function computeHmacSignature(
  secret: string,
  canonicalString: string,
): string {
  return createHmac('sha256', secret)
    .update(canonicalString, 'utf8')
    .digest('hex');
}

/**
 * Verifica la autenticidad, frescura e integridad de una petición al Webhook.
 * Aplica validación temporal (ADR-0002) y detección de Stale Alerts (ADR-0001).
 */
export function verifyWebhookRequest(
  headers: Record<string, string | undefined>,
  body: string | object,
  secret: string,
  options?: VerificationOptions,
): VerificationResult {
  // 1. Normalizar cabeceras (case-insensitive)
  const normalizedHeaders: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalizedHeaders[k.toLowerCase()] = v;
  }

  const deviceId = normalizedHeaders['x-device-id'];
  const timestampHeader = normalizedHeaders['x-timestamp'];
  const nonce = normalizedHeaders['x-nonce'];
  const signature = normalizedHeaders['x-signature'];

  if (!deviceId || !timestampHeader || !nonce || !signature) {
    return {
      success: false,
      error: 'MISSING_HEADERS',
      details:
        'Faltan una o más cabeceras obligatorias: x-device-id, x-timestamp, x-nonce, x-signature',
    };
  }

  const reqTimestamp = Number(timestampHeader);
  if (Number.isNaN(reqTimestamp)) {
    return {
      success: false,
      error: 'TIMESTAMP_DRIFT_EXCEEDED',
      details: 'x-timestamp no es un número válido',
    };
  }

  // 2. Validar ventana temporal (drift <= 30s según ADR-0002)
  const now = options?.currentTimeMs ?? Date.now();
  const maxDrift = options?.maxTimestampDriftMs ?? 30000;
  const drift = now - reqTimestamp;

  if (drift > maxDrift) {
    return {
      success: false,
      error: 'TIMESTAMP_DRIFT_EXCEEDED',
      details: `Petición expirada: desfase de ${drift}ms excede el máximo permitido de ${maxDrift}ms`,
    };
  }

  if (drift < -maxDrift) {
    return {
      success: false,
      error: 'TIMESTAMP_DRIFT_EXCEEDED',
      details: `Petición en el futuro: desfase de ${Math.abs(drift)}ms excede el máximo permitido de ${maxDrift}ms`,
    };
  }

  // 3. Reconstruir cadena canónica y validar firma
  const canonical = buildCanonicalString({
    method: options?.method ?? 'POST',
    path: options?.path ?? '/api/v1/webhooks/notifications',
    timestamp: timestampHeader,
    nonce,
    body,
  });

  const expectedSignature = computeHmacSignature(secret, canonical);

  // Comparación en tiempo constante para evitar Timing Attacks
  let isSignatureValid = false;
  try {
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      sigBuffer.length === expectedBuffer.length &&
      sigBuffer.length > 0 &&
      timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      isSignatureValid = true;
    }
  } catch {
    isSignatureValid = false;
  }

  if (!isSignatureValid) {
    return {
      success: false,
      error: 'INVALID_SIGNATURE',
      details: 'La firma HMAC provista no coincide con el cálculo del servidor',
    };
  }

  // 4. Calcular latencia y detección de Stale Alert (ADR-0001)
  let capturedAt = reqTimestamp;
  if (typeof body === 'object' && body !== null && 'captured_at' in body) {
    const payload = body as CapturedNotificationPayload;
    if (typeof payload.captured_at === 'number') {
      capturedAt = payload.captured_at;
    }
  } else if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed.captured_at === 'number') {
        capturedAt = parsed.captured_at;
      }
    } catch {
      // Ignorar si no es parseable como JSON
    }
  }

  const latencyMs = now - capturedAt;
  const isStale = latencyMs > 90000;

  return {
    success: true,
    isStale,
    latencyMs,
  };
}
