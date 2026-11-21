package com.transferya.sentinel.interceptor

/**
 * Filtro puro previo a la persistencia SQLite en Node A.
 * Evita ingestar resúmenes de grupo de Android (`FLAG_GROUP_SUMMARY`)
 * o notificaciones fantasma sin título ni contenido útil.
 */
object NotificationFilter {

    /** Bitmask estándar de Android para `Notification.FLAG_GROUP_SUMMARY` (0x00000200). */
    const val FLAG_GROUP_SUMMARY = 0x00000200

    /** Paquetes conocidos de aplicaciones de Mensajes SMS en Colombia / Android. */
    val SMS_PACKAGES = setOf(
        "com.google.android.apps.messaging",
        "com.android.mms",
        "com.samsung.android.messaging",
        "com.miui.smsextra",
        "com.motorola.messaging",
        "com.huawei.message",
        "com.android.messaging"
    )

    /**
     * Determina si un paquete corresponde a una aplicación de mensajería SMS.
     */
    fun isSmsPackage(packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return false
        if (SMS_PACKAGES.contains(packageName)) return true
        val lower = packageName.lowercase()
        return lower.contains("messaging") || lower.contains(".mms") || lower.contains("sms")
    }

    /**
     * Valida de forma estricta que una notificación proveniente de una app de SMS
     * corresponda exclusivamente a una alerta transaccional de Nequi o DaviPlata (ej. Bre-B).
     * Si no cumple los patrones bancarios oficiales, se rechaza inmediatamente para proteger
     * la privacidad de los mensajes de texto personales del comerciante (Habeas Data).
     */
    fun isBankingSms(rawTitle: String, rawText: String): Boolean {
        val title = rawTitle.trim()
        val text = rawText.trim()
        val lowerTitle = title.lowercase()
        val lowerText = text.lowercase()

        // Códigos cortos bancarios oficiales en Colombia:
        // 890806 = Nequi / Bancolombia
        // 890001 = Bancolombia Alertas
        // 85540  = Bancolombia Notificaciones
        // 85888  = DaviPlata
        val isBankingSender = title.contains("890806") ||
                title.contains("890001") ||
                title.contains("85540") ||
                title.contains("85888") ||
                lowerTitle.contains("bancolombia")

        // Mensaje transaccional de Nequi Negocios / Bre-B
        val isNequiTransaction = lowerText.startsWith("nequi:") ||
                lowerText.contains("a través de bre-b") ||
                lowerText.contains("a traves de bre-b") ||
                lowerText.contains("nequi negocios")

        // Mensaje transaccional de DaviPlata SMS
        val isDaviPlataTransaction = lowerText.startsWith("daviplata:") ||
                lowerText.startsWith("daviplata le informa") ||
                (lowerText.contains("daviplata") && lowerText.contains("recibi"))

        // Mensaje transaccional de Bancolombia SMS
        val isBancolombiaTransaction = lowerText.startsWith("bancolombia:") ||
                lowerText.contains("recibiste una transferencia de") ||
                lowerText.contains("recibiste un pago de") ||
                lowerText.contains("a la mano:") ||
                (lowerText.contains("bancolombia") && (lowerText.contains("recibi") || lowerText.contains("transfirieron")))

        return isBankingSender || isNequiTransaction || isDaviPlataTransaction || isBancolombiaTransaction
    }

    /**
     * Resuelve el paquete bancario representativo para enrutar en backend (ej. com.nequi.MobileApp).
     */
    fun resolveBankingPackageForSms(rawTitle: String, rawText: String): String {
        val title = rawTitle.trim()
        val lowerTitle = title.lowercase()
        val lowerText = rawText.trim().lowercase()

        return if (title.contains("85888") || lowerText.contains("daviplata")) {
            "com.davivienda.daviplata"
        } else if (title.contains("890001") || title.contains("85540") || lowerTitle.contains("bancolombia") || lowerText.startsWith("bancolombia:") || lowerText.contains("a la mano")) {
            "com.bancolombia.personas"
        } else {
            "com.nequi.MobileApp"
        }
    }

    /**
     * Determina si la notificación capturada debe procesarse y despacharse al backend.
     */
    fun shouldProcess(flags: Int, rawTitle: String, rawText: String): Boolean {
        val isGroupSummary = (flags and FLAG_GROUP_SUMMARY) != 0
        if (isGroupSummary) {
            return false
        }

        if (rawTitle.isBlank() && rawText.isBlank()) {
            return false
        }

        return true
    }
}

