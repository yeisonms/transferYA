package com.transferya.sentinel.service

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.transferya.sentinel.audio.VoiceAlertManager
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

        val SUPPORTED_PACKAGES = setOf(
            "com.nequi.MobileApp",
            "com.daviplata.appfintech",
            "com.davivienda.daviplata",
            "com.davivienda.daviplataapp",
            "com.davivienda.bancamovil",
            "com.bancolombia.personas",
            "com.bancolombia.mimovil"
        )

        fun isSupportedPackage(packageName: String?): Boolean {
            if (packageName.isNullOrBlank()) return false
            if (SUPPORTED_PACKAGES.contains(packageName)) return true
            val lower = packageName.lowercase()
            if (lower.contains("daviplata") || lower.contains("nequi") || lower.contains("bancolombia")) return true
            return NotificationFilter.isSmsPackage(packageName)
        }

        @Volatile
        var isConnected: Boolean = false

        @Volatile
        private var activeInstance: SentinelNotificationListener? = null

        fun reinitializeIfConnected(context: Context) {
            try {
                activeInstance?.ensurePipelineFresh()
                scanActiveNotifications()
            } catch (e: Exception) {
                Log.w(TAG, "reinitializeIfConnected warning: ${e.message}")
            }
            forceRebind(context)
        }

        fun scanActiveNotifications() {
            try {
                activeInstance?.scanAndProcessActiveNotifications()
            } catch (e: Exception) {
                Log.e(TAG, "Error invocando scanActiveNotifications", e)
            }
        }

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
    private var initializedDeviceId: String? = null

    override fun onCreate() {
        super.onCreate()
        activeInstance = this
        ensurePipelineFresh()
        try {
            VoiceAlertManager.initialize(this)
        } catch (e: Exception) {
            Log.w(TAG, "Error inicializando VoiceAlertManager: ${e.message}")
        }
    }

    override fun onDestroy() {
        if (activeInstance === this) {
            activeInstance = null
        }
        super.onDestroy()
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        activeInstance = this
        isConnected = true
        Log.i(TAG, "NotificationListener conectado con el sistema operativo")
        ensurePipelineFresh()
        thread {
            try {
                // 1. Escanear y rescatar notificaciones activas que llegaron mientras el servicio estuvo desconectado
                scanAndProcessActiveNotifications()
                // 2. Despachar la cola local SQLite hacia el backend
                dispatcher?.dispatchPending()
            } catch (e: Exception) {
                Log.e(TAG, "Error despachando notificaciones al conectar", e)
            }
        }
    }

    /**
     * Inspecciona activamente la barra de notificaciones del sistema para rescatar
     * notificaciones bancarias que llegaron mientras el Centinela estuvo desconectado (ADR-0003).
     */
    fun scanAndProcessActiveNotifications() {
        try {
            val activeNotifications = getActiveNotifications() ?: return
            Log.i(TAG, "Escaneando ${activeNotifications.size} notificaciones activas en el sistema...")
            val dao = AndroidSqliteNotificationDao(this)
            for (sbn in activeNotifications) {
                if (sbn != null && isSupportedPackage(sbn.packageName)) {
                    val notification = sbn.notification ?: continue
                    val extras = notification.extras ?: continue
                    val rawTitle = (extras.getCharSequence(Notification.EXTRA_TITLE)
                        ?: extras.getCharSequence("android.title.big")
                        ?: notification.tickerText)?.toString() ?: ""

                    val textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
                        ?.filterNotNull()
                        ?.joinToString(" ") ?: ""

                    val rawText = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                        ?: if (textLines.isNotBlank()) textLines else null
                        ?: extras.getCharSequence(Notification.EXTRA_TEXT)
                        ?: extras.getCharSequence(Notification.EXTRA_SUB_TEXT)
                        ?: notification.tickerText)?.toString() ?: ""

                    if (!NotificationFilter.shouldProcess(notification.flags, rawTitle, rawText)) {
                        continue
                    }

                    val isSms = NotificationFilter.isSmsPackage(sbn.packageName)
                    if (isSms && !NotificationFilter.isBankingSms(rawTitle, rawText)) {
                        Log.d(TAG, "Notificación SMS activa descartada por no ser alerta bancaria oficial: $rawTitle")
                        continue
                    }

                    val effectivePackage = if (isSms) NotificationFilter.resolveBankingPackageForSms(rawTitle, rawText) else sbn.packageName

                    if (dao.exists(effectivePackage, rawTitle, rawText, sbn.postTime)) {
                        Log.d(TAG, "Notificación activa ya registrada previamente en SQLite: $rawTitle | $rawText")
                        continue
                    }

                    Log.i(TAG, "Procesando retroactivamente notificación bancaria represada de [$effectivePackage] (origen: ${sbn.packageName}): $rawTitle | $rawText")
                    processNotification(sbn, isLiveEvent = false)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error escaneando notificaciones activas represadas", e)
        }
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        isConnected = false
        Log.w(TAG, "NotificationListener desconectado por el sistema operativo. Solicitando re-conexión inmediata...")
        rebind(this)
    }

    @Synchronized
    fun ensurePipelineFresh() {
        val currentDeviceId = SharedPreferencesCredentialsStorage(this).getDeviceId()
        if (interceptor == null || dispatcher == null || initializedDeviceId != currentDeviceId) {
            initPipeline()
        }
    }

    @Synchronized
    private fun initPipeline() {
        try {
            val credentialsStorage = SharedPreferencesCredentialsStorage(this)
            val deviceId = credentialsStorage.getDeviceId()
            val serverUrl = credentialsStorage.getServerUrl()
            val keyStoreVault = AndroidKeyStoreVault(this)

            if (deviceId.isNullOrBlank() || !keyStoreVault.hasSecret(DeviceEnrollmentManager.KEYSTORE_ALIAS_SECRET)) {
                interceptor = null
                dispatcher = null
                initializedDeviceId = null
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
            initializedDeviceId = deviceId
            Log.i(TAG, "Pipeline Centinela inicializado exitosamente para caja: $deviceId hacia $webhookUrl")
        } catch (e: Exception) {
            Log.e(TAG, "Error inicializando pipeline Centinela", e)
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        processNotification(sbn, isLiveEvent = true)
    }

    private fun processNotification(sbn: StatusBarNotification?, isLiveEvent: Boolean) {
        if (sbn == null) return

        val packageName = sbn.packageName ?: return
        if (!isSupportedPackage(packageName)) {
            return
        }

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return
        val rawTitle = (extras.getCharSequence(Notification.EXTRA_TITLE)
            ?: extras.getCharSequence("android.title.big")
            ?: notification.tickerText)?.toString() ?: ""

        val textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.filterNotNull()
            ?.joinToString(" ") ?: ""

        val rawText = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: if (textLines.isNotBlank()) textLines else null
            ?: extras.getCharSequence(Notification.EXTRA_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_SUB_TEXT)
            ?: notification.tickerText)?.toString() ?: ""

        // Descartar resúmenes de grupo (FLAG_GROUP_SUMMARY) y notificaciones vacías sin texto útil
        if (!NotificationFilter.shouldProcess(notification.flags, rawTitle, rawText)) {
            Log.d(TAG, "Notificación descartada por filtro previo (flags=${notification.flags}, vacía o grupo)")
            return
        }

        val isSms = NotificationFilter.isSmsPackage(packageName)
        if (isSms && !NotificationFilter.isBankingSms(rawTitle, rawText)) {
            Log.d(TAG, "Notificación SMS descartada por no ser alerta bancaria oficial: $rawTitle")
            return
        }

        val effectivePackage = if (isSms) NotificationFilter.resolveBankingPackageForSms(rawTitle, rawText) else packageName

        // Ticket 21: Bloqueo comercial Centinela (Kill-Switch local)
        val credentials = SharedPreferencesCredentialsStorage(this)
        val subStatus = credentials.getSubscriptionStatus()
        if (subStatus == "PAST_DUE" || subStatus == "SUSPENDED") {
            Log.w(TAG, "Notificación bancaria ignorada: servicio suspendido comercialmente ($subStatus). Abortando captura y despacho.")
            return
        }

        Log.i(TAG, "Notificación bancaria detectada de [$effectivePackage] (origen: $packageName): $rawTitle | $rawText")

        val event = RawNotificationEvent(
            packageName = effectivePackage,
            title = rawTitle,
            text = rawText,
            postTime = sbn.postTime
        )

        ensurePipelineFresh()

        // Fase 1: Anuncio sonoro y de voz en segundo plano (Soundbox nativo)
        // REGLA ESTRICTA: Solo sonar y cantar en voz alta si es un evento EN VIVO (< 90 segundos de antigüedad)
        // Las notificaciones represadas o históricas se procesan silenciosamente hacia el backend.
        val ageMs = System.currentTimeMillis() - sbn.postTime
        val effectiveIsLive = isLiveEvent && (ageMs in -5_000L..90_000L)

        if (effectiveIsLive) {
            try {
                VoiceAlertManager.handleIncomingNotification(this, effectivePackage, rawTitle, rawText, isLive = true)
            } catch (e: Exception) {
                Log.e(TAG, "Error disparando alerta sonora de pago", e)
            }
        } else {
            Log.d(TAG, "Notificación histórica o represada omitida de alerta sonora (antigüedad: ${ageMs / 1000}s, isLiveParam=$isLiveEvent)")
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
