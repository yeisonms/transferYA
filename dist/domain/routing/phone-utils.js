/**
 * Expresión regular para validar números de teléfono en formato ITU-T E.164.
 * Formato: signo '+' seguido del código de país y número nacional (entre 7 y 15 dígitos en total).
 */
const E164_REGEX = /^\+[1-9]\d{6,14}$/;
/**
 * Valida si una cadena cumple estrictamente con el formato internacional ITU-T E.164.
 */
export function isValidE164(phone) {
    if (!phone || typeof phone !== 'string') {
        return false;
    }
    return E164_REGEX.test(phone.trim());
}
/**
 * Normaliza un número telefónico eliminando caracteres decorativos (espacios, guiones, paréntesis)
 * y garantizando el prefijo internacional '+'.
 *
 * Si el número no incluye prefijo internacional y tiene 10 dígitos (estándar celular colombiano),
 * se le antepone el prefijo por defecto (+57).
 */
export function normalizePhoneNumberE164(phone, defaultCountryCode = '+57') {
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
        throw new Error('Numero de telefono no valido en formato E.164');
    }
    // Eliminar espacios, guiones, paréntesis y puntos
    const cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, '');
    if (cleaned.startsWith('+')) {
        if (!isValidE164(cleaned)) {
            throw new Error('Numero de telefono no valido en formato E.164');
        }
        return cleaned;
    }
    // Si no tiene prefijo '+', verificar si es un celular local de 10 dígitos (Colombia)
    if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
        const prefixed = `${defaultCountryCode}${cleaned}`;
        if (isValidE164(prefixed)) {
            return prefixed;
        }
    }
    // Si son solo dígitos que al anteponerle '+' forman un E.164 válido
    if (/^\d{7,15}$/.test(cleaned)) {
        const prefixed = `+${cleaned}`;
        if (isValidE164(prefixed)) {
            return prefixed;
        }
    }
    throw new Error('Numero de telefono no valido en formato E.164');
}
