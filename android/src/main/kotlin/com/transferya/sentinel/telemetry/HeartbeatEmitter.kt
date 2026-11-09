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
    private val nowProvider: () -> Long = System::currentTimeMillis
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

            response.statusCode in 200..299
        } catch (_: Exception) {
            false
        }
    }
}
