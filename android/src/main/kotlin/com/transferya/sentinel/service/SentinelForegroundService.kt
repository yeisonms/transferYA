package com.transferya.sentinel.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.transferya.sentinel.crypto.AndroidKeyStoreVault
import com.transferya.sentinel.crypto.HmacSigner
import com.transferya.sentinel.dispatcher.AndroidConnectivityProvider
import com.transferya.sentinel.dispatcher.NativeSentinelHttpClient
import com.transferya.sentinel.onboarding.DeviceEnrollmentManager
import com.transferya.sentinel.onboarding.SharedPreferencesCredentialsStorage
import com.transferya.sentinel.telemetry.AndroidDeviceStatusProvider
import com.transferya.sentinel.telemetry.HeartbeatCoordinator
import com.transferya.sentinel.telemetry.HeartbeatEmitter
import com.transferya.sentinel.ui.MainActivity
import kotlin.concurrent.thread

/**
 * Servicio Foreground persistente para mitigar agresividad de batería OEM (ADR-0003).
 */
class SentinelForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "transferya_sentinel_channel"
        const val NOTIFICATION_ID = 1001
        const val ACTION_TRIGGER_HEARTBEAT = "com.transferya.sentinel.ACTION_TRIGGER_HEARTBEAT"
        private const val TAG = "SentinelForeground"

        fun triggerImmediateHeartbeat(context: Context) {
            try {
                val intent = Intent(context, SentinelForegroundService::class.java).apply {
                    action = ACTION_TRIGGER_HEARTBEAT
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                Log.w(TAG, "No se pudo disparar heartbeat inmediato: ${e.message}")
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Iniciando SentinelForegroundService en primer plano")
        createNotificationChannel()
        val notification = buildForegroundNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        startWatchdog()
    }

    private var watchdogRunning = true
    private val heartbeatLock = Any()
    private val heartbeatCoordinator = HeartbeatCoordinator()

    private fun startWatchdog() {
        thread(start = true, isDaemon = true) {
            while (watchdogRunning) {
                try {
                    emitHeartbeatIfDue(force = false)
                    Thread.sleep(10000)
                    if (!SentinelNotificationListener.isConnected) {
                        Log.w(TAG, "Watchdog: NotificationListener desconectado. Forzando re-conexión...")
                        SentinelNotificationListener.forceRebind(applicationContext)
                    }
                } catch (_: InterruptedException) {
                    break
                } catch (e: Exception) {
                    Log.e(TAG, "Error en watchdog de listener / heartbeat", e)
                }
            }
        }
    }

    private fun emitHeartbeatIfDue(force: Boolean) {
        synchronized(heartbeatLock) {
            val credentials = SharedPreferencesCredentialsStorage(applicationContext)
            val deviceId = credentials.getDeviceId()
            val keyStoreVault = AndroidKeyStoreVault(applicationContext)
            if (deviceId.isNullOrBlank() || !keyStoreVault.hasSecret(DeviceEnrollmentManager.KEYSTORE_ALIAS_SECRET)) {
                return
            }

            val connectivity = AndroidConnectivityProvider(applicationContext)
            if (!connectivity.isConnected()) {
                return
            }

            heartbeatCoordinator.runIfDue(force = force) {
                val serverUrl = credentials.getServerUrl()
                val signer = HmacSigner(keyStoreVault, DeviceEnrollmentManager.KEYSTORE_ALIAS_SECRET)
                val statusProvider = AndroidDeviceStatusProvider(applicationContext)
                val emitter = HeartbeatEmitter(
                    deviceStatusProvider = statusProvider,
                    signer = signer,
                    httpClient = NativeSentinelHttpClient(),
                    heartbeatUrl = "$serverUrl/api/v1/devices/heartbeat",
                    deviceId = deviceId
                )
                val ok = emitter.emitHeartbeat()
                if (ok) {
                    credentials.saveLastHeartbeatAt(System.currentTimeMillis())
                    Log.i(TAG, "Heartbeat ONLINE confirmado para caja $deviceId")
                } else {
                    Log.w(TAG, "Fallo enviando heartbeat para caja $deviceId")
                }
                ok
            }
        }
    }

    override fun onDestroy() {
        watchdogRunning = false
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "SentinelForegroundService recibido onStartCommand (action=${intent?.action})")
        if (intent?.action == ACTION_TRIGGER_HEARTBEAT) {
            thread(start = true, isDaemon = true) {
                try {
                    emitHeartbeatIfDue(force = true)
                } catch (e: Exception) {
                    Log.w(TAG, "Error en heartbeat inmediato: ${e.message}")
                }
            }
        }
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.i(TAG, "onTaskRemoved: app cerrada en recientes. Asegurando persistencia de servicio.")
        try {
            val restartIntent = Intent(applicationContext, SentinelForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                applicationContext.startForegroundService(restartIntent)
            } else {
                applicationContext.startService(restartIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error relanzando servicio en onTaskRemoved", e)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "TransferYA Sentinel Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Monitoreo en tiempo real de notificaciones bancarias de caja"
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildForegroundNotification(): Notification {
        val launchIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle("TransferYA Centinela Activo ⚡")
            .setContentText("Escuchando pagos de Nequi y Daviplata en segundo plano")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }
}

