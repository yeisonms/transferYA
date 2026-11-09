package com.transferya.sentinel.interceptor

/**
 * Representación desacoplada del evento push emitido por el sistema operativo Android.
 */
data class RawNotificationEvent(
    val packageName: String,
    val title: String,
    val text: String,
    val postTime: Long = System.currentTimeMillis()
)

/**
 * Abstracción para el manejo de Partial WakeLocks de Android (ADR-0003).
 */
interface IWakeLockManager {
    fun acquirePartialWakeLock(tag: String, timeoutMs: Long = 15000L)
    fun releaseWakeLock(tag: String)
    fun isHeld(tag: String): Boolean
}

/**
 * Abstracción para el control del Foreground Service persistente (ADR-0003).
 */
interface IForegroundServiceController {
    fun startForegroundService(notificationTitle: String, notificationText: String)
    fun stopForegroundService()
    fun isRunning(): Boolean
}

/**
 * Resultado del procesamiento de intercepción.
 */
sealed class InterceptionResult {
    data class Accepted(val entityId: Long, val walletPackage: String) : InterceptionResult()
    data class Ignored(val reason: String, val packageName: String) : InterceptionResult()
    data class Error(val message: String, val exception: Throwable? = null) : InterceptionResult()
}

