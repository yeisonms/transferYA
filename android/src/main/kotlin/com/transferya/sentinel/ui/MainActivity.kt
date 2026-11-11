package com.transferya.sentinel.ui

import android.app.AlertDialog
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import com.transferya.sentinel.crypto.AndroidKeyStoreVault
import com.transferya.sentinel.crypto.HmacSigner
import com.transferya.sentinel.dispatcher.AndroidConnectivityProvider
import com.transferya.sentinel.dispatcher.DispatchResult
import com.transferya.sentinel.dispatcher.NativeSentinelHttpClient
import com.transferya.sentinel.dispatcher.NotificationDispatcher
import com.transferya.sentinel.onboarding.*
import com.transferya.sentinel.service.SentinelForegroundService
import com.transferya.sentinel.service.SentinelNotificationListener
import com.transferya.sentinel.storage.AndroidSqliteNotificationDao
import com.transferya.sentinel.storage.CapturedNotificationEntity
import com.transferya.sentinel.storage.NotificationStatus
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Cliente HTTP nativo para la llamada de intercambio de claves Zero-Trust (ADR-0004).
 */
class NativeEnrollmentHttpClient(private val baseUrlProvider: () -> String) : IEnrollmentHttpClient {
    override fun enroll(token: String, deviceId: String): EnrollmentResponse {
        val baseUrl = baseUrlProvider().trimEnd('/')
        val url = URL("$baseUrl/api/v1/devices/enroll")
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.doOutput = true
        conn.connectTimeout = 10000
        conn.readTimeout = 10000

        val payload = """{"token":"$token","deviceId":"$deviceId"}"""
        conn.outputStream.use { os ->
            os.write(payload.toByteArray(Charsets.UTF_8))
            os.flush()
        }

        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else (conn.errorStream ?: conn.inputStream)
        val responseText = stream?.bufferedReader()?.use { it.readText() } ?: ""

        val isSuccess = responseText.contains("\"success\":true")
        val deviceSecret = Regex("\"deviceSecret\":\"([^\"]+)\"").find(responseText)?.groupValues?.get(1)
        val extractedDeviceId = Regex("\"deviceId\":\"([^\"]+)\"").find(responseText)?.groupValues?.get(1)
        val merchantId = Regex("\"merchantId\":\"([^\"]+)\"").find(responseText)?.groupValues?.get(1)
        val message = Regex("\"message\":\"([^\"]+)\"").find(responseText)?.groupValues?.get(1)
        val error = Regex("\"error\":\"([^\"]+)\"").find(responseText)?.groupValues?.get(1)

        return EnrollmentResponse(
            success = isSuccess && (code in 200..299),
            deviceId = extractedDeviceId,
            deviceSecret = deviceSecret,
            merchantId = merchantId,
            message = message,
            error = error
        )
    }
}

