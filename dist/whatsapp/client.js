import { formatCapturedTime, formatCopCurrency, formatRecipientForMeta, formatWalletDisplayName, } from './formatter.js';
export class DefaultFetchHttpClient {
    async post(url, body, headers) {
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        let data;
        try {
            data = await res.json();
        }
        catch {
            data = null;
        }
        return { status: res.status, data };
    }
}
/**
 * Cliente para Meta WhatsApp Cloud API (Graph API) optimizado para alta concurrencia
 * y resiliencia ante rate limits (HTTP 429).
 */
export class WhatsAppCloudApiClient {
    config;
    apiVersion;
    maxRetries;
    initialBackoffMs;
    sleep;
    httpClient;
    constructor(config) {
        this.config = config;
        this.apiVersion = config.apiVersion ?? 'v21.0';
        this.maxRetries = config.maxRetries ?? 3;
        this.initialBackoffMs = config.initialBackoffMs ?? 100;
        this.sleep =
            config.sleepProvider ??
                ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.httpClient = config.httpClient ?? new DefaultFetchHttpClient();
    }
    async sendTemplate(to, templateName, components, languageCode = 'es') {
        const formattedTo = formatRecipientForMeta(to);
        const url = `https://graph.facebook.com/${this.apiVersion}/${this.config.phoneNumberId}/messages`;
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: formattedTo,
            type: 'template',
            template: {
                name: templateName,
                language: {
                    code: languageCode,
                },
                components,
            },
        };
        const headers = {
            Authorization: `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
        };
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await this.httpClient.post(url, payload, headers);
                if (response.status === 200) {
                    const messageId = response.data?.messages?.[0]?.id ?? 'UNKNOWN_MESSAGE_ID';
                    return {
                        success: true,
                        messageId,
                    };
                }
                if (response.status === 400) {
                    return {
                        success: false,
                        error: 'BAD_REQUEST',
                        statusCode: 400,
                        message: response.data?.error?.message ??
                            'Error en los parámetros de la plantilla',
                        details: response.data,
                    };
                }
                if (response.status === 401) {
                    return {
                        success: false,
                        error: 'UNAUTHORIZED',
                        statusCode: 401,
                        message: response.data?.error?.message ??
                            'Token de acceso de Meta expirado o inválido',
                        details: response.data,
                    };
                }
                if (response.status === 429) {
                    if (attempt < this.maxRetries) {
                        const delay = this.initialBackoffMs * Math.pow(2, attempt - 1);
                        await this.sleep(delay);
                        continue;
                    }
                    return {
                        success: false,
                        error: 'RATE_LIMITED',
                        statusCode: 429,
                        message: response.data?.error?.message ??
                            'Límite de tasa excedido en Meta Cloud API',
                        details: response.data,
                    };
                }
                // Otros códigos de error HTTP
                if (attempt < this.maxRetries) {
                    const delay = this.initialBackoffMs * Math.pow(2, attempt - 1);
                    await this.sleep(delay);
                    continue;
                }
                return {
                    success: false,
                    error: 'UNKNOWN_ERROR',
                    statusCode: response.status,
                    message: response.data?.error?.message ?? `Error HTTP ${response.status}`,
                    details: response.data,
                };
            }
            catch (error) {
                if (attempt < this.maxRetries) {
                    const delay = this.initialBackoffMs * Math.pow(2, attempt - 1);
                    await this.sleep(delay);
                    continue;
                }
                return {
                    success: false,
                    error: 'NETWORK_ERROR',
                    message: error instanceof Error
                        ? error.message
                        : 'Error de conexión de red con Meta Cloud API',
                    details: error,
                };
            }
        }
        return {
            success: false,
            error: 'UNKNOWN_ERROR',
            message: 'Reintentos agotados sin respuesta concluyente',
        };
    }
    async sendTextMessage(to, text) {
        const formattedTo = formatRecipientForMeta(to);
        const url = `https://graph.facebook.com/${this.apiVersion}/${this.config.phoneNumberId}/messages`;
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: formattedTo,
            type: 'text',
            text: { body: text },
        };
        const headers = {
            Authorization: `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
        };
        try {
            const response = await this.httpClient.post(url, payload, headers);
            if (response.status === 200) {
                const messageId = response.data?.messages?.[0]?.id ?? 'UNKNOWN_MESSAGE_ID';
                return {
                    success: true,
                    messageId,
                };
            }
            return {
                success: false,
                error: 'UNKNOWN_ERROR',
                statusCode: response.status,
                message: response.data?.error?.message ?? `Error HTTP ${response.status}`,
                details: response.data,
            };
        }
        catch (error) {
            return {
                success: false,
                error: 'NETWORK_ERROR',
                message: error instanceof Error
                    ? error.message
                    : 'Error de conexión de red con Meta Cloud API',
            };
        }
    }
    async sendPaymentAlert(to, payment, options) {
        const formattedAmount = formatCopCurrency(payment.amount);
        const formattedWallet = formatWalletDisplayName(payment.wallet);
        const formattedTime = formatCapturedTime(options.capturedAt);
        let templateResult;
        if (!options.isStale) {
            // Plantilla regular de confirmación de pago
            const components = [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: formattedAmount },
                        { type: 'text', text: payment.senderName },
                        { type: 'text', text: formattedWallet },
                        { type: 'text', text: formattedTime },
                    ],
                },
            ];
            templateResult = await this.sendTemplate(to, 'transferya_payment_alert_v1', components);
        }
        else {
            // Plantilla con advertencia visual de retraso de red (Stale Alert)
            const latencySeconds = Math.round((options.latencyMs ?? 0) / 1000);
            const latencyParam = `${latencySeconds}s de retraso`;
            const components = [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: formattedAmount },
                        { type: 'text', text: payment.senderName },
                        { type: 'text', text: formattedWallet },
                        { type: 'text', text: formattedTime },
                        { type: 'text', text: latencyParam },
                    ],
                },
            ];
            templateResult = await this.sendTemplate(to, 'transferya_stale_alert_v1', components);
        }
        if (templateResult.success) {
            return templateResult;
        }
        // Fallback de alta resiliencia: si la plantilla está en revisión o no aprobada aún,
        // enviar mensaje directo formateado para que el cajero no pierda la alerta
        const refText = payment.reference ? `\nRef: ${payment.reference}` : '';
        const staleWarning = options.isStale
            ? `\n⚠️ Advertencia: ${Math.round((options.latencyMs ?? 0) / 1000)}s de retraso en red.`
            : '';
        const fallbackText = `⚡ *TransferYA - Pago Confirmado*\n\n💰 Monto: *${formattedAmount}*\n👤 De: *${payment.senderName}*\n🏦 Billetera: *${formattedWallet}*\n⏰ Hora: *${formattedTime}*${refText}${staleWarning}`;
        const textResult = await this.sendTextMessage(to, fallbackText);
        if (textResult.success) {
            return textResult;
        }
        return templateResult;
    }
}
