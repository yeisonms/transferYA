import { normalizePhoneNumberE164 } from './phone-utils.js';
/**
 * Servicio de dominio para la resolución de rutas de notificación Comercio-Centinela-Cajeros.
 */
export class MerchantRoutingService {
    options;
    constructor(options) {
        this.options = options;
    }
    /**
     * Resuelve el Comercio Suscriptor y los cajeros activos asociados a un Dispositivo Centinela.
     */
    async resolveRoute(deviceId) {
        const now = this.options.nowProvider ? this.options.nowProvider() : Date.now();
        const merchant = await this.options.repository.getMerchantByDeviceId(deviceId);
        if (!merchant) {
            return {
                success: false,
                reason: 'DEVICE_NOT_MAPPED',
                message: 'Dispositivo Centinela no vinculado a ningún Comercio Suscriptor',
            };
        }
        if (merchant.status !== 'ACTIVE') {
            return {
                success: false,
                reason: 'MERCHANT_INACTIVE',
                message: 'El comercio no se encuentra activo',
                merchant,
            };
        }
        if (merchant.subscriptionExpiresAt !== null &&
            merchant.subscriptionExpiresAt !== undefined &&
            merchant.subscriptionExpiresAt < now) {
            return {
                success: false,
                reason: 'MERCHANT_INACTIVE',
                message: 'Suscripcion del comercio expirada',
                merchant,
            };
        }
        const recipients = await this.options.repository.getCashierRecipients(merchant.id, deviceId);
        const validActiveRecipients = [];
        for (const recipient of recipients) {
            if (!recipient.isActive) {
                continue;
            }
            try {
                const normalizedPhone = normalizePhoneNumberE164(recipient.phoneNumber);
                validActiveRecipients.push({
                    ...recipient,
                    phoneNumber: normalizedPhone,
                });
            }
            catch {
                // Ignorar cajeros con número telefónico malformado o irrecuperable
            }
        }
        if (validActiveRecipients.length === 0) {
            return {
                success: false,
                reason: 'NO_ACTIVE_RECIPIENTS',
                message: 'No hay destinatarios de caja activos con números telefónicos válidos',
                merchant,
            };
        }
        return {
            success: true,
            merchant,
            recipients: validActiveRecipients,
        };
    }
}
/**
 * Implementación en memoria del repositorio de enrutamiento para tests unitarios y decoupling.
 */
export class InMemoryMerchantRoutingRepository {
    merchantsByDevice = new Map();
    recipientsByMerchant = new Map();
    registerDeviceMerchant(deviceId, merchant) {
        this.merchantsByDevice.set(deviceId, merchant);
    }
    registerCashierRecipient(recipient) {
        const list = this.recipientsByMerchant.get(recipient.merchantId) ?? [];
        list.push(recipient);
        this.recipientsByMerchant.set(recipient.merchantId, list);
    }
    async getMerchantByDeviceId(deviceId) {
        return this.merchantsByDevice.get(deviceId) ?? null;
    }
    async getCashierRecipients(merchantId, deviceId) {
        const list = this.recipientsByMerchant.get(merchantId) ?? [];
        if (!deviceId) {
            return list;
        }
        // Incluir cajeros vinculados específicamente a este dispositivo o globales (sin deviceId asignado)
        return list.filter((recipient) => !recipient.deviceId || recipient.deviceId === deviceId);
    }
}
