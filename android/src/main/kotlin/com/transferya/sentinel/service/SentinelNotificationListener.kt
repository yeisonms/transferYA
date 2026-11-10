package com.transferya.sentinel.service

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.transferya.sentinel.crypto.AndroidKeyStoreVault
import com.transferya.sentinel.crypto.HmacSigner
import com.transferya.sentinel.dispatcher.AndroidConnectivityProvider
import com.transferya.sentinel.dispatcher.NativeSentinelHttpClient
import com.transferya.sentinel.dispatcher.NotificationDispatcher
import com.transferya.sentinel.interceptor.AndroidForegroundController
import com.transferya.sentinel.interceptor.AndroidWakeLockManager
import com.transferya.sentinel.interceptor.NotificationInterceptor
import com.transferya.sentinel.interceptor.RawNotificationEvent
import com.transferya.sentinel.onboarding.DeviceEnrollmentManager
import com.transferya.sentinel.onboarding.SharedPreferencesCredentialsStorage
import com.transferya.sentinel.storage.AndroidSqliteNotificationDao
import kotlin.concurrent.thread

/**
 * Servicio de escucha de notificaciones de Android (Node A).
 * Intercepta notificaciones de Nequi y Daviplata en segundo plano (Ticket 06 / ADR-0003),
 * persiste atómicamente en SQLite local y despacha de inmediato con firma HMAC-SHA256.
 */
class SentinelNotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "SentinelListener"
    }

    private var interceptor: NotificationInterceptor? = null
    private var dispatcher: NotificationDispatcher? = null

    override fun onCreate() {
        super.onCreate()
        initPipeline()
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.i(TAG, "NotificationListener conectado con el sistema operativo")
        initPipeline()
        thread {
            try {
                dispatcher?.dispatchPending()
            } catch (e: Exception) {
                Log.e(TAG, "Error despachando notificaciones pendientes al conectar", e)
            }
        }
    }

    private fun initPipeline() {
        try {
            val credentialsStorage = SharedPreferencesCredentialsStorage(this)
            val deviceId = credentialsStorage.getDeviceId()
            val serverUrl = credentialsStorage.getServerUrl()
            val keyStoreVault = AndroidKeyStoreVault(this)

            if (deviceId.isNullOrBlank() || !keyStoreVault.hasSecret(DeviceEnrollmentManager.KEYSTORE_ALIAS_SECRET)) {
                Log.w(TAG, "Dispositivo no emparejado aún. Pipeline en espera de credenciales.")
                return
            }

            val signer = HmacSigner(keyStoreVault, DeviceEnrollmentManager.KEYSTORE_ALIAS_SECRET)
            val dao = AndroidSqliteNotificationDao(this)
            val httpClient = NativeSentinelHttpClient()
            val connectivity = AndroidConnectivityProvider(this)
            val webhookUrl = "$serverUrl/api/v1/webhooks/notifications"

            val disp = NotificationDispatcher(
                dao = dao,
                signer = signer,
                httpClient = httpClient,
                connectivity = connectivity,
                webhookUrl = webhookUrl,
                deviceId = deviceId
            )
            dispatcher = disp

            val wakeLockManager = AndroidWakeLockManager(this)
            val foregroundController = AndroidForegroundController(this)

            interceptor = NotificationInterceptor(
                dao = dao,
                dispatcher = disp,
                wakeLockManager = wakeLockManager,
                foregroundController = foregroundController,
                deviceId = deviceId
            )
            Log.i(TAG, "Pipeline Centinela inicializado exitosamente para caja: $deviceId hacia $webhookUrl")
        } catch (e: Exception) {
            Log.e(TAG, "Error inicializando pipeline Centinela", e)
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return

        val packageName = sbn.packageName ?: return
        if (packageName != "com.nequi.MobileApp" && packageName != "com.davivienda.daviplata") {
            return
        }

        val extras = sbn.notification?.extras ?: return
        val rawTitle = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val rawText = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        Log.i(TAG, "Notificación bancaria detectada de [$packageName]: $rawTitle | $rawText")

        val event = RawNotificationEvent(
            packageName = packageName,
            title = rawTitle,
            text = rawText,
            postTime = sbn.postTime
        )

        if (interceptor == null) {
            initPipeline()
        }

        val result = interceptor?.onNotificationReceived(event)
        Log.i(TAG, "Resultado de intercepción: $result")

        thread {
            try {
                val dispatchResult = dispatcher?.dispatchPending()
                Log.i(TAG, "Resultado de despacho de red: $dispatchResult")
            } catch (e: Exception) {
                Log.e(TAG, "Fallo durante despacho asíncrono", e)
            }
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // No-op
    }
}
