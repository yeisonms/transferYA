package com.transferya.sentinel.ui

import android.Manifest
import android.app.AlertDialog
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeEncoder
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
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
    private lateinit var manualEnrollButton: Button
    private lateinit var simulateButton: Button

    private lateinit var operationalContainer: LinearLayout
    private lateinit var commercialLockContainer: LinearLayout
    private lateinit var lockTitleView: TextView
    private lateinit var lockMessageView: TextView
    private lateinit var lockAmountView: TextView
    private lateinit var lockQrImageView: ImageView
    private lateinit var recheckButton: Button

    private val qrParser = TransferYaQrParser()

    private val qrScanLauncher = registerForActivityResult(ScanContract()) { result ->
        val rawContent = result.contents?.trim()
        if (rawContent.isNullOrBlank()) {
            Toast.makeText(this, "Escaneo QR cancelado", Toast.LENGTH_SHORT).show()
            return@registerForActivityResult
        }

        val parsed = qrParser.parse(rawContent)
        if (parsed == null) {
            AlertDialog.Builder(this)
                .setTitle("Código QR no válido")
                .setMessage("El código escaneado no corresponde a un token de TransferYA.\n\nAsegúrate de apuntar al código QR generado en la sección Dispositivos Centinela del panel web.")
                .setPositiveButton("Reintentar Escaneo") { _, _ -> startQrEnrollmentFlow() }
                .setNeutralButton("Token Manual") { _, _ -> showManualEnrollmentDialog() }
                .setNegativeButton("Cancelar", null)
                .show()
            return@registerForActivityResult
        }

        processEnrollment(rawContent)
    }

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            launchQrScanner()
        } else {
            AlertDialog.Builder(this)
                .setTitle("Permiso de Cámara Requerido")
                .setMessage("Se necesita acceso a la cámara para escanear el QR de vinculación sin escribir tokens.\n\nTambién puedes pegar el token manualmente si lo prefieres.")
                .setPositiveButton("Token Manual") { _, _ -> showManualEnrollmentDialog() }
                .setNegativeButton("Cancelar", null)
                .show()
        }
    }

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
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
            }
        }

        setupView()
        updateUI()
        handleIncomingDeepLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingDeepLink(intent)
    }

    override fun onResume() {
        super.onResume()
        SentinelNotificationListener.rebind(this)
        if (enrollmentManager.getSentinelState() == SentinelState.ACTIVE_SENTINEL) {
            val lastPing = credentialsStorage.getLastHeartbeatAt()
            if (lastPing <= 0L || (System.currentTimeMillis() - lastPing) >= 60_000L) {
                SentinelForegroundService.triggerImmediateHeartbeat(this)
            }
        }
        updateUI()
    }

    private fun setupView() {
        val scrollWrapper = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Color.parseColor("#090D16"))
        }

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(Color.parseColor("#090D16"))
        }

        val logoView = ImageView(this).apply {
            setImageResource(com.transferya.sentinel.R.drawable.transferya_centinela_master)
            layoutParams = LinearLayout.LayoutParams(160, 160).apply {
                bottomMargin = 16
            }
        }
        rootLayout.addView(logoView)

        val titleView = TextView(this).apply {
            text = "transferYA Centinela"
            textSize = 26f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        rootLayout.addView(titleView)

        val subtitleView = TextView(this).apply {
            text = "RECEPTOR EN SEGUNDO PLANO • NEQUI Y DAVIPLATA"
            textSize = 10f
            setTextColor(Color.parseColor("#00E5FF"))
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, 4, 0, 24)
        }
        rootLayout.addView(subtitleView)

        // =====================================================================
        // CONTENEDOR 1: PANTALLA ROJA DE BLOQUEO COMERCIAL (Ticket 21 / QR Nequi)
        // =====================================================================
        commercialLockContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(32, 32, 32, 32)
            setBackgroundColor(Color.parseColor("#1C0A0A"))
            visibility = View.GONE
        }

        lockTitleView = TextView(this).apply {
            text = "⚠️ SERVICIO SUSPENDIDO — PLAN VENCIDO"
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#EF4444"))
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 16)
        }
        commercialLockContainer.addView(lockTitleView)

        lockMessageView = TextView(this).apply {
            text = "Tu suscripción a TransferYA ha finalizado. Los cajeros no están recibiendo confirmaciones de pago en WhatsApp.\n\nPara reactivar el servicio de inmediato, escanea el código QR desde Nequi o transfiere la mensualidad a MurSat Solutions:"
            textSize = 13f
            setTextColor(Color.parseColor("#E2E8F0"))
            gravity = Gravity.CENTER
            setLineSpacing(4f, 1.15f)
            setPadding(0, 0, 0, 20)
        }
        commercialLockContainer.addView(lockMessageView)

        lockAmountView = TextView(this).apply {
            text = "VALOR PLAN PRO: $ 50.000 COP"
            textSize = 15f
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            setTextColor(Color.parseColor("#F59E0B"))
            gravity = Gravity.CENTER
            setPadding(20, 12, 20, 12)
            setBackgroundColor(Color.parseColor("#2D1515"))
        }
        commercialLockContainer.addView(lockAmountView)

        val qrSpace = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 24) }
        commercialLockContainer.addView(qrSpace)

        val density = resources.displayMetrics.density
        val qrSizePx = (240 * density).toInt()

        lockQrImageView = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(qrSizePx, qrSizePx).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            }
            setBackgroundColor(Color.WHITE)
            setPadding(16, 16, 16, 16)
        }
        commercialLockContainer.addView(lockQrImageView)

        val spaceQrBottom = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 16) }
        commercialLockContainer.addView(spaceQrBottom)

        val nequiDetailsView = TextView(this).apply {
            text = "Número Nequi: 311 365 4315\nTitular: MurSat Solutions"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, 4, 0, 24)
        }
        commercialLockContainer.addView(nequiDetailsView)

        recheckButton = Button(this).apply {
            text = "🔄 Ya pagué, verificar estado"
            setBackgroundColor(Color.parseColor("#00D26A"))
            setTextColor(Color.parseColor("#090D16"))
            setTypeface(null, Typeface.BOLD)
            setOnClickListener {
                SentinelForegroundService.triggerImmediateHeartbeat(this@MainActivity)
                Toast.makeText(this@MainActivity, "🔄 Consultando estado del servicio con el servidor...", Toast.LENGTH_SHORT).show()
                isEnabled = false
                text = "⏳ Verificando reactivación..."
                postDelayed({
                    isEnabled = true
                    text = "🔄 Ya pagué, verificar estado"
                    updateUI()
                    val st = credentialsStorage.getSubscriptionStatus()
                    if (st != "PAST_DUE" && st != "SUSPENDED") {
                        Toast.makeText(this@MainActivity, "✅ ¡Plan reactivado exitosamente! Centinela operativo.", Toast.LENGTH_LONG).show()
                    } else {
                        Toast.makeText(this@MainActivity, "El plan aún figura pendiente de pago.", Toast.LENGTH_SHORT).show()
                    }
                }, 2000)
            }
        }
        commercialLockContainer.addView(recheckButton)

        val spaceLock1 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 12) }
        commercialLockContainer.addView(spaceLock1)

        val openNequiButton = Button(this).apply {
            text = "📲 Abrir Nequi en este celular"
            setBackgroundColor(Color.parseColor("#1E293B"))
            setTextColor(Color.parseColor("#38BDF8"))
            setOnClickListener {
                try {
                    val launchIntent = packageManager.getLaunchIntentForPackage("com.nequi.MobileApp")
                    if (launchIntent != null) {
                        startActivity(launchIntent)
                    } else {
                        val webIntent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(credentialsStorage.getBillingQrPayload()))
                        startActivity(webIntent)
                    }
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "No fue posible abrir la app Nequi.", Toast.LENGTH_SHORT).show()
                }
            }
        }
        commercialLockContainer.addView(openNequiButton)

        val spaceLock2 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 12) }
        commercialLockContainer.addView(spaceLock2)

        val copyNequiBtn = Button(this).apply {
            text = "📋 Copiar Número Nequi (3113654315)"
            setBackgroundColor(Color.parseColor("#111827"))
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
            setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = android.content.ClipData.newPlainText("Nequi MurSat", "3113654315")
                clipboard.setPrimaryClip(clip)
                Toast.makeText(this@MainActivity, "Número Nequi copiado: 311 365 4315", Toast.LENGTH_SHORT).show()
            }
        }
        commercialLockContainer.addView(copyNequiBtn)

        rootLayout.addView(commercialLockContainer)

        // =====================================================================
        // CONTENEDOR 2: OPERACIÓN NORMAL DEL CENTINELA
        // =====================================================================
        operationalContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }

        statusView = TextView(this).apply {
            textSize = 14f
            setPadding(28, 24, 28, 24)
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#121826"))
        }
        operationalContainer.addView(statusView)

        val space0 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 16) }
        operationalContainer.addView(space0)

        diagnosticView = TextView(this).apply {
            textSize = 13f
            setPadding(28, 20, 28, 20)
            gravity = Gravity.START
            setBackgroundColor(Color.parseColor("#172033"))
            setOnClickListener {
                SentinelNotificationListener.forceRebind(this@MainActivity)
                if (enrollmentManager.getSentinelState() == SentinelState.ACTIVE_SENTINEL) {
                    SentinelForegroundService.triggerImmediateHeartbeat(this@MainActivity)
                }
                Toast.makeText(this@MainActivity, "🔄 Reconectando escucha y enviando heartbeat...", Toast.LENGTH_SHORT).show()
                postDelayed({ updateUI() }, 1800)
            }
        }
        operationalContainer.addView(diagnosticView)

        val space1 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 32) }
        operationalContainer.addView(space1)

        val permissionButton = Button(this).apply {
            text = "🔔 Activar Permiso de Notificaciones"
            setBackgroundColor(Color.parseColor("#1E293B"))
            setTextColor(Color.WHITE)
            setOnClickListener {
                SentinelNotificationListener.forceRebind(this@MainActivity)
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        }
        operationalContainer.addView(permissionButton)

        val space2 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 16) }
        operationalContainer.addView(space2)

        val batteryButton = Button(this).apply {
            text = "🔋 Optimizar Batería (Sin Restricciones)"
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
        operationalContainer.addView(batteryButton)

        val space2b = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 16) }
        operationalContainer.addView(space2b)

        simulateButton = Button(this).apply {
            text = "🧪 Probar Notificación de Pago"
            setBackgroundColor(Color.parseColor("#2563EB"))
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            setOnClickListener {
                simulateIncomingPayment()
            }
        }
        operationalContainer.addView(simulateButton)

        val space3 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 16) }
        operationalContainer.addView(space3)

        enrollButton = Button(this).apply {
            text = "📷 Vincular con Código QR (Desde PC)"
            setBackgroundColor(Color.parseColor("#00D26A"))
            setTextColor(Color.parseColor("#090D16"))
            setTypeface(null, Typeface.BOLD)
            setOnClickListener {
                startQrEnrollmentFlow()
            }
        }
        operationalContainer.addView(enrollButton)

        val space4 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 12) }
        operationalContainer.addView(space4)

        val openWebBtn = Button(this).apply {
            text = "🌐 Vincular desde este Celular (Abrir Web)"
            setBackgroundColor(Color.parseColor("#1E293B"))
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setOnClickListener {
                try {
                    val serverUrl = credentialsStorage.getServerUrl().ifBlank { "https://transferya.vercel.app" }
                    val browserIntent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(serverUrl))
                    startActivity(browserIntent)
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "No fue posible abrir el navegador.", Toast.LENGTH_SHORT).show()
                }
            }
        }
        operationalContainer.addView(openWebBtn)

        val space4b = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 12) }
        operationalContainer.addView(space4b)

        manualEnrollButton = Button(this).apply {
            text = "⌨️ Vincular con Código Manual (Pegar)"
            setBackgroundColor(Color.parseColor("#111726"))
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
            setOnClickListener {
                showManualEnrollmentDialog()
            }
        }
        operationalContainer.addView(manualEnrollButton)

        // Banner de Confianza, Privacidad y Habeas Data
        val privacyContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 20, 24, 20)
            setBackgroundColor(Color.parseColor("#0F172A"))
            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = 28
                bottomMargin = 16
            }
            layoutParams = params
        }

        val privacyBadgeTitle = TextView(this).apply {
            text = "🛡️ GARANTÍA DE SEGURIDAD & HABEAS DATA"
            textSize = 11f
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            setTextColor(Color.parseColor("#00D26A"))
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 8)
        }
        privacyContainer.addView(privacyBadgeTitle)

        val privacyBadgeText = TextView(this).apply {
            text = "\"TransferYA Centinela únicamente lee las alertas de pago emitidas por Nequi y DaviPlata. Jamás tiene acceso a tus claves, saldos de cuenta ni conversaciones personales.\""
            textSize = 11f
            setTextColor(Color.parseColor("#94A3B8"))
            gravity = Gravity.CENTER
            setLineSpacing(3f, 1.15f)
            setPadding(0, 0, 0, 12)
        }
        privacyContainer.addView(privacyBadgeText)

        val privacyDetailBtn = Button(this).apply {
            text = "ℹ️ ¿Por qué Android pide permisos especiales?"
            setBackgroundColor(Color.parseColor("#1E293B"))
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 11f
            setOnClickListener {
                showSecurityExplanationDialog()
            }
        }
        privacyContainer.addView(privacyDetailBtn)

        operationalContainer.addView(privacyContainer)

        rootLayout.addView(operationalContainer)

        scrollWrapper.addView(rootLayout)
        setContentView(scrollWrapper)
    }

    private fun showSecurityExplanationDialog() {
        val message = """
            🛡️ 1. ACCESO A NOTIFICACIONES:
            Es el único permiso que permite a TransferYA detectar en menos de 1 segundo cuando Nequi o DaviPlata te envían: "Te enviaron $...". 
            
            🔒 2. FILTRO ESTRICTO:
            La app descarta inmediatamente cualquier notificación que NO sea de Nequi o DaviPlata. JAMÁS se leen chats de WhatsApp, SMS, llamadas, fotos ni contraseñas.
            
            🚫 3. CERO ACCESO A TU DINERO:
            TransferYA es un receptor pasivo (como un timbre inteligente). No se conecta a tu banco, no conoce tus claves y es técnicamente imposible que retire o transfiera dinero.
            
            🔋 4. OPTIMIZACIÓN DE BATERÍA:
            Evita que Android cierre la app al apagar la pantalla para que no se pierda ningún cobro en tu negocio.
            
            🇨🇴 5. HABEAS DATA (Ley 1581 de 2012):
            Tus datos de ventas se usan únicamente para el arqueo de tu negocio. Jamás se venden ni comparten con terceros.
        """.trimIndent()

        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Garantía de Privacidad y Seguridad")
            .setMessage(message)
            .setPositiveButton("Entendido") { dialog, _ -> dialog.dismiss() }
            .show()
    }

    private fun updateUI() {
        val state = enrollmentManager.getSentinelState()
        val subStatus = credentialsStorage.getSubscriptionStatus()
        val isBlocked = (subStatus == "PAST_DUE" || subStatus == "SUSPENDED") && state == SentinelState.ACTIVE_SENTINEL

        if (isBlocked) {
            operationalContainer.visibility = View.GONE
            commercialLockContainer.visibility = View.VISIBLE
            renderCommercialLock(subStatus)
            return
        } else {
            operationalContainer.visibility = View.VISIBLE
            commercialLockContainer.visibility = View.GONE
        }

        val isPermGranted = NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)

        val pendingCount = sqliteDao.getCountByStatus(NotificationStatus.PENDING)
        val dispatchedCount = sqliteDao.getCountByStatus(NotificationStatus.DISPATCHED)
        val failedCount = sqliteDao.getCountByStatus(NotificationStatus.FAILED)
        val lastError = sqliteDao.getLastError()

        val powerManager = getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
        val isIgnoringBattery = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && powerManager != null) {
            powerManager.isIgnoringBatteryOptimizations(packageName)
        } else true

        if (state == SentinelState.ACTIVE_SENTINEL) {
            val deviceId = credentialsStorage.getDeviceId() ?: "Desconocido"
            val merchantId = credentialsStorage.getMerchantId() ?: "Desconocido"

            statusView.text = "🟢 CAJA CONECTADA Y ACTIVA\n\nCaja: $deviceId\nComercio: $merchantId\nEstado: Escuchando pagos en tiempo real"
            statusView.setTextColor(Color.parseColor("#00D26A"))
            enrollButton.text = "📷 Cambiar o Re-vincular Código QR"
            startSentinelService()
        } else {
            statusView.text = "🟡 CAJA PENDIENTE DE VINCULAR\n\n¿Estás usando este mismo teléfono? Toca 'Vincular desde este Celular' para abrir el panel y conectar en 1 Clic.\n\n¿Tienes computador? Abre transferya.vercel.app y escanea el código QR."
            statusView.setTextColor(Color.parseColor("#F59E0B"))
            enrollButton.text = "📷 Vincular con Código QR (Desde PC)"
        }

        val isListenerBound = SentinelNotificationListener.isConnected
        val listenerText = if (isListenerBound) "🟢 ACTIVO (Escuchando)" else "🔴 DESCONECTADO (Toca para Reconectar)"
        val permText = if (isPermGranted) "✅ ACTIVO" else "⚠️ DESACTIVADO (Requiere activación en Ajustes)"
        val batteryText = if (isIgnoringBattery) "✅ Sin Restricciones" else "⚠️ 'Sin Restricciones' Requerido"
        val lastPingAt = credentialsStorage.getLastHeartbeatAt()
        val heartbeatText = if (lastPingAt > 0L) {
            val secAgo = ((System.currentTimeMillis() - lastPingAt) / 1000L).coerceAtLeast(0L)
            if (secAgo < 60L) "✅ En línea (Hace ${secAgo}s)" else "✅ En línea (Hace ${secAgo / 60L} min)"
        } else {
            "⏳ Conectando..."
        }
        val lastErrorLine = if (!lastError.isNullOrBlank()) "\n• Último Error Red: ${lastError.take(120)}" else ""

        diagnosticView.text = "Estado del Sistema:\n• Lectura de Notificaciones: $permText\n• Conexión con Negocio: $heartbeatText\n• Estado del Receptor: $listenerText\n• Batería del Teléfono: $batteryText\n• Pagos Registrados: $dispatchedCount confirmados$lastErrorLine"
        diagnosticView.setTextColor(Color.parseColor(if (isPermGranted && isListenerBound && isIgnoringBattery && failedCount == 0 && pendingCount == 0) "#00D26A" else "#F59E0B"))
    }

    private fun renderCommercialLock(subStatus: String) {
        val isPaused = subStatus == "SUSPENDED"
        lockTitleView.text = if (isPaused) {
            "⏸️ SERVICIO PAUSADO POR ADMINISTRACIÓN"
        } else {
            "⚠️ SERVICIO SUSPENDIDO — PLAN VENCIDO"
        }
        lockTitleView.setTextColor(if (isPaused) Color.parseColor("#F59E0B") else Color.parseColor("#EF4444"))

        val amountCop = credentialsStorage.getBillingAmountCop()
        val formattedAmount = java.text.NumberFormat.getNumberInstance(java.util.Locale("es", "CO")).format(amountCop)
        lockAmountView.text = "VALOR PLAN PRO: $$formattedAmount COP"

        val qrPayload = credentialsStorage.getBillingQrPayload()
        try {
            val barcodeEncoder = BarcodeEncoder()
            val density = resources.displayMetrics.density
            val sizePx = (240 * density).toInt()
            val bitmap = barcodeEncoder.encodeBitmap(qrPayload, BarcodeFormat.QR_CODE, sizePx, sizePx)
            lockQrImageView.setImageBitmap(bitmap)
            lockQrImageView.visibility = View.VISIBLE
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Error generando QR Nequi", e)
            lockQrImageView.visibility = View.GONE
        }
    }

    private fun simulateIncomingPayment() {
        val state = enrollmentManager.getSentinelState()
        if (state != SentinelState.ACTIVE_SENTINEL) {
            Toast.makeText(this, "Empareja el dispositivo primero", Toast.LENGTH_SHORT).show()
            return
        }

        val subStatus = credentialsStorage.getSubscriptionStatus()
        if (subStatus == "PAST_DUE" || subStatus == "SUSPENDED") {
            AlertDialog.Builder(this)
                .setTitle("⚠️ Simulación Bloqueada")
                .setMessage("El servicio está suspendido o vencido ($subStatus). El Centinela no procesa pagos mientras la cuenta no esté activa.")
                .setPositiveButton("Aceptar", null)
                .show()
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

    private fun startQrEnrollmentFlow() {
        val hasCameraPerm = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED

        if (hasCameraPerm) {
            launchQrScanner()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun launchQrScanner() {
        val options = ScanOptions().apply {
            setCaptureActivity(PortraitCaptureActivity::class.java)
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt("Apunta al código QR en el Panel Web TransferYA")
            setCameraId(0)
            setBeepEnabled(true)
            setBarcodeImageEnabled(false)
            setOrientationLocked(true)
        }
        qrScanLauncher.launch(options)
    }

    private fun handleIncomingDeepLink(incomingIntent: Intent?) {
        val rawUri = incomingIntent?.data?.toString()?.trim() ?: return
        val parsed = qrParser.parse(rawUri) ?: return
        incomingIntent.data = null

        AlertDialog.Builder(this)
            .setTitle("Emparejar Dispositivo TransferYA")
            .setMessage("Se detectó un enlace de emparejamiento para la caja '${parsed.deviceId}'.\n\n¿Deseas vincular este teléfono ahora?")
            .setPositiveButton("Vincular Ahora") { _, _ ->
                processEnrollment(rawUri)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun showManualEnrollmentDialog() {
        val dialogLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 32, 48, 16)
        }

        val hintText = TextView(this).apply {
            text = "Modo Manual: pega el URI o Token generado en el panel web de TransferYA:"
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
            .setTitle("Emparejamiento Manual (Respaldo)")
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
                    result.deviceId?.let { sqliteDao.failPendingForOtherDevices(it) }
                    SentinelNotificationListener.reinitializeIfConnected(this@MainActivity)
                    SentinelForegroundService.triggerImmediateHeartbeat(this@MainActivity)
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