/**
 * Actividad Principal del Dispositivo Centinela (Node A).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var credentialsStorage: SharedPreferencesCredentialsStorage
    private lateinit var keyStoreVault: AndroidKeyStoreVault
    private lateinit var enrollmentManager: DeviceEnrollmentManager
    private lateinit var sqliteDao: AndroidSqliteNotificationDao

    private lateinit var statusView: TextView
    private lateinit var diagnosticView: TextView
    private lateinit var enrollButton: Button
    private lateinit var simulateButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        credentialsStorage = SharedPreferencesCredentialsStorage(this)
        keyStoreVault = AndroidKeyStoreVault(this)
        sqliteDao = AndroidSqliteNotificationDao(this)
        val httpClient = NativeEnrollmentHttpClient { credentialsStorage.getServerUrl() }
        enrollmentManager = DeviceEnrollmentManager(
            httpClient = httpClient,
            keyStoreVault = keyStoreVault,
            credentialsStorage = credentialsStorage
        )

        // Solicitar permiso de notificaciones de sistema en Android 13+ (API 33+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 101)
            }
        }

        setupView()
        updateUI()
    }

    override fun onResume() {
        super.onResume()
        SentinelNotificationListener.rebind(this)
        updateUI()
    }

    private fun setupView() {
        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(Color.parseColor("#090D16"))
        }

        val titleView = TextView(this).apply {
            text = "TransferYA Sentinel ⚡"
            textSize = 24f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        rootLayout.addView(titleView)

        val subtitleView = TextView(this).apply {
            text = "Nodo A: Ingesta de Pagos en Tiempo Real"
            textSize = 14f
            setTextColor(Color.parseColor("#9CA3AF"))
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 24)
        }
        rootLayout.addView(subtitleView)

        statusView = TextView(this).apply {
            textSize = 14f
            setPadding(28, 24, 28, 24)
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#121826"))
        }
        rootLayout.addView(statusView)

        val space0 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 16) }
        rootLayout.addView(space0)

        diagnosticView = TextView(this).apply {
            textSize = 13f
            setPadding(28, 20, 28, 20)
            gravity = Gravity.START
            setBackgroundColor(Color.parseColor("#172033"))
            setOnClickListener {
                SentinelNotificationListener.forceRebind(this@MainActivity)
                Toast.makeText(this@MainActivity, "🔄 Re-conectando escucha con el sistema...", Toast.LENGTH_SHORT).show()
                postDelayed({ updateUI() }, 1000)
            }
        }
        rootLayout.addView(diagnosticView)

        val space1 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 32) }
        rootLayout.addView(space1)

        val permissionButton = Button(this).apply {
            text = "🔔 Reconectar Permiso de Notificaciones"
            setBackgroundColor(Color.parseColor("#1E293B"))
            setTextColor(Color.WHITE)
            setOnClickListener {
                SentinelNotificationListener.forceRebind(this@MainActivity)
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        }
        rootLayout.addView(permissionButton)

        val space2 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 16) }
        rootLayout.addView(space2)

        val batteryButton = Button(this).apply {
            text = "🔋 Batería e Inicio Automático (Xiaomi/OEM)"
            setBackgroundColor(Color.parseColor("#334155"))
            setTextColor(Color.WHITE)
            setOnClickListener {
                try {
                    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = android.net.Uri.fromParts("package", packageName, null)
                    }
                    startActivity(intent)
                } catch (_: Exception) {
                    startActivity(Intent(Settings.ACTION_SETTINGS))
                }
            }
        }
        rootLayout.addView(batteryButton)

        val space2b = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 16) }
        rootLayout.addView(space2b)

        simulateButton = Button(this).apply {
            text = "🧪 Simular Notificación Nequi (Aleatorio)"
            setBackgroundColor(Color.parseColor("#2563EB"))
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            setOnClickListener {
                simulateIncomingPayment()
            }
        }
        rootLayout.addView(simulateButton)

        val space3 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 16) }
        rootLayout.addView(space3)

        enrollButton = Button(this).apply {
            text = "⚡ Emparejar Dispositivo (QR / Token)"
            setBackgroundColor(Color.parseColor("#00D26A"))
            setTextColor(Color.parseColor("#090D16"))
            setTypeface(null, Typeface.BOLD)
            setOnClickListener {
                showEnrollmentDialog()
            }
        }
        rootLayout.addView(enrollButton)

        setContentView(rootLayout)
    }

    private fun updateUI() {
        val state = enrollmentManager.getSentinelState()
        val isPermGranted = NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)

        val pendingCount = sqliteDao.getCountByStatus(NotificationStatus.PENDING)
        val dispatchedCount = sqliteDao.getCountByStatus(NotificationStatus.DISPATCHED)

        val powerManager = getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
        val isIgnoringBattery = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && powerManager != null) {
            powerManager.isIgnoringBatteryOptimizations(packageName)
        } else true

        if (state == SentinelState.ACTIVE_SENTINEL) {
            val deviceId = credentialsStorage.getDeviceId() ?: "Desconocido"
            val merchantId = credentialsStorage.getMerchantId() ?: "Desconocido"

            statusView.text = "🟢 DISPOSITIVO EMPAREJADO\n\nCaja ID: $deviceId\nComercio: $merchantId\nFirma: Hardware KeyStore OK"
            statusView.setTextColor(Color.parseColor("#00D26A"))
            enrollButton.text = "Re-emparejar / Cambiar Token"
            startSentinelService()
        } else {
            statusView.text = "🔴 NO EMPAREJADO\n\nEl dispositivo no tiene secreto HMAC configurado.\nGenera un token en tu panel web y presiona Emparejar."
            statusView.setTextColor(Color.parseColor("#F59E0B"))
            enrollButton.text = "⚡ Emparejar Dispositivo (QR / Token)"
        }

        val isListenerBound = SentinelNotificationListener.isConnected
        val listenerText = if (isListenerBound) "🟢 VINCULADO (Recibiendo)" else "🔴 DESCONECTADO (Toca para Reconectar)"
        val permText = if (isPermGranted) "✅ ACTIVO" else "⚠️ DESACTIVADO (Requiere activación en Ajustes)"
        val batteryText = if (isIgnoringBattery) "✅ Sin Restricciones" else "⚠️ 'Sin Restricciones' Requerido"

        diagnosticView.text = "Diagnóstico en Vivo:\n• Permiso Android: $permText\n• Enlace del Sistema: $listenerText\n• Batería OEM: $batteryText\n• Cola Local SQLite: $pendingCount pendientes / $dispatchedCount enviados"
        diagnosticView.setTextColor(Color.parseColor(if (isPermGranted && isListenerBound && isIgnoringBattery) "#00D26A" else "#F59E0B"))
    }

    private fun simulateIncomingPayment() {
        val state = enrollmentManager.getSentinelState()
        if (state != SentinelState.ACTIVE_SENTINEL) {
            Toast.makeText(this, "Empareja el dispositivo primero", Toast.LENGTH_SHORT).show()
            return
        }

        val deviceId = credentialsStorage.getDeviceId() ?: return
        val serverUrl = credentialsStorage.getServerUrl()

        val progress = AlertDialog.Builder(this)
            .setTitle("Simulando Notificación...")
            .setMessage("Firmando con Hardware KeyStore y enviando al Webhook de Vercel...")
            .setCancelable(false)
            .create()
        progress.show()

        thread {
            try {
                val signer = HmacSigner(keyStoreVault, DeviceEnrollmentManager.KEYSTORE_ALIAS_SECRET)
                val httpClient = NativeSentinelHttpClient()
                val connectivity = AndroidConnectivityProvider(this)
                val webhookUrl = "$serverUrl/api/v1/webhooks/notifications"

                val dispatcher = NotificationDispatcher(
                    dao = sqliteDao,
                    signer = signer,
                    httpClient = httpClient,
                    connectivity = connectivity,
                    webhookUrl = webhookUrl,
                    deviceId = deviceId
                )

                val ref = "M" + (System.currentTimeMillis() % 100000000).toString()
                val amounts = listOf(5000, 10000, 15000, 20000, 25000, 50000, 80000, 100000)
                val simAmount = amounts.random()
                val formattedAmount = java.text.NumberFormat.getNumberInstance(java.util.Locale("es", "CO")).format(simAmount)
                val senders = listOf("Carlos Perez", "Maria Lopez", "Andres Gomez", "Laura Restrepo", "Juan Martinez")
                val simSender = senders.random()
                val entity = CapturedNotificationEntity(
                    deviceId = deviceId,
                    walletPackage = "com.nequi.MobileApp",
                    rawTitle = "Nequi",
                    rawText = "$simSender te envió $formattedAmount, ¡lo mejor!",
                    capturedAt = System.currentTimeMillis()
                )

                sqliteDao.insertPending(entity)
                val dispatchResult = dispatcher.dispatchPending()

                runOnUiThread {
                    progress.dismiss()
                    updateUI()
                    when (dispatchResult) {
                        is DispatchResult.Success -> {
                            AlertDialog.Builder(this)
                                .setTitle("✅ ¡Simulación Exitosa!")
                                .setMessage("La notificación se firmó con tu KeyStore y fue ACEPTADA por Vercel (HTTP 202).\n\nDe: $simSender\nMonto: \$$formattedAmount COP\n\nRevisa la tabla captured_notifications en Supabase o tu WhatsApp.")
                                .setPositiveButton("Aceptar", null)
                                .show()
                        }
                        is DispatchResult.Retry -> {
                            AlertDialog.Builder(this)
                                .setTitle("⚠️ Reintento Requerido")
                                .setMessage("El servidor respondió con fallo recuperable:\n${dispatchResult.reason}")
                                .setPositiveButton("Aceptar", null)
                                .show()
                        }
                        is DispatchResult.FatalFailure -> {
                            AlertDialog.Builder(this)
                                .setTitle("❌ Error en Despacho")
                                .setMessage("Fallo fatal:\n${dispatchResult.reason}")
                                .setPositiveButton("Aceptar", null)
                                .show()
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    progress.dismiss()
                    updateUI()
                    AlertDialog.Builder(this)
                        .setTitle("❌ Error en Simulación")
                        .setMessage("Excepción: ${e.message}")
                        .setPositiveButton("Aceptar", null)
                        .show()
                }
            }
        }
    }

    private fun showEnrollmentDialog() {
        val dialogLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 32, 48, 16)
        }

        val hintText = TextView(this).apply {
            text = "Pega aquí el URI o Token generado en el panel web de TransferYA:"
            textSize = 14f
            setPadding(0, 0, 0, 16)
        }
        dialogLayout.addView(hintText)

        val tokenInput = EditText(this).apply {
            hint = "transferya://enroll?token=... o Token Hex"
            textSize = 14f
        }
        dialogLayout.addView(tokenInput)

        val pasteBtn = Button(this).apply {
            text = "📋 Pegar del Portapapeles"
            setOnClickListener {
                val clipService = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clipData = clipService.primaryClip
                if (clipData != null && clipData.itemCount > 0) {
                    val pastedText = clipData.getItemAt(0).text?.toString() ?: ""
                    tokenInput.setText(pastedText)
                }
            }
        }
        dialogLayout.addView(pasteBtn)

        val serverLabel = TextView(this).apply {
            text = "\nURL del Servidor Vercel:"
            textSize = 12f
        }
        dialogLayout.addView(serverLabel)

        val serverInput = EditText(this).apply {
            setText(credentialsStorage.getServerUrl())
            textSize = 13f
        }
        dialogLayout.addView(serverInput)

        AlertDialog.Builder(this)
            .setTitle("Emparejamiento Zero-Trust")
            .setView(dialogLayout)
            .setPositiveButton("Emparejar") { _, _ ->
                val rawInput = tokenInput.text.toString().trim()
                val serverUrl = serverInput.text.toString().trim()

                if (rawInput.isBlank()) {
                    Toast.makeText(this, "Ingresa un Token o URI válido", Toast.LENGTH_LONG).show()
                    return@setPositiveButton
                }

                credentialsStorage.saveServerUrl(serverUrl)

                val uriToProcess = if (!rawInput.startsWith("transferya://enroll?")) {
                    "transferya://enroll?token=$rawInput&deviceId=dev_centinela_caja_1"
                } else {
                    rawInput
                }

                processEnrollment(uriToProcess)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun processEnrollment(uri: String) {
        val progressDialog = AlertDialog.Builder(this)
            .setTitle("Conectando con Servidor...")
            .setMessage("Intercambiando claves criptográficas de forma segura...")
            .setCancelable(false)
            .create()
        progressDialog.show()

        thread {
            val result = enrollmentManager.enrollFromQr(uri)
            runOnUiThread {
                progressDialog.dismiss()
                if (result.isSuccess) {
                    AlertDialog.Builder(this)
                        .setTitle("✅ ¡Emparejamiento Exitoso!")
                        .setMessage("Dispositivo: ${result.deviceId}\nComercio: ${result.merchantId}\n\nEl secreto criptográfico se ha guardado en el hardware seguro del teléfono.")
                        .setPositiveButton("Aceptar") { _, _ ->
                            updateUI()
                        }
                        .show()
                } else {
                    AlertDialog.Builder(this)
                        .setTitle("❌ Fallo de Emparejamiento")
                        .setMessage(result.errorMessage ?: "No se pudo completar el intercambio de claves.")
                        .setPositiveButton("Reintentar", null)
                        .show()
                }
            }
        }
    }

    private fun startSentinelService() {
        val intent = Intent(this, SentinelForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }
}
