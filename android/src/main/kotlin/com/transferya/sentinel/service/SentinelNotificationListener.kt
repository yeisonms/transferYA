package com.transferya.sentinel.service

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
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
import com.transferya.sentinel.interceptor.NotificationFilter
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

        @Volatile
        var isConnected: Boolean = false

        fun rebind(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    val component = ComponentName(context, SentinelNotificationListener::class.java)
                    requestRebind(component)
                    Log.i(TAG, "requestRebind invocado exitosamente")
                } catch (e: Exception) {
                    Log.w(TAG, "requestRebind falló: ${e.message}")
                }
            }
        }

        fun forceRebind(context: Context) {
            try {
                val component = ComponentName(context, SentinelNotificationListener::class.java)
                val pm = context.packageManager
                pm.setComponentEnabledSetting(
                    component,
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
                )
                pm.setComponentEnabledSetting(
                    component,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP
                )
                rebind(context)
                Log.i(TAG, "forceRebind completado para re-enganchar NotificationListener en MIUI")
            } catch (e: Exception) {
                Log.e(TAG, "Error en forceRebind", e)
            }
        }
    }

    private var interceptor: NotificationInterceptor? = null
    private var dispatcher: NotificationDispatcher? = null

    override fun onCreate() {
        super.onCreate()
        initPipeline()
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        isConnected = true
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

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        isConnected = false
        Log.w(TAG, "NotificationListener desconectado por el sistema operativo. Solicitando re-conexión inmediata...")
        rebind(this)
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
                dispatcher = null,
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

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return
        val rawTitle = (extras.getCharSequence(Notification.EXTRA_TITLE)
            ?: extras.getCharSequence("android.title.big")
            ?: notification.tickerText)?.toString() ?: ""

        val rawText = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_SUB_TEXT)
            ?: notification.tickerText)?.toString() ?: ""

        // Descartar resúmenes de grupo (FLAG_GROUP_SUMMARY) y notificaciones vacías sin texto útil
        if (!NotificationFilter.shouldProcess(notification.flags, rawTitle, rawText)) {
            Log.d(TAG, "Notificación descartada por filtro previo (flags=${notification.flags}, vacía o grupo)")
            return
        }

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
