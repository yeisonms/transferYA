import { describe, it, expect } from 'vitest';
import { buildCanonicalString, computeHmacSignature, verifyWebhookRequest, } from '../signer.js';
describe('Protocolo Criptográfico de Ingesta (ADR-0002)', () => {
    const mockSecret = 'super-secure-device-secret-key-12345';
    const mockDeviceId = 'centinela-device-bog-001';
    const fixedNow = 1700000000000; // Timestamp base de prueba
    const validNonce = 'd3b07384-d113-4682-a7f4-b2ef3a6b8256';
    const samplePayload = {
        device_id: mockDeviceId,
        wallet_package: 'com.nequi.MobileApp',
        raw_title: 'Nequi',
        raw_text: 'Te transfirieron $50.000 de Pepito Pérez (Saldo: $150.000)',
        captured_at: fixedNow - 5000, // Hace 5 segundos
        dispatched_at: fixedNow - 1000, // Hace 1 segundo
        amount: 50000,
        sender_name: 'Pepito Pérez',
    };
    describe('1. Canonicalización del String para Firma', () => {
        it('debe construir la cadena canónica con formato: METHOD|PATH|TIMESTAMP|NONCE|BODY_SHA256', () => {
            // SHA-256 real de '{"test":true}' es "6fd977db9b2afe87a9ceee48432881299a6aaf83d935fbbe83007660287f9c2e"
            const params = {
                method: 'post',
                path: '/api/v1/webhooks/notifications',
                timestamp: fixedNow,
                nonce: validNonce,
                body: '{"test":true}',
            };
            const canonical = buildCanonicalString(params);
            expect(canonical).toBe(`POST|/api/v1/webhooks/notifications|${fixedNow}|${validNonce}|6fd977db9b2afe87a9ceee48432881299a6aaf83d935fbbe83007660287f9c2e`);
        });
        it('debe generar el mismo hash de body independientemente del formato si es objeto', () => {
            const canonicalFromObj = buildCanonicalString({
                method: 'POST',
                path: '/api/v1/webhooks/notifications',
                timestamp: fixedNow,
                nonce: validNonce,
                body: samplePayload,
            });
            const canonicalFromStr = buildCanonicalString({
                method: 'POST',
                path: '/api/v1/webhooks/notifications',
                timestamp: fixedNow,
                nonce: validNonce,
                body: JSON.stringify(samplePayload),
            });
            expect(canonicalFromObj).toBe(canonicalFromStr);
        });
    });
    describe('2. Validación de Ventana Temporal (Timestamp Drift <= 30s)', () => {
        it('debe rechazar peticiones con timestamp en el pasado mayor a 30 segundos (30.001 ms)', () => {
            const expiredTimestamp = fixedNow - 30001;
            const headers = {
                'x-device-id': mockDeviceId,
                'x-timestamp': expiredTimestamp.toString(),
                'x-nonce': validNonce,
                'x-signature': 'dummy-signature',
            };
            const result = verifyWebhookRequest(headers, samplePayload, mockSecret, {
                currentTimeMs: fixedNow,
            });
            expect(result).toEqual({
                success: false,
                error: 'TIMESTAMP_DRIFT_EXCEEDED',
                details: expect.stringContaining('30001ms'),
            });
        });
        it('debe rechazar peticiones con timestamp en el futuro mayor a 30 segundos', () => {
            const futureTimestamp = fixedNow + 30001;
            const headers = {
                'x-device-id': mockDeviceId,
                'x-timestamp': futureTimestamp.toString(),
                'x-nonce': validNonce,
                'x-signature': 'dummy-signature',
            };
            const result = verifyWebhookRequest(headers, samplePayload, mockSecret, {
                currentTimeMs: fixedNow,
            });
            expect(result).toEqual({
                success: false,
                error: 'TIMESTAMP_DRIFT_EXCEEDED',
                details: expect.stringContaining('en el futuro'),
            });
        });
        it('debe rechazar peticiones con cabeceras requeridas faltantes', () => {
            const incompleteHeaders = {
                'x-device-id': mockDeviceId,
                // Falta x-timestamp, x-nonce y x-signature
            };
            const result = verifyWebhookRequest(incompleteHeaders, samplePayload, mockSecret);
            expect(result).toEqual({
                success: false,
                error: 'MISSING_HEADERS',
                details: expect.any(String),
            });
        });
    });
    describe('3. Verificación Criptográfica HMAC-SHA256 (Anti-Spoofing)', () => {
        it('debe rechazar firmas HMAC inválidas cuando se usa una clave incorrecta', () => {
            const timestamp = fixedNow - 1000;
            const canonical = buildCanonicalString({
                method: 'POST',
                path: '/api/v1/webhooks/notifications',
                timestamp,
                nonce: validNonce,
                body: samplePayload,
            });
            // Firmado con clave de atacante
            const attackerSignature = computeHmacSignature('wrong-attacker-secret', canonical);
            const headers = {
                'x-device-id': mockDeviceId,
                'x-timestamp': timestamp.toString(),
                'x-nonce': validNonce,
                'x-signature': attackerSignature,
            };
            const result = verifyWebhookRequest(headers, samplePayload, mockSecret, {
                currentTimeMs: fixedNow,
            });
            expect(result).toEqual({
                success: false,
                error: 'INVALID_SIGNATURE',
                details: expect.any(String),
            });
        });
        it('debe rechazar firmas si el payload fue alterado en tránsito (MITM)', () => {
            const timestamp = fixedNow - 1000;
            const canonical = buildCanonicalString({
                method: 'POST',
                path: '/api/v1/webhooks/notifications',
                timestamp,
                nonce: validNonce,
                body: samplePayload,
            });
            // Firma legítima calculada sobre samplePayload
            const legitimateSignature = computeHmacSignature(mockSecret, canonical);
            // El payload recibido en el backend fue alterado por un MITM (cambio de monto)
            const tamperedPayload = {
                ...samplePayload,
                amount: 500000,
                raw_text: 'Te transfirieron $500.000 de Pepito Pérez (Saldo: $150.000)',
            };
            const headers = {
                'x-device-id': mockDeviceId,
                'x-timestamp': timestamp.toString(),
                'x-nonce': validNonce,
                'x-signature': legitimateSignature,
            };
            const result = verifyWebhookRequest(headers, tamperedPayload, mockSecret, {
                currentTimeMs: fixedNow,
            });
            expect(result).toEqual({
                success: false,
                error: 'INVALID_SIGNATURE',
                details: expect.any(String),
            });
        });
        it('debe aceptar peticiones con firma válida, nonce fresco y timestamp dentro de ventana', () => {
            const timestamp = fixedNow - 2000; // 2 segundos en el pasado
            const canonical = buildCanonicalString({
                method: 'POST',
                path: '/api/v1/webhooks/notifications',
                timestamp,
                nonce: validNonce,
                body: samplePayload,
            });
            const validSignature = computeHmacSignature(mockSecret, canonical);
            const headers = {
                'x-device-id': mockDeviceId,
                'x-timestamp': timestamp.toString(),
                'x-nonce': validNonce,
                'x-signature': validSignature,
            };
            const result = verifyWebhookRequest(headers, samplePayload, mockSecret, {
                currentTimeMs: fixedNow,
            });
            expect(result).toEqual({
                success: true,
                isStale: false,
                latencyMs: 5000, // fixedNow - samplePayload.captured_at
            });
        });
        it('debe marcar isStale = true si captured_at tiene más de 90 segundos de desfase (ADR-0001)', () => {
            const timestamp = fixedNow - 1000;
            const stalePayload = {
                ...samplePayload,
                captured_at: fixedNow - 95000, // 95 segundos en el pasado
            };
            const canonical = buildCanonicalString({
                method: 'POST',
                path: '/api/v1/webhooks/notifications',
                timestamp,
                nonce: validNonce,
                body: stalePayload,
            });
            const validSignature = computeHmacSignature(mockSecret, canonical);
            const headers = {
                'x-device-id': mockDeviceId,
                'x-timestamp': timestamp.toString(),
                'x-nonce': validNonce,
                'x-signature': validSignature,
            };
            const result = verifyWebhookRequest(headers, stalePayload, mockSecret, {
                currentTimeMs: fixedNow,
            });
            expect(result).toEqual({
                success: true,
                isStale: true,
                latencyMs: 95000,
            });
        });
    });
});
