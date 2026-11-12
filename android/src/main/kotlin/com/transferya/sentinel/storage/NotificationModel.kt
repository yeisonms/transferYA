package com.transferya.sentinel.storage

/**
 * Estados del ciclo de vida local de una notificación capturada (ADR-0001).
 */
enum class NotificationStatus {
    PENDING,
    DISPATCHED,
    FAILED
}

/**
 * Entidad de persistencia local SQLite para resguardar pagos capturados antes de la red.
 */
data class CapturedNotificationEntity(
    val id: Long = 0,
    val deviceId: String,
    val walletPackage: String,
    val rawTitle: String,
    val rawText: String,
    val capturedAt: Long,
    val dispatchedAt: Long? = null,
    val status: NotificationStatus = NotificationStatus.PENDING,
    val retryCount: Int = 0,
    val lastError: String? = null
)

/**
 * Contrato de acceso a datos (DAO) para operaciones atómicas locales en el Dispositivo Centinela.
 */
interface ICapturedNotificationDao {
    fun insertPending(entity: CapturedNotificationEntity): Long
    fun getPendingNotifications(limit: Int = 50): List<CapturedNotificationEntity>
    fun getById(id: Long): CapturedNotificationEntity?
    fun markAsDispatched(id: Long, dispatchedAt: Long): Boolean
    fun incrementRetry(id: Long, error: String): Boolean
    fun markAsFailed(id: Long, error: String): Boolean = incrementRetry(id, error)
    fun failPendingForOtherDevices(activeDeviceId: String): Int = 0
    fun getLastError(): String? = null
    fun getCountByStatus(status: NotificationStatus): Int
}

