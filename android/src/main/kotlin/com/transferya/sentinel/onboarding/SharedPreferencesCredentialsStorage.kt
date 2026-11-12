package com.transferya.sentinel.onboarding

import android.content.Context

/**
 * Almacenamiento persistente de identificadores no secretos en SharedPreferences.
 */
class SharedPreferencesCredentialsStorage(context: Context) : IDeviceCredentialsStorage {
    private val prefs = context.getSharedPreferences("transferya_sentinel_prefs", Context.MODE_PRIVATE)

    override fun getDeviceId(): String? = prefs.getString("device_id", null)
    override fun saveDeviceId(deviceId: String) {
        prefs.edit().putString("device_id", deviceId).apply()
    }
    override fun clearDeviceId() {
        prefs.edit().remove("device_id").remove("last_heartbeat_at").apply()
    }

    fun getLastHeartbeatAt(): Long = prefs.getLong("last_heartbeat_at", 0L)
    fun saveLastHeartbeatAt(timestampMs: Long) {
        prefs.edit().putLong("last_heartbeat_at", timestampMs).apply()
    }

    override fun getMerchantId(): String? = prefs.getString("merchant_id", null)
    override fun saveMerchantId(merchantId: String) {
        prefs.edit().putString("merchant_id", merchantId).apply()
    }
    override fun clearMerchantId() {
        prefs.edit().remove("merchant_id").apply()
    }

    fun getServerUrl(): String = prefs.getString("server_url", "https://transferya.vercel.app") ?: "https://transferya.vercel.app"
    fun saveServerUrl(url: String) {
        prefs.edit().putString("server_url", url.trim().trimEnd('/')).apply()
    }
}

