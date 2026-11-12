import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedPaymentReceipt } from '../../domain/parser/types.js';
import { WhatsAppCloudApiClient } from '../client.js';
import {
  formatCapturedTime,
  formatCopCurrency,
  formatRecipientForMeta,
  formatWalletDisplayName,
} from '../formatter.js';
import type {
  HttpResponseData,
  IHttpClient,
  PaymentAlertOptions,
} from '../types.js';

describe('Cliente de Meta WhatsApp Cloud API para Plantillas de Utilidad (Ticket 11)', () => {
  describe('1. Formateadores de Negocio y Presentación (formatter)', () => {
    it('formatCopCurrency debe formatear números enteros a pesos colombianos con separador de miles', () => {
      expect(formatCopCurrency(50000)).toBe('$ 50.000');
      expect(formatCopCurrency(1250000)).toBe('$ 1.250.000');
      expect(formatCopCurrency(100)).toBe('$ 100');
    });

    it('formatCopCurrency debe rechazar montos no enteros, negativos o cero', () => {
      expect(() => formatCopCurrency(0)).toThrow(/monto debe ser un entero positivo/i);
      expect(() => formatCopCurrency(-5000)).toThrow(/monto debe ser un entero positivo/i);
      expect(() => formatCopCurrency(1500.5)).toThrow(/monto debe ser un entero positivo/i);
    });

    it('formatCapturedTime debe formatear una hora en zona horaria America/Bogota', () => {
      // 2026-05-06T19:30:00Z -> en UTC-5 es 14:30:00
      const utcTime = Date.UTC(2026, 4, 6, 19, 30, 0);
      const formatted = formatCapturedTime(utcTime);
      expect(formatted).toMatch(/^14:30:00$/);
    });

    it('formatWalletDisplayName debe retornar el nombre amigable de la billetera', () => {
      expect(formatWalletDisplayName('NEQUI')).toBe('Nequi');
      expect(formatWalletDisplayName('DAVIPLATA')).toBe('Daviplata');
    });

    it('formatRecipientForMeta debe eliminar el prefijo más (+) y espacios', () => {
      expect(formatRecipientForMeta('+573001234567')).toBe('573001234567');
      expect(formatRecipientForMeta('  +57 300 123-4567  ')).toBe('573001234567');
      expect(formatRecipientForMeta('573001234567')).toBe('573001234567');
    });
  });

  describe('2. Constructor de Payloads y Despacho de Plantillas (WhatsAppCloudApiClient)', () => {
    let mockHttpClient: IHttpClient;
    let client: WhatsAppCloudApiClient;
    let sleepDelays: number[];

    const config = {
      phoneNumberId: '10987654321',
      accessToken: 'EAAB_TEST_TOKEN',
      apiVersion: 'v21.0',
    };

    const paymentReceipt: ParsedPaymentReceipt = {
      wallet: 'NEQUI',
      amount: 50000,
      senderName: 'Carlos Andres Gomez',
      reference: 'M123456',
      rawText: 'Carlos Andres Gomez te envio $50.000',
    };

    const alertOptions: PaymentAlertOptions = {
      isStale: false,
      capturedAt: Date.UTC(2026, 4, 6, 19, 30, 0),
      latencyMs: 1500,
    };

    beforeEach(() => {
      sleepDelays = [];
      mockHttpClient = {
        post: vi.fn(),
      };
      client = new WhatsAppCloudApiClient({
        ...config,
        httpClient: mockHttpClient,
        maxRetries: 3,
        initialBackoffMs: 50,
        sleepProvider: async (ms) => {
          sleepDelays.push(ms);
        },
      });
    });

    it('debe despachar la plantilla regular transferya_payment_alert_v1 cuando isStale es false', async () => {
      const mockResponse: HttpResponseData = {
        status: 200,
        data: {
          messaging_product: 'whatsapp',
          contacts: [{ input: '573001234567', wa_id: '573001234567' }],
          messages: [{ id: 'wamid.HBgLMTIzNDU2' }],
        },
      };

      vi.spyOn(mockHttpClient, 'post').mockResolvedValueOnce(mockResponse);

      const result = await client.sendPaymentAlert(
        '+573001234567',
        paymentReceipt,
        alertOptions,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.messageId).toBe('wamid.HBgLMTIzNDU2');
      }

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/10987654321/messages',
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '573001234567',
          type: 'template',
          template: {
            name: 'transferya_payment_alert_v1',
            language: { code: 'es_CO' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: '$ 50.000' },
                  { type: 'text', text: 'Carlos Andres Gomez' },
                  { type: 'text', text: 'Nequi' },
                  { type: 'text', text: '14:30:00' },
                ],
              },
            ],
          },
        },
        {
          Authorization: 'Bearer EAAB_TEST_TOKEN',
          'Content-Type': 'application/json',
        },
      );
    });

    it('debe despachar la plantilla de advertencia transferya_stale_alert_v1 cuando isStale es true', async () => {
      const mockResponse: HttpResponseData = {
        status: 200,
        data: {
          messages: [{ id: 'wamid.STALE_ALERT_123' }],
        },
      };

      vi.spyOn(mockHttpClient, 'post').mockResolvedValueOnce(mockResponse);

      const staleOptions: PaymentAlertOptions = {
        isStale: true,
        capturedAt: Date.UTC(2026, 4, 6, 19, 30, 0),
        latencyMs: 125000, // 125 segundos de retraso
      };

      const result = await client.sendPaymentAlert(
        '+573001234567',
        paymentReceipt,
        staleOptions,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.messageId).toBe('wamid.STALE_ALERT_123');
      }

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('/messages'),
        expect.objectContaining({
          template: expect.objectContaining({
            name: 'transferya_stale_alert_v1',
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: '$ 50.000' },
                  { type: 'text', text: 'Carlos Andres Gomez' },
                  { type: 'text', text: 'Nequi' },
                  { type: 'text', text: '14:30:00' },
                  { type: 'text', text: '125s de retraso' },
                ],
              },
            ],
          }),
        }),
        expect.any(Object),
      );
    });
  });

  describe('3. Manejo de Errores HTTP y Reintentos (Rate Limits y Resiliencia)', () => {
    let mockHttpClient: IHttpClient;
    let client: WhatsAppCloudApiClient;
    let sleepDelays: number[];

    beforeEach(() => {
      sleepDelays = [];
      mockHttpClient = {
        post: vi.fn(),
      };
      client = new WhatsAppCloudApiClient({
        phoneNumberId: '10987654321',
        accessToken: 'EAAB_TEST_TOKEN',
        httpClient: mockHttpClient,
        maxRetries: 3,
        initialBackoffMs: 50,
        sleepProvider: async (ms) => {
          sleepDelays.push(ms);
        },
      });
    });

    it('debe manejar error 400 Bad Request sin reintentar y retornar BAD_REQUEST', async () => {
      vi.spyOn(mockHttpClient, 'post').mockResolvedValueOnce({
        status: 400,
        data: {
          error: {
            message: 'Parameter format does not match template definition',
            code: 100,
          },
        },
      });

      const result = await client.sendTemplate('+573001234567', 'test_template', []);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('BAD_REQUEST');
        expect(result.statusCode).toBe(400);
        expect(result.message).toMatch(/parameter format does not match/i);
      }
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    });

    it('debe manejar error 401 Unauthorized sin reintentar y retornar UNAUTHORIZED', async () => {
      vi.spyOn(mockHttpClient, 'post').mockResolvedValueOnce({
        status: 401,
        data: {
          error: {
            message: 'Session has expired or access token is invalid',
            code: 190,
          },
        },
      });

      const result = await client.sendTemplate('+573001234567', 'test_template', []);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('UNAUTHORIZED');
        expect(result.statusCode).toBe(401);
      }
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    });

    it('debe reintentar ante error 429 (Rate Limit) con backoff y recuperarse si el reintento tiene éxito', async () => {
      vi.spyOn(mockHttpClient, 'post')
        .mockResolvedValueOnce({
          status: 429,
          data: { error: { message: 'Rate limit hit' } },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: { messages: [{ id: 'wamid.RECOVERED_429' }] },
        });

      const result = await client.sendTemplate('+573001234567', 'test_template', []);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.messageId).toBe('wamid.RECOVERED_429');
      }
      expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
      expect(sleepDelays).toHaveLength(1);
      expect(sleepDelays[0]).toBeGreaterThanOrEqual(50);
    });

    it('debe agotar los reintentos ante error 429 persistente y retornar RATE_LIMITED', async () => {
      vi.spyOn(mockHttpClient, 'post').mockResolvedValue({
        status: 429,
        data: { error: { message: 'Too many requests' } },
      });

      const result = await client.sendTemplate('+573001234567', 'test_template', []);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('RATE_LIMITED');
        expect(result.statusCode).toBe(429);
      }
      expect(mockHttpClient.post).toHaveBeenCalledTimes(3);
      expect(sleepDelays).toHaveLength(2); // Retried twice before giving up
    });

    it('debe reintentar ante excepciones de red y retornar NETWORK_ERROR si persisten', async () => {
      vi.spyOn(mockHttpClient, 'post').mockRejectedValue(
        new Error('ECONNRESET connection reset by peer'),
      );

      const result = await client.sendTemplate('+573001234567', 'test_template', []);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('NETWORK_ERROR');
        expect(result.message).toMatch(/econnreset/i);
      }
      expect(mockHttpClient.post).toHaveBeenCalledTimes(3);
    });

    it('debe despachar la alerta de retención comercial al dueño (fallback a texto) cuando la cuenta está vencida', async () => {
      vi.spyOn(mockHttpClient, 'post')
        .mockResolvedValueOnce({ status: 400, data: { error: { code: 132001 } } }) // es_CO template no existe
        .mockResolvedValueOnce({ status: 400, data: { error: { code: 132001 } } }) // es template no existe
        .mockResolvedValueOnce({ status: 200, data: { messages: [{ id: 'wamid.BILLING_NOTICE_1' }] } }); // Fallback texto

      const result = await client.sendSubscriptionNotice('+573113654315', {
        amount: 15000,
        storeName: 'Mursat Solutions',
        isSuspended: false,
        renewalPriceCop: 50000,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.messageId).toBe('wamid.BILLING_NOTICE_1');
      }
      const lastCall = vi.mocked(mockHttpClient.post).mock.calls[2];
      expect(lastCall?.[1]).toEqual(
        expect.objectContaining({
          to: '573113654315',
          type: 'text',
          text: {
            body: expect.stringContaining('$ 15.000'),
          },
        }),
      );
      expect((lastCall?.[1] as any).text.body).toContain('$ 50.000');
    });
  });
});

