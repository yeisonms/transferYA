package com.transferya.sentinel.telemetry

/**
 * Coordinador puro y testeable para cadencia de Heartbeat (ADR-0003).
 * Garantiza reintento inmediato si falló la red y cadencia estable tras éxito.
 */
class HeartbeatCoordinator(
    var intervalMs: Long = DEFAULT_HEARTBEAT_INTERVAL_MS,
    private val nowProvider: () -> Long = System::currentTimeMillis
) {
    companion object {
        const val DEFAULT_HEARTBEAT_INTERVAL_MS = 120_000L // 2 minutos en operación normal
        const val SUSPENDED_HEARTBEAT_INTERVAL_MS = 300_000L // 5 minutos liviano en estado PAST_DUE / SUSPENDED
    }

    @Volatile
    var lastSuccessAtMs: Long = 0L
        private set

    fun isDue(force: Boolean = false, nowMs: Long = nowProvider()): Boolean {
        if (force) return true
        val prev = lastSuccessAtMs
        if (prev <= 0L) return true
        return (nowMs - prev) >= intervalMs
    }

    /**
     * Ejecuta `emitFn` solo si corresponde por cadencia o `force = true`.
     * Actualiza `lastSuccessAtMs` únicamente cuando el envío fue confirmado.
     */
    fun runIfDue(force: Boolean = false, emitFn: () -> Boolean): Boolean {
        val now = nowProvider()
        if (!isDue(force = force, nowMs = now)) {
            return false
        }
        val sent = emitFn()
        if (sent) {
            lastSuccessAtMs = nowProvider()
        }
        return sent
    }
}

