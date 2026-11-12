package com.transferya.sentinel.telemetry

import com.transferya.sentinel.crypto.IHmacSigner
import com.transferya.sentinel.dispatcher.ISentinelHttpClient
import java.net.URI

/**
 * Emisor de telemetría y pings de salud del Centinela (Ticket 07 / ADR-0003).
 * Reporta batería, estado de red y actividad al backend con firma criptográfica HMAC.
 */
class HeartbeatEmitter(
    private val deviceStatusProvider: IDeviceStatusProvider,
    private val signer: IHmacSigner,
    private val httpClient: ISentinelHttpClient,
    private val heartbeatUrl: String,
    private val deviceId: String,
    private val nowProvider: () -> Long = System::currentTimeMillis,
    private val onResponseReceived: ((HeartbeatResponse) -> Unit)? = null
) : IHeartbeatEmitter {

    private fun extractPath(url: String): String {
        return try {
            val path = URI(url).path
            if (path.isNullOrEmpty()) "/" else path
        } catch (_: Exception) {
            "/api/v1/devices/heartbeat"
        }
    }

    private fun escapeJson(str: String): String {
        return str.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }

    private fun extractJsonString(json: String, key: String): String? {
        val regex = Regex("\"$key\"\\s*:\\s*\"([^\"]+)\"")
        return regex.find(json)?.groupValues?.get(1)
    }

    private fun extractJsonLong(json: String, key: String): Long? {
        val regex = Regex("\"$key\"\\s*:\\s*([0-9]+)")
        return regex.find(json)?.groupValues?.get(1)?.toLongOrNull()
    }

    private fun extractJsonInt(json: String, key: String): Int? {
        val regex = Regex("\"$key\"\\s*:\\s*([0-9]+)")
        return regex.find(json)?.groupValues?.get(1)?.toIntOrNull()
    }

    override fun emitHeartbeat(): Boolean {
        return try {
            val timestamp = nowProvider()
            val batteryLevel = deviceStatusProvider.getBatteryLevel()
            val isCharging = deviceStatusProvider.isCharging()
            val networkType = deviceStatusProvider.getNetworkType()
            val appVersion = deviceStatusProvider.getAppVersion()

            val bodyJson = """{"device_id":"${escapeJson(deviceId)}","battery_level":$batteryLevel,"is_charging":$isCharging,"network_type":"${escapeJson(networkType)}","app_version":"${escapeJson(appVersion)}","sent_at":$timestamp}"""

            val path = extractPath(heartbeatUrl)
            val signedHeaders = signer.buildSignedHeaders(
                deviceId = deviceId,
                method = "POST",
                path = path,
                payloadJson = bodyJson,
                timestamp = timestamp
            )

            val response = httpClient.post(
                url = heartbeatUrl,
                headers = signedHeaders.toHeaderMap(),
                bodyJson = bodyJson
            )

            val isSuccess = response.statusCode in 200..299
            if (isSuccess && response.body.isNotBlank()) {
                val parsed = HeartbeatResponse(
                    success = true,
                    subscriptionStatus = extractJsonString(response.body, "subscription_status"),
                    subscriptionEndsAt = extractJsonString(response.body, "subscription_ends_at"),
                    subscriptionEndsAtMs = extractJsonLong(response.body, "subscription_ends_at_ms"),
                    remainingDays = extractJsonInt(response.body, "remaining_days"),
                    billingQrPayload = extractJsonString(response.body, "billing_qr_payload"),
                    billingAmountCop = extractJsonLong(response.body, "billing_amount_cop")
                )
                onResponseReceived?.invoke(parsed)
            }

            isSuccess
        } catch (_: Exception) {
            false
        }
    }
}
