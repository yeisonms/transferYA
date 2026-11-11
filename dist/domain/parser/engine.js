/**
 * Normaliza y convierte un string de monto en pesos colombianos (COP) a un número entero estricto.
 */
export function cleanCopAmount(rawAmountStr) {
    if (!rawAmountStr)
        return 0;
    let cleaned = rawAmountStr.trim().replace(/[.,]+$/, '');
    // Remover sufijos de decimales comunes en Colombia (,00 o .00)
    cleaned = cleaned.replace(/[,.]00$/, '');
    // Extraer únicamente los dígitos numéricos
    const digits = cleaned.replace(/[^\d]/g, '');
    const parsed = parseInt(digits, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}
/**
 * Normaliza nombres latinos a Title Case respetando tildes, la letra 'ñ' y colapsando espacios múltiples.
 */
export function normalizeSenderName(rawName) {
    const cleaned = rawName
        .trim()
        .replace(/[.;,]+$/, '') // Remover puntuación al final
        .replace(/\s+/g, ' ');
    if (!cleaned)
        return '';
    return cleaned
        .split(' ')
        .map((word) => {
        if (!word)
            return '';
        const lower = word.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
        .join(' ');
}
// Patrones de descarte para evitar falsos positivos
const NEGATIVE_PATTERNS = [
    // Promociones y publicidad
    /\b(pide tu tarjeta|disfruta de descuentos|cr[eé]dito salvavidas|conoce el nuevo cr[eé]dito|desbloqueaste|bolsillos interesantes|haz crecer tu plata|aplican tyc)\b/i,
    // Retiros de efectivo
    /\b(retiro exitoso|sacaste\s+\$|retiro en cajero|en cajero bancolombia)\b/i,
    // Pagos salientes / débitos
    /\b(enviaste plata|pagaste\s+\$|enviaste\s+\$|compraste\s+\$|transferiste\s+\$|env[ií]o de plata(?:\s+exitoso|\s+por\s+[\$\d.,]+\s+fue\s+exitoso)|el env[ií]o de plata por|detalle del env[ií]o)\b/i,
    // Avisos de seguridad y claves dinámicas
    /\b(clave din[aá]mica|nuevo inicio de sesi[oó]n|detectamos un nuevo)\b/i,
];
const PARSING_RULES = [
    // --- REGLAS NEQUI ---
    // Te acaban de enviar $1.000 en Nequi. Ref: M78998319
    {
        wallet: 'NEQUI',
        pattern: /(?:¡?Te acaban de enviar!?|Te acaban de enviar|Te enviaron)\s+([\$\d.,\s]+?)\s+en Nequi(?:\s+de\s+(.*?))?(?:\.|\s*Ref:|\s*\(|$)/i,
        amountGroup: 1,
        senderGroup: 2,
        defaultSender: 'Nequi',
    },
    // ¡Plata recibida! Juan Perez te envió $15.000 a tu Nequi.
    {
        wallet: 'NEQUI',
        pattern: /(?:¡?Plata recibida!?\s*)?(.*?)\s+te envi[oó]\s+([\$\d.,\s]+?)\s+a tu Nequi/i,
        amountGroup: 2,
        senderGroup: 1,
    },
    // Formato oficial Nequi: EDWIN MURCIA te envió 100000, ¡lo mejor!
    {
        wallet: 'NEQUI',
        pattern: /(?:¡?Plata recibida!?\s*)?(.*?)\s+te envi[oó]\s+([\$\d.,]+)(?:,\s*¡?lo mejor!?|\.|$)/i,
        amountGroup: 2,
        senderGroup: 1,
    },
    // Te transfirieron $50.000 de Pepito Pérez (Saldo: $150.000)
    {
        wallet: 'NEQUI',
        pattern: /Te transfirieron\s+([\$\d.,\s]+?)\s+de\s+(.*?)(?:\s*\(Saldo:.*?\)|$)/i,
        amountGroup: 1,
        senderGroup: 2,
    },
    // Te enviaron $30.000 por Transfiya de Carlos Mendoza.
    {
        wallet: 'NEQUI',
        pattern: /Te enviaron\s+([\$\d.,\s]+?)\s+por Transfiya de\s+(.*?)(?:\.|$|\s*\(.*?\))/i,
        amountGroup: 1,
        senderGroup: 2,
    },
    // Te pasaron $1.250.000 de ANDRES FELIPE RUIZ
    {
        wallet: 'NEQUI',
        pattern: /Te pasaron\s+([\$\d.,\s]+?)\s+de\s+(.*?)(?:\.|$|\s*\(.*?\))/i,
        amountGroup: 1,
        senderGroup: 2,
    },
    // ¡Te llegó plata! Te enviaron $10.000 a tu Nequi.
    {
        wallet: 'NEQUI',
        pattern: /(?:¡?Te lleg[oó] plata!?\s*)?Te enviaron\s+([\$\d.,\s]+?)\s+a tu Nequi(?:\s+de\s+(.*?))?(?:\.|$)/i,
        amountGroup: 1,
        senderGroup: 2,
        defaultSender: 'Nequi',
    },
    // Bre-B en Nequi: Título "Te enviaron plata por Bre-B" + Texto "Te enviaron $66.000. Entra a tu app y revisa tu saldo."
    {
        wallet: 'NEQUI',
        pattern: /Te enviaron plata por Bre-B[\s\S]*?Te enviaron\s+([\$\d.,]+)/i,
        amountGroup: 1,
        defaultSender: 'Transferencia Bre-B',
    },
    // Genérico Nequi sin remitente: "Te enviaron $66.000. Entra a tu app y revisa tu saldo."
    {
        wallet: 'NEQUI',
        pattern: /^Te enviaron\s+([\$\d.,]+?)(?:\.\s*|\s+)(?:Entra a tu app|revisa tu saldo|por Bre-B|$)/i,
        amountGroup: 1,
        defaultSender: 'Transferencia Nequi',
    },
    // --- REGLAS DAVIPLATA ---
    // DaviPlata le informa que recibio $25.000 de Laura Gomez
    {
        wallet: 'DAVIPLATA',
        pattern: /DaviPlata le informa que recibi[oó]\s+([\$\d.,\s]+?)\s+de\s+(.*?)(?:\.|$|\s*\(.*?\))/i,
        amountGroup: 1,
        senderGroup: 2,
    },
    // DaviPlata le informa que recibio $25.000 (sin remitente explicito)
    {
        wallet: 'DAVIPLATA',
        pattern: /DaviPlata le informa que recibi[oó]\s+([\$\d.,]+)(?:\.|$|\s*\(.*?\))/i,
        amountGroup: 1,
        defaultSender: 'DaviPlata',
    },
    // Recibiste una transferencia de $50.000 de MARIA GOMEZ
    {
        wallet: 'DAVIPLATA',
        pattern: /Recibiste una transferencia de\s+([\$\d.,\s]+?)\s+de\s+(.*?)(?:\.|$|\s*\(.*?\))/i,
        amountGroup: 1,
        senderGroup: 2,
    },
    // DaviPlata: Recibiste $100,000.00 de Pedro Picapiedra
    {
        wallet: 'DAVIPLATA',
        pattern: /(?:DaviPlata:?\s*)?Recibiste\s+([\$\d.,\s]+?)\s+de\s+(.*?)(?:\.|$|\s*\(.*?\))/i,
        amountGroup: 1,
        senderGroup: 2,
    },
    // Le transfirieron $35.000 a su DaviPlata de Camilo Torres
    {
        wallet: 'DAVIPLATA',
        pattern: /Le transfirieron\s+([\$\d.,\s]+?)\s+a su DaviPlata de\s+(.*?)(?:\.|$|\s*\(.*?\))/i,
        amountGroup: 1,
        senderGroup: 2,
    },
    // Fallback DaviPlata (incluye Bre-B entrante): "Recibiste $50.000" / "Te enviaron $50.000"
    {
        wallet: 'DAVIPLATA',
        pattern: /(?:DaviPlata:?\s*)?(?:Te enviaron plata por Bre-B[\s\S]*?Te enviaron|Recibiste)\s+([\$\d.,]+)(?:\s+por\s+Bre-B)?(?:\.\s*|\s+|$)/i,
        amountGroup: 1,
        defaultSender: 'DaviPlata',
    },
];
/**
 * Motor determinista de parsing para notificaciones bancarias de Nequi y Daviplata.
 */
export function parseBankingNotification(rawText, rawTitle = '', walletPackage) {
    const combinedText = `${rawTitle} ${rawText}`.trim();
    // 1. Filtrado preventivo contra falsos positivos
    for (const negativeRegex of NEGATIVE_PATTERNS) {
        if (negativeRegex.test(combinedText)) {
            return {
                success: false,
                error: 'NOT_A_PAYMENT',
                reason: 'La notificación corresponde a publicidad, retiro o débito saliente',
            };
        }
    }
    // 2. Determinar filtro de billetera si viene explícito (paquete Android tiene prioridad sobre texto)
    let expectedWallet = null;
    if (walletPackage === 'com.nequi.MobileApp') {
        expectedWallet = 'NEQUI';
    }
    else if (walletPackage === 'com.davivienda.daviplata') {
        expectedWallet = 'DAVIPLATA';
    }
    else if (/nequi/i.test(rawTitle) || /nequi/i.test(rawText)) {
        expectedWallet = 'NEQUI';
    }
    else if (/daviplata/i.test(rawTitle) || /daviplata/i.test(rawText)) {
        expectedWallet = 'DAVIPLATA';
    }
    // 3. Evaluar reglas de extracción
    for (const rule of PARSING_RULES) {
        if (expectedWallet && rule.wallet !== expectedWallet) {
            continue;
        }
        const match = rawText.match(rule.pattern) ?? combinedText.match(rule.pattern);
        if (match) {
            const rawAmount = match[rule.amountGroup];
            const rawSender = rule.senderGroup !== undefined ? match[rule.senderGroup] : undefined;
            const rawRef = rule.referenceGroup !== undefined ? match[rule.referenceGroup] : undefined;
            const amount = cleanCopAmount(rawAmount);
            let senderName = rawSender ? normalizeSenderName(rawSender) : '';
            if (!senderName && rule.defaultSender) {
                senderName = rule.defaultSender;
            }
            // Buscar referencia explícita en el texto si no vino por grupo de captura
            let reference = rawRef ? rawRef.trim() : null;
            if (!reference) {
                const refMatch = combinedText.match(/(?:ref(?:erencia)?[:\s]+)([a-zA-Z0-9]+)/i);
                if (refMatch) {
                    reference = refMatch[1].trim();
                }
            }
            if (amount > 0 && senderName.length > 0) {
                return {
                    success: true,
                    payment: {
                        wallet: rule.wallet,
                        amount,
                        senderName,
                        reference,
                        rawText,
                    },
                };
            }
        }
    }
    // 4. No coincidió con ningún patrón de abono monetario conocido
    return {
        success: false,
        error: 'NOT_A_PAYMENT',
        reason: 'El texto no coincide con ningún patrón de transferencia entrante',
    };
}
