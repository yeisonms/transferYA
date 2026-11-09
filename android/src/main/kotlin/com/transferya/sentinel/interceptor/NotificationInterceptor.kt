package com.transferya.sentinel.interceptor

import com.transferya.sentinel.dispatcher.NotificationDispatcher
import com.transferya.sentinel.storage.CapturedNotificationEntity
import com.transferya.sentinel.storage.ICapturedNotificationDao

/**
 * Interceptor nativo de notificaciones push de Nequi y Daviplata (Ticket 06 / ADR-0003).
 * Adquiere un Partial WakeLock temporal (15s) para garantizar tiempo de CPU en modo Doze,
 * persiste atómicamente en SQLite y activa el despachador de red.
 */
class NotificationInterceptor(
    private val dao: ICapturedNotificationDao,
    private val dispatcher: NotificationDispatcher?,
    private val wakeLockManager: IWakeLockManager,
    private val foregroundController: IForegroundServiceController,
    private val deviceId: String,
    private val supportedPackages: Set<String> = setOf(
        "com.nequi.MobileApp",
        "com.davivienda.daviplata"
    )
) {
    companion object {
        const val WAKE_LOCK_TAG = "TransferYA:Interception"
        const val WAKE_LOCK_TIMEOUT_MS = 15000L
    }

    /**
     * Procesa un evento de notificación capturado por el sistema operativo.
     */
    fun onNotificationReceived(event: RawNotificationEvent): InterceptionResult {
        // 1. Filtrado estricto por nombre de paquete (ignorar apps no bancarias)
        if (!supportedPackages.contains(event.packageName)) {
            return InterceptionResult.Ignored(
                reason = "Paquete no soportado",
                packageName = event.packageName
            )
        }

        // 2. Adquirir Partial WakeLock de bajo nivel (ADR-0003)
        wakeLockManager.acquirePartialWakeLock(WAKE_LOCK_TAG, WAKE_LOCK_TIMEOUT_MS)

        return try {
            // 3. Persistir atómicamente en disco (SQLite local) con estado PENDING
            val entity = CapturedNotificationEntity(
                deviceId = deviceId,
                walletPackage = event.packageName,
                rawTitle = event.title,
                rawText = event.text,
                capturedAt = event.postTime
            )

            val generatedId = dao.insertPending(entity)

            // 4. Disparar orquestador de despacho de red de forma reactiva
            try {
                dispatcher?.dispatchPending()
            } catch (_: Exception) {
                // Si el despacho inmediato falla, WorkManager o la siguiente pasada lo reintentará
            }

            InterceptionResult.Accepted(
                entityId = generatedId,
                walletPackage = event.packageName
            )
        } catch (e: Throwable) {
            InterceptionResult.Error(
                message = "Error al persistir notificación: ${e.message}",
                exception = e
            )
        } finally {
            // 5. Liberación garantizada del WakeLock para proteger la batería del terminal
            wakeLockManager.releaseWakeLock(WAKE_LOCK_TAG)
        }
    }
}
