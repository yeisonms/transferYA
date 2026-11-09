package com.transferya.sentinel.service

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.transferya.sentinel.interceptor.NotificationInterceptor
import com.transferya.sentinel.interceptor.RawNotificationEvent

/**
 * Servicio de escucha de notificaciones de Android (Node A).
 * Intercepta notificaciones de Nequi y Daviplata en segundo plano (Ticket 06 / ADR-0003).
 */
class SentinelNotificationListener : NotificationListenerService() {

    private var interceptor: NotificationInterceptor? = null

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return

        val packageName = sbn.packageName ?: return
        if (packageName != "com.nequi.MobileApp" && packageName != "com.davivienda.daviplata") {
            return
        }

        val extras = sbn.notification?.extras ?: return
        val rawTitle = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val rawText = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        val event = RawNotificationEvent(
            packageName = packageName,
            title = rawTitle,
            text = rawText,
            postTime = sbn.postTime
        )

        interceptor?.onNotificationReceived(event)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // No-op
    }
}
