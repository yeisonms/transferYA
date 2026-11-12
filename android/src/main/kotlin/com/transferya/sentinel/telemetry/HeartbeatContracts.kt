package com.transferya.sentinel.telemetry

/**
 * Datos del Heartbeat periódicos del Dispositivo Centinela (ADR-0003).
 */
data class HeartbeatData(
    val deviceId: String,
    val batteryLevel: Int,
    val isCharging: Boolean,
    val networkType: String,
    val appVersion: String,
    val sentAt: Long = System.currentTimeMillis()
)

/**
 * Respuesta decodificada del endpoint /api/v1/devices/heartbeat (Ticket 21).
 */
data class HeartbeatResponse(
    val success: Boolean,
    val subscriptionStatus: String? = null,
    val subscriptionEndsAt: String? = null,
    val subscriptionEndsAtMs: Long? = null,
    val remainingDays: Int? = null,
    val billingQrPayload: String? = null,
    val billingAmountCop: Long? = null
)

interface IDeviceStatusProvider {
    fun getBatteryLevel(): Int
    fun isCharging(): Boolean
    fun getNetworkType(): String
    fun getAppVersion(): String
}

interface IHeartbeatEmitter {
    fun emitHeartbeat(): Boolean
}

