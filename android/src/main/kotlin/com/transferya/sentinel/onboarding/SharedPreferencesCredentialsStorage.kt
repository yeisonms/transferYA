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

    // =========================================================================
    // Estado Comercial y Facturación (Ticket 21 / ADR-0003)
    // =========================================================================
    fun getSubscriptionStatus(): String = prefs.getString("subscription_status", "TRIAL") ?: "TRIAL"
    fun saveSubscriptionStatus(status: String) {
        prefs.edit().putString("subscription_status", status).apply()
    }

    fun getSubscriptionEndsAt(): Long = prefs.getLong("subscription_ends_at", 0L)
    fun saveSubscriptionEndsAt(timestampMs: Long) {
        prefs.edit().putLong("subscription_ends_at", timestampMs).apply()
    }

    fun getBillingQrPayload(): String = prefs.getString(
        "billing_qr_payload",
        "https://recarga.nequi.com.co/bdigital/?phone=3113654315&amount=50000"
    ) ?: "https://recarga.nequi.com.co/bdigital/?phone=3113654315&amount=50000"

    fun saveBillingQrPayload(payload: String) {
        prefs.edit().putString("billing_qr_payload", payload).apply()
    }

    fun getBillingAmountCop(): Long = prefs.getLong("billing_amount_cop", 50_000L)
    fun saveBillingAmountCop(amount: Long) {
        prefs.edit().putLong("billing_amount_cop", amount).apply()
    }
}

