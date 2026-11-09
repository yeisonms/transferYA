package com.transferya.sentinel.ui

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Actividad Principal del Dispositivo Centinela (Node A).
 * Permite verificar permisos del NotificationListener y realizar el emparejamiento QR Zero-Trust.
 */
class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Vista programática simple para evitar layouts XML pesados
        val rootLayout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 64, 48, 64)
            gravity = android.view.Gravity.CENTER_HORIZONTAL
        }

        val titleView = TextView(this).apply {
            text = "TransferYA Sentinel ⚡"
            textSize = 24f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.WHITE)
            gravity = android.view.Gravity.CENTER
        }
        rootLayout.addView(titleView)

        val statusView = TextView(this).apply {
            text = "\nEstado: Listo para Monitorear Pagos\nBilleteras: Nequi & Daviplata\n"
            textSize = 16f
            setTextColor(android.graphics.Color.LTGRAY)
            gravity = android.view.Gravity.CENTER
        }
        rootLayout.addView(statusView)

        val permissionButton = Button(this).apply {
            text = "Configurar Permiso de Notificaciones"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        }
        rootLayout.addView(permissionButton)

        val enrollButton = Button(this).apply {
            text = "Escanear QR de Enrolamiento Zero-Trust"
            setOnClickListener {
                // Abre cámara o lector QR para escanear el token de enrolamiento
            }
        }
        rootLayout.addView(enrollButton)

        setContentView(rootLayout)
    }
}

