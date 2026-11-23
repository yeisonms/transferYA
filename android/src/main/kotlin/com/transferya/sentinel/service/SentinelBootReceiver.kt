package com.transferya.sentinel.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.transferya.sentinel.onboarding.SharedPreferencesCredentialsStorage

/**
 * Receptor de arranque del sistema operativo (BOOT_COMPLETED / MY_PACKAGE_REPLACED).
 * Garantiza que cuando el teléfono se reinicia o enciende, el Centinela reactive
 * automáticamente su servicio en primer plano y re-enganche la escucha de pagos bancarios
 * sin necesidad de que el comerciante abra manualmente la aplicación.
 */
class SentinelBootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SentinelBootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        Log.i(TAG, "Broadcast de arranque recibido: $action")

        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == "com.htc.intent.action.QUICKBOOT_POWERON" ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            val credentialsStorage = SharedPreferencesCredentialsStorage(context)
            val deviceId = credentialsStorage.getDeviceId()

            if (!deviceId.isNullOrBlank()) {
                Log.i(TAG, "Dispositivo enrolado ($deviceId). Iniciando SentinelForegroundService en arranque...")
                try {
                    val serviceIntent = Intent(context, SentinelForegroundService::class.java)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent)
                    } else {
                        context.startService(serviceIntent)
                    }
                    // Forzar rebind del NotificationListenerService con el SO
                    SentinelNotificationListener.rebind(context)
                } catch (e: Exception) {
                    Log.e(TAG, "Error iniciando Centinela tras arranque", e)
                }
            } else {
                Log.d(TAG, "Dispositivo no enrolado aún; omitiendo arranque automático.")
            }
        }
    }
}
