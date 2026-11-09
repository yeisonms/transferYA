/**
 * Formatea un monto numérico entero en formato de moneda colombiana (COP).
 * Ejemplo: 50000 -> "$ 50.000"
 */
export function formatCopCurrency(amount) {
    if (typeof amount !== 'number' ||
        Number.isNaN(amount) ||
        amount <= 0 ||
        !Number.isInteger(amount)) {
        throw new Error('El monto debe ser un entero positivo en pesos colombianos (COP)');
    }
    const formatted = amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `$ ${formatted}`;
}
/**
 * Formatea un timestamp epoch ms en una hora legible colombiana (UTC-5 / America/Bogota).
 * Formato determinista HH:mm:ss en 24 horas.
 */
export function formatCapturedTime(timestamp, timezone = 'America/Bogota') {
    if (typeof timestamp !== 'number' ||
        Number.isNaN(timestamp) ||
        timestamp < 0) {
        throw new Error('Timestamp de captura invalido');
    }
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    return formatter.format(new Date(timestamp));
}
/**
 * Normaliza el nombre legible de la billetera digital para visualización al cajero.
 */
export function formatWalletDisplayName(wallet) {
    if (wallet === 'NEQUI') {
        return 'Nequi';
    }
    if (wallet === 'DAVIPLATA') {
        return 'Daviplata';
    }
    return wallet;
}
/**
 * Normaliza el número de teléfono para la API de Meta.
 * Meta Graph API requiere dígitos puros sin el signo '+' ni separadores.
 * Ejemplo: "+57 300 123-4567" -> "573001234567"
 */
export function formatRecipientForMeta(phone) {
    if (!phone || typeof phone !== 'string') {
        throw new Error('Numero de destinatario invalido');
    }
    const digits = phone.trim().replace(/\D/g, '');
    if (!digits) {
        throw new Error('Numero de destinatario invalido');
    }
    return digits;
}
