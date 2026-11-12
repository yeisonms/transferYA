package com.transferya.sentinel.interceptor

/**
 * Filtro puro previo a la persistencia SQLite en Node A.
 * Evita ingestar resúmenes de grupo de Android (`FLAG_GROUP_SUMMARY`)
 * o notificaciones fantasma sin título ni contenido útil.
 */
object NotificationFilter {

    /** Bitmask estándar de Android para `Notification.FLAG_GROUP_SUMMARY` (0x00000200). */
    const val FLAG_GROUP_SUMMARY = 0x00000200

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
