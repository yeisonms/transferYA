package com.transferya.sentinel.dispatcher

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import java.net.HttpURLConnection
import java.net.URI

/**
 * Cliente HTTP nativo para envío seguro de notificaciones firmadas al Webhook.
 */
class NativeSentinelHttpClient : ISentinelHttpClient {
    override fun post(url: String, headers: Map<String, String>, bodyJson: String): HttpCallResponse {
        val conn = (URI(url).toURL().openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10000
            readTimeout = 10000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
        }

        conn.outputStream.use { os ->
            os.write(bodyJson.toByteArray(Charsets.UTF_8))
            os.flush()
        }

        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else (conn.errorStream ?: conn.inputStream)
        val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
        return HttpCallResponse(statusCode = code, body = body)
    }
}

/**
 * Proveedor nativo de conectividad para Android.
 */
class AndroidConnectivityProvider(private val context: Context) : IConnectivityProvider {
    override fun isConnected(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork ?: return false
            val capabilities = cm.getNetworkCapabilities(network) ?: return false
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } else {
            @Suppress("DEPRECATION")
            val activeNetworkInfo = cm.activeNetworkInfo
            @Suppress("DEPRECATION")
            activeNetworkInfo != null && activeNetworkInfo.isConnected
        }
    }
}

