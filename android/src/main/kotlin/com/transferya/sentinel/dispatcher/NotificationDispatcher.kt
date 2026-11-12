package com.transferya.sentinel.dispatcher

import com.transferya.sentinel.crypto.IHmacSigner
import com.transferya.sentinel.storage.CapturedNotificationEntity
import com.transferya.sentinel.storage.ICapturedNotificationDao
import java.net.URI

/**
 * Orquestador de despacho de notificaciones hacia el Webhook (Ticket 05 / ADR-0001 / ADR-0002).
 * Gestiona la política de conectividad, firma criptográfica y mutación atómica de estado.
 */
class NotificationDispatcher(
    private val dao: ICapturedNotificationDao,
    private val signer: IHmacSigner,
    private val httpClient: ISentinelHttpClient,
    private val connectivity: IConnectivityProvider,
    private val webhookUrl: String,
    private val deviceId: String,
    private val nowProvider: () -> Long = System::currentTimeMillis
) {

    private fun extractPath(url: String): String {
        return try {
            val path = URI(url).path
            if (path.isNullOrEmpty()) "/" else path
        } catch (_: Exception) {
            "/api/v1/webhooks/notifications"
        }
    }

    private fun escapeJson(str: String): String {
        return str.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }

    private fun buildPayloadJson(entity: CapturedNotificationEntity, dispatchedAt: Long): String {
        return """{"device_id":"${escapeJson(deviceId)}","wallet_package":"${escapeJson(entity.walletPackage)}","raw_title":"${escapeJson(entity.rawTitle)}","raw_text":"${escapeJson(entity.rawText)}","captured_at":${entity.capturedAt},"dispatched_at":$dispatchedAt}"""
    }

    companion object {
        // Serializa despachos entre hilos concurrentes para evitar dobles envíos del mismo registro PENDING
        private val globalDispatchLock = Any()
    }

    fun dispatchPending(limit: Int = 20): DispatchResult = synchronized(globalDispatchLock) {
        // 1. Restricción de red activa (NetworkType.CONNECTED)
        if (!connectivity.isConnected()) {
            return@synchronized DispatchResult.Retry("Sin conectividad de red activa", 0)
        }

        // 2. Extraer lote de notificaciones en cola FIFO
        val pendingItems = dao.getPendingNotifications(limit)
        if (pendingItems.isEmpty()) {
            return@synchronized DispatchResult.Success(0)
        }

        val requestPath = extractPath(webhookUrl)
        var dispatchedCount = 0

        // 3. Procesar secuencialmente en orden cronológico
        for (item in pendingItems) {
            val dispatchedAt = nowProvider()
            val payloadJson = buildPayloadJson(item, dispatchedAt)

            // Firma de cabeceras mediante KeyStore (ADR-0002)
            val signedHeaders = signer.buildSignedHeaders(
                deviceId = deviceId,
                method = "POST",
                path = requestPath,
                payloadJson = payloadJson,
                timestamp = dispatchedAt
            )

            val response = try {
                httpClient.post(
                    url = webhookUrl,
                    headers = signedHeaders.toHeaderMap(),
                    bodyJson = payloadJson
                )
            } catch (e: Exception) {
                dao.incrementRetry(item.id, e.message ?: "Fallo de conexión de red")
                return@synchronized DispatchResult.Retry("Fallo de conexión de red: ${e.message}", dispatchedCount)
            }

            when {
                // Éxito: Webhook aceptó el evento (200, 201, 202)
                response.statusCode in 200..299 -> {
                    dao.markAsDispatched(item.id, dispatchedAt)
                    dispatchedCount++
                }
                // Error de servidor o pasarela (5xx): reintentar con backoff
                response.statusCode in 500..599 -> {
                    dao.incrementRetry(item.id, "Error de servidor HTTP ${response.statusCode}: ${response.body}")
                    return@synchronized DispatchResult.Retry("Error de servidor HTTP ${response.statusCode}", dispatchedCount + 1)
                }
                // Error de cliente irrecuperable (4xx): marcar FAILED para no atascar la cola FIFO
                response.statusCode in 400..499 -> {
                    dao.markAsFailed(item.id, "Error fatal HTTP ${response.statusCode}: ${response.body}")
                    return@synchronized DispatchResult.FatalFailure("Error fatal HTTP ${response.statusCode}: ${response.body}", item.id)
                }
                else -> {
                    dao.incrementRetry(item.id, "Respuesta inesperada HTTP ${response.statusCode}")
                    return@synchronized DispatchResult.Retry("Respuesta inesperada HTTP ${response.statusCode}", dispatchedCount + 1)
                }
            }
        }

        return@synchronized DispatchResult.Success(dispatchedCount)
    }
}
