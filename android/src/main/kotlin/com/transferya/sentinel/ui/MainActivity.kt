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
import com.transferya.sentinel.crypto.AndroidKeyStoreVault
import com.transferya.sentinel.onboarding.*
import com.transferya.sentinel.service.SentinelForegroundService
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Almacenamiento persistente de identificadores no secretos en SharedPreferences.
 */
class SharedPreferencesCredentialsStorage(context: Context) : IDeviceCredentialsStorage {
    private val prefs = context.getSharedPreferences("transferya_sentinel_prefs", Context.MODE_PRIVATE)

    override fun getDeviceId(): String? = prefs.getString("device_id", null)
    override fun saveDeviceId(deviceId: String) {
        prefs.edit().putString("device_id", deviceId).apply()
    }
    override fun clearDeviceId() {
        prefs.edit().remove("device_id").apply()
    }

    override fun getMerchantId(): String? = prefs.getString("merchant_id", null)
    override fun saveMerchantId(merchantId: String) {
        prefs.edit().putString("merchant_id", merchantId).apply()
    }
    override fun clearMerchantId() {
        prefs.edit().remove("merchant_id").apply()
    }

    fun getServerUrl(): String = prefs.getString("server_url", "https://transfer-1b8dr7rdh-redfits-projects-6226d031.vercel.app")!!
    fun saveServerUrl(url: String) {
        prefs.edit().putString("server_url", url).apply()
    }
}

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
            val bytes = payload.toByteArray(Charsets.UTF_8)
            os.write(bytes, 0, bytes.size)
        }

        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val responseText = stream?.bufferedReader()?.use { it.readText() } ?: ""

        val isSuccess = responseText.contains("\"success\":true")
        val extractedDeviceId = Regex("\"deviceId\":\"([^\"]+)\"").find(responseText)?.groupValues?.get(1)
        val deviceSecret = Regex("\"deviceSecret\":\"([^\"]+)\"").find(responseText)?.groupValues?.get(1)
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

    private lateinit var statusView: TextView
    private lateinit var enrollButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        credentialsStorage = SharedPreferencesCredentialsStorage(this)
        keyStoreVault = AndroidKeyStoreVault()
        val httpClient = NativeEnrollmentHttpClient { credentialsStorage.getServerUrl() }
        enrollmentManager = DeviceEnrollmentManager(
            httpClient = httpClient,
            keyStoreVault = keyStoreVault,
            credentialsStorage = credentialsStorage
        )

        setupView()
        updateUI()
    }

    override fun onResume() {
        super.onResume()
        updateUI()
    }

    private fun setupView() {
        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 64, 48, 64)
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
            setPadding(0, 8, 0, 32)
        }
        rootLayout.addView(subtitleView)

        statusView = TextView(this).apply {
            textSize = 15f
            setPadding(32, 32, 32, 32)
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#121826"))
        }
        rootLayout.addView(statusView)

        val space1 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 48) }
        rootLayout.addView(space1)

        val permissionButton = Button(this).apply {
            text = "Configurar Permiso de Notificaciones"
            setBackgroundColor(Color.parseColor("#1E293B"))
            setTextColor(Color.WHITE)
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        }
        rootLayout.addView(permissionButton)

        val space2 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 24) }
        rootLayout.addView(space2)

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
        if (state == SentinelState.ACTIVE_SENTINEL) {
            val deviceId = credentialsStorage.getDeviceId() ?: "Desconocido"
            val merchantId = credentialsStorage.getMerchantId() ?: "Desconocido"

            statusView.text = "🟢 DISPOSITIVO EMPAREJADO\n\nCaja ID: $deviceId\nComercio: $merchantId\nFirma: Hardware KeyStore OK\nEscuchando: Nequi & Daviplata"
            statusView.setTextColor(Color.parseColor("#00D26A"))
            enrollButton.text = "Re-emparejar / Cambiar Token"
            startSentinelService()
        } else {
            statusView.text = "🔴 NO EMPAREJADO\n\nEl dispositivo no tiene secreto HMAC configurado.\nGenera un token en tu panel web y presiona Emparejar."
            statusView.setTextColor(Color.parseColor("#F59E0B"))
            enrollButton.text = "⚡ Emparejar Dispositivo (QR / Token)"
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

        // Botón rápido para pegar del portapapeles
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
