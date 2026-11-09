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

interface IDeviceStatusProvider {
    fun getBatteryLevel(): Int
    fun isCharging(): Boolean
    fun getNetworkType(): String
    fun getAppVersion(): String
}

interface IHeartbeatEmitter {
    fun emitHeartbeat(): Boolean
}

