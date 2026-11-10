package com.transferya.sentinel.interceptor

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import com.transferya.sentinel.service.SentinelForegroundService
import java.util.concurrent.ConcurrentHashMap

/**
 * Gestor de WakeLock para garantizar tiempo de CPU en modo Doze (ADR-0003).
 */
class AndroidWakeLockManager(private val context: Context) : IWakeLockManager {
    private val activeLocks = ConcurrentHashMap<String, PowerManager.WakeLock>()

    override fun acquirePartialWakeLock(tag: String, timeoutMs: Long) {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        val wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, tag)
        wakeLock.acquire(timeoutMs)
        activeLocks[tag] = wakeLock
    }

    override fun releaseWakeLock(tag: String) {
        activeLocks.remove(tag)?.let {
            if (it.isHeld) it.release()
        }
    }

    override fun isHeld(tag: String): Boolean = activeLocks[tag]?.isHeld == true
}

/**
 * Controlador de servicio Foreground para mitigar agresividad de batería en Xiaomi / Samsung.
 */
class AndroidForegroundController(private val context: Context) : IForegroundServiceController {
    private var running = false

    override fun startForegroundService(notificationTitle: String, notificationText: String) {
        val intent = Intent(context, SentinelForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        running = true
    }

    override fun stopForegroundService() {
        val intent = Intent(context, SentinelForegroundService::class.java)
        context.stopService(intent)
        running = false
    }

    override fun isRunning(): Boolean = running
}

