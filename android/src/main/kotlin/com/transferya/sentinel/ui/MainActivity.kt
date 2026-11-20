package com.transferya.sentinel.ui

import android.Manifest
import android.app.AlertDialog
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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

    // Header views
    private lateinit var headerBadgeView: TextView

    // Card 1: Estado de conexión
    private lateinit var heroTitleView: TextView
    private lateinit var heroSubtitleView: TextView
    private lateinit var boxIdView: TextView
    private lateinit var merchantIdView: TextView

    // Bento 2 columnas: Métricas
    private lateinit var paymentsCountView: TextView
    private lateinit var businessConnectionView: TextView
    private lateinit var businessConnectionSubtitleView: TextView

    // Card 3: Estado del sistema
    private lateinit var notifStatusBadge: TextView
    private lateinit var listenerStatusBadge: TextView
    private lateinit var batteryStatusBadge: TextView

    // Acciones y botones
    private lateinit var simulateButton: Button
    private lateinit var enrollButton: Button
    private lateinit var openWebBtn: Button
    private lateinit var manualEnrollButton: Button
    private lateinit var restrictedSettingsBtn: Button

    // Contenedores
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

        window.statusBarColor = Color.parseColor("#0B1220")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            window.decorView.systemUiVisibility =
                window.decorView.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
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
        if (SentinelNotificationListener.isConnected) {
            SentinelNotificationListener.scanActiveNotifications()
        }
        if (enrollmentManager.getSentinelState() == SentinelState.ACTIVE_SENTINEL) {
            val lastPing = credentialsStorage.getLastHeartbeatAt()
            if (lastPing <= 0L || (System.currentTimeMillis() - lastPing) >= 60_000L) {
                SentinelForegroundService.triggerImmediateHeartbeat(this)
            }
        }
        updateUI()
    }

    private fun dpToPx(dp: Float): Int {
        return (dp * resources.displayMetrics.density).toInt()
    }

    private fun createRoundedDrawable(
        bgColor: Int,
        cornerRadiusDp: Float = 14f,
        strokeColor: Int = Color.TRANSPARENT,
        strokeWidthDp: Float = 0f
    ): GradientDrawable {
        val density = resources.displayMetrics.density
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = cornerRadiusDp * density
            setColor(bgColor)
            if (strokeWidthDp > 0f && strokeColor != Color.TRANSPARENT) {
                setStroke((strokeWidthDp * density).toInt(), strokeColor)
            }
        }
    }

    private fun setupView() {
        val scrollWrapper = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Color.parseColor("#0B1220"))
        }

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val hPad = dpToPx(18f)
            val vPad = dpToPx(20f)
            setPadding(hPad, vPad, hPad, vPad)
            setBackgroundColor(Color.parseColor("#0B1220"))
        }

        // =====================================================================
        // CABECERA FINTECH: Icono, Título y Badge "En línea"
        // =====================================================================
        val headerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(18f)
            }
        }

        val iconContainer = FrameLayout(this).apply {
            val size = dpToPx(42f)
            layoutParams = LinearLayout.LayoutParams(size, size).apply {
                marginEnd = dpToPx(12f)
            }
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#152237"),
                cornerRadiusDp = 10f,
                strokeColor = Color.parseColor("#1E314F"),
                strokeWidthDp = 1f
            )
            val pad = dpToPx(7f)
            setPadding(pad, pad, pad, pad)
        }

        val logoView = ImageView(this).apply {
            setImageResource(com.transferya.sentinel.R.drawable.transferya_centinela_master)
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        iconContainer.addView(logoView)
        headerLayout.addView(iconContainer)

        val headerTextLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f
            )
        }

        val appNameView = TextView(this).apply {
            text = "TransferYA"
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        }
        headerTextLayout.addView(appNameView)

        val appTagView = TextView(this).apply {
            text = "CENTINELA · PANEL DE CONTROL"
            textSize = 10f
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            setTextColor(Color.parseColor("#94A3B8"))
        }
        headerTextLayout.addView(appTagView)
        headerLayout.addView(headerTextLayout)

        headerBadgeView = TextView(this).apply {
            text = "● En línea"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#20D6BA"))
            val hPad = dpToPx(10f)
            val vPad = dpToPx(4f)
            setPadding(hPad, vPad, hPad, vPad)
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#0E2A27"),
                cornerRadiusDp = 14f,
                strokeColor = Color.parseColor("#20D6BA"),
                strokeWidthDp = 1f
            )
        }
        headerLayout.addView(headerBadgeView)
        rootLayout.addView(headerLayout)

        // =====================================================================
        // CONTENEDOR 1: PANTALLA DE BLOQUEO COMERCIAL (Ticket 21 / QR Nequi)
        // =====================================================================
        commercialLockContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            val pad = dpToPx(20f)
            setPadding(pad, pad, pad, pad)
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#180B0F"),
                cornerRadiusDp = 16f,
                strokeColor = Color.parseColor("#451A24"),
                strokeWidthDp = 1f
            )
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(20f)
            }
            visibility = View.GONE
        }

        lockTitleView = TextView(this).apply {
            text = "⚠️ SERVICIO SUSPENDIDO — PLAN VENCIDO"
            textSize = 17f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#EF4444"))
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dpToPx(14f))
        }
        commercialLockContainer.addView(lockTitleView)

        lockMessageView = TextView(this).apply {
            text = "Tu suscripción a TransferYA ha finalizado. Los cajeros no están recibiendo confirmaciones de pago en WhatsApp.\n\nPara reactivar el servicio de inmediato, escanea el código QR desde Nequi o transfiere la mensualidad a MurSat Solutions:"
            textSize = 13f
            setTextColor(Color.parseColor("#E2E8F0"))
            gravity = Gravity.CENTER
            setLineSpacing(4f, 1.15f)
            setPadding(0, 0, 0, dpToPx(16f))
        }
        commercialLockContainer.addView(lockMessageView)

        lockAmountView = TextView(this).apply {
            text = "VALOR PLAN PRO: $ 50.000 COP"
            textSize = 14f
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            setTextColor(Color.parseColor("#F59E0B"))
            gravity = Gravity.CENTER
            val hP = dpToPx(20f)
            val vP = dpToPx(10f)
            setPadding(hP, vP, hP, vP)
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#2D1515"),
                cornerRadiusDp = 8f
            )
        }
        commercialLockContainer.addView(lockAmountView)

        val qrSpace = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(18f)) }
        commercialLockContainer.addView(qrSpace)

        val density = resources.displayMetrics.density
        val qrSizePx = (220 * density).toInt()

        lockQrImageView = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(qrSizePx, qrSizePx).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            }
            val p = dpToPx(14f)
            setPadding(p, p, p, p)
            background = createRoundedDrawable(
                bgColor = Color.WHITE,
                cornerRadiusDp = 12f
            )
        }
        commercialLockContainer.addView(lockQrImageView)

        val spaceQrBottom = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(14f)) }
        commercialLockContainer.addView(spaceQrBottom)

        val nequiDetailsView = TextView(this).apply {
            text = "Número Nequi: 311 365 4315\nTitular: MurSat Solutions"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dpToPx(18f))
        }
        commercialLockContainer.addView(nequiDetailsView)

        recheckButton = Button(this).apply {
            text = "🔄 Ya pagué, verificar estado"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0B1220"))
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#20D6BA"),
                cornerRadiusDp = 12f
            )
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(48f)
            ).apply {
                bottomMargin = dpToPx(10f)
            }
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

        val openNequiButton = Button(this).apply {
            text = "📲 Abrir Nequi en este celular"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#38BDF8"))
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#152237"),
                cornerRadiusDp = 10f,
                strokeColor = Color.parseColor("#1E314F"),
                strokeWidthDp = 1f
            )
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(42f)
            ).apply {
                bottomMargin = dpToPx(8f)
            }
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

        val copyNequiBtn = Button(this).apply {
            text = "📋 Copiar Número Nequi (3113654315)"
            textSize = 11f
            setTextColor(Color.parseColor("#94A3B8"))
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#0E1726"),
                cornerRadiusDp = 8f,
                strokeColor = Color.parseColor("#1A2840"),
                strokeWidthDp = 1f
            )
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(38f)
            )
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
        // CONTENEDOR 2: OPERACIÓN NORMAL DEL CENTINELA (FINTECH PREMIUM)
        // =====================================================================
        operationalContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        // -------------------------------------------------------------
        // TARJETA 1: Estado de conexión (Hero Card)
        // -------------------------------------------------------------
        val connectionCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(14f)
            }
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#152237"),
                cornerRadiusDp = 14f,
                strokeColor = Color.parseColor("#1E314F"),
                strokeWidthDp = 1f
            )
            val pad = dpToPx(18f)
            setPadding(pad, pad, pad, pad)
        }

        val cardTag = TextView(this).apply {
            text = "📡 Estado de conexión"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#20D6BA"))
            setPadding(0, 0, 0, dpToPx(6f))
        }
        connectionCard.addView(cardTag)

        heroTitleView = TextView(this).apply {
            text = "Caja conectada y activa"
            textSize = 19f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        }
        connectionCard.addView(heroTitleView)

        heroSubtitleView = TextView(this).apply {
            text = "Escuchando pagos en tiempo real"
            textSize = 13f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, dpToPx(2f), 0, dpToPx(14f))
        }
        connectionCard.addView(heroSubtitleView)

        val dividerConn = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(1f)
            ).apply {
                bottomMargin = dpToPx(12f)
            }
            setBackgroundColor(Color.parseColor("#1E314F"))
        }
        connectionCard.addView(dividerConn)

        // Fila Caja
        val cajaRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(8f)
            }
        }
        val cajaLabel = TextView(this).apply {
            text = "Caja"
            textSize = 13f
            setTextColor(Color.parseColor("#94A3B8"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        cajaRow.addView(cajaLabel)
        boxIdView = TextView(this).apply {
            text = "dev_caja_1"
            textSize = 13f
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            setTextColor(Color.WHITE)
        }
        cajaRow.addView(boxIdView)
        connectionCard.addView(cajaRow)

        // Fila Comercio
        val comercioRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        val comercioLabel = TextView(this).apply {
            text = "Comercio"
            textSize = 13f
            setTextColor(Color.parseColor("#94A3B8"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        comercioRow.addView(comercioLabel)
        merchantIdView = TextView(this).apply {
            text = "bc8b5b58...9f61b1"
            textSize = 13f
            setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
            setTextColor(Color.parseColor("#94A3B8"))
        }
        comercioRow.addView(merchantIdView)
        connectionCard.addView(comercioRow)

        operationalContainer.addView(connectionCard)

        // -------------------------------------------------------------
        // BENTO GRID (2 Columnas Métricas)
        // -------------------------------------------------------------
        val bentoRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(16f)
            }
        }

        // Columna Izquierda: Pagos confirmados
        val paymentsCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dpToPx(6f)
            }
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#152237"),
                cornerRadiusDp = 14f,
                strokeColor = Color.parseColor("#1E314F"),
                strokeWidthDp = 1f
            )
            val pad = dpToPx(16f)
            setPadding(pad, pad, pad, pad)
        }
        val checkIcon = TextView(this).apply {
            text = "✓"
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#20D6BA"))
        }
        paymentsCard.addView(checkIcon)

        paymentsCountView = TextView(this).apply {
            text = "0"
            textSize = 28f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding(0, dpToPx(2f), 0, dpToPx(2f))
        }
        paymentsCard.addView(paymentsCountView)

        val paymentsLabel = TextView(this).apply {
            text = "Pagos confirmados"
            textSize = 12f
            setTextColor(Color.parseColor("#94A3B8"))
        }
        paymentsCard.addView(paymentsLabel)
        bentoRow.addView(paymentsCard)

        // Columna Derecha: Conexión con negocio
        val connectionMetricCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dpToPx(6f)
            }
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#152237"),
                cornerRadiusDp = 14f,
                strokeColor = Color.parseColor("#1E314F"),
                strokeWidthDp = 1f
            )
            val pad = dpToPx(16f)
            setPadding(pad, pad, pad, pad)
        }
        val wifiIcon = TextView(this).apply {
            text = "📶"
            textSize = 14f
        }
        connectionMetricCard.addView(wifiIcon)

        businessConnectionView = TextView(this).apply {
            text = "Conectado"
            textSize = 17f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding(0, dpToPx(6f), 0, dpToPx(2f))
        }
        connectionMetricCard.addView(businessConnectionView)

        businessConnectionSubtitleView = TextView(this).apply {
            text = "Conexión con negocio"
            textSize = 12f
            setTextColor(Color.parseColor("#94A3B8"))
        }
        connectionMetricCard.addView(businessConnectionSubtitleView)
        bentoRow.addView(connectionMetricCard)

        operationalContainer.addView(bentoRow)

        // -------------------------------------------------------------
        // TARJETA 3: Estado del sistema
        // -------------------------------------------------------------
        val sysStatusHeader = TextView(this).apply {
            text = "Estado del sistema"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding(dpToPx(4f), 0, 0, dpToPx(10f))
        }
        operationalContainer.addView(sysStatusHeader)

        val sysStatusCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(18f)
            }
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#152237"),
                cornerRadiusDp = 14f,
                strokeColor = Color.parseColor("#1E314F"),
                strokeWidthDp = 1f
            )
            val pad = dpToPx(16f)
            setPadding(pad, pad, pad, pad)
        }

        // Fila 1: Notificaciones
        val notifRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dpToPx(6f), 0, dpToPx(10f))
            isClickable = true
            setOnClickListener {
                SentinelNotificationListener.forceRebind(this@MainActivity)
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        }
        val notifLabel = TextView(this).apply {
            text = "🔔  Notificaciones"
            textSize = 13f
            setTextColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        notifRow.addView(notifLabel)
        notifStatusBadge = TextView(this).apply {
            text = "✓ Activo"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#20D6BA"))
        }
        notifRow.addView(notifStatusBadge)
        sysStatusCard.addView(notifRow)

        val dividerSys1 = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dpToPx(1f))
            setBackgroundColor(Color.parseColor("#1E314F"))
        }
        sysStatusCard.addView(dividerSys1)

        // Fila 2: Receptor de pagos
        val listenerRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dpToPx(10f), 0, dpToPx(10f))
            isClickable = true
            setOnClickListener {
                SentinelNotificationListener.forceRebind(this@MainActivity)
                SentinelNotificationListener.scanActiveNotifications()
                if (enrollmentManager.getSentinelState() == SentinelState.ACTIVE_SENTINEL) {
                    SentinelForegroundService.triggerImmediateHeartbeat(this@MainActivity)
                }
                Toast.makeText(this@MainActivity, "🔄 Reconectando escucha y rescatando pagos...", Toast.LENGTH_SHORT).show()
                postDelayed({
                    SentinelNotificationListener.scanActiveNotifications()
                    updateUI()
                }, 1800)
            }
        }
        val listenerLabel = TextView(this).apply {
            text = "📱  Receptor de pagos"
            textSize = 13f
            setTextColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        listenerRow.addView(listenerLabel)
        listenerStatusBadge = TextView(this).apply {
            text = "✓ Escuchando"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#20D6BA"))
        }
        listenerRow.addView(listenerStatusBadge)
        sysStatusCard.addView(listenerRow)

        val dividerSys2 = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dpToPx(1f))
            setBackgroundColor(Color.parseColor("#1E314F"))
        }
        sysStatusCard.addView(dividerSys2)

        // Fila 3: Optimización de batería
        val batteryRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dpToPx(10f), 0, dpToPx(6f))
            isClickable = true
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
        val batteryLabel = TextView(this).apply {
            text = "🔋  Optimización de batería"
            textSize = 13f
            setTextColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        batteryRow.addView(batteryLabel)
        batteryStatusBadge = TextView(this).apply {
            text = "✓ Sin restricciones"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#20D6BA"))
        }
        batteryRow.addView(batteryStatusBadge)
        sysStatusCard.addView(batteryRow)

        operationalContainer.addView(sysStatusCard)

        // -------------------------------------------------------------
        // SECCIÓN: Acciones rápidas
        // -------------------------------------------------------------
        val actionsHeader = TextView(this).apply {
            text = "Acciones rápidas"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding(dpToPx(4f), 0, 0, dpToPx(10f))
        }
        operationalContainer.addView(actionsHeader)

        // Botón 1 (Principal): Probar notificación de pago
        simulateButton = Button(this).apply {
            text = "🧪 Probar notificación de pago"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#2463EB"),
                cornerRadiusDp = 12f
            )
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(50f)
            ).apply {
                bottomMargin = dpToPx(10f)
            }
            setOnClickListener {
                simulateIncomingPayment()
            }
        }
        operationalContainer.addView(simulateButton)

        // Botón 2 (Secundario): Cambiar o revincular código QR
        enrollButton = Button(this).apply {
            text = "📷 Cambiar o revincular código QR"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#152237"),
                cornerRadiusDp = 12f,
                strokeColor = Color.parseColor("#2B4066"),
                strokeWidthDp = 1f
            )
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(50f)
            ).apply {
                bottomMargin = dpToPx(12f)
            }
            setOnClickListener {
                startQrEnrollmentFlow()
            }
        }
        operationalContainer.addView(enrollButton)

        // Acciones auxiliares de vinculación
        val auxActionsLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(14f)
            }
        }

        openWebBtn = Button(this).apply {
            text = "🌐 Vincular desde este Celular (Abrir Web)"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#38BDF8"))
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#0F1A2D"),
                cornerRadiusDp = 10f,
                strokeColor = Color.parseColor("#1A2B47"),
                strokeWidthDp = 1f
            )
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(42f)
            ).apply {
                bottomMargin = dpToPx(8f)
            }
            setOnClickListener {
                try {
                    val serverUrl = credentialsStorage.getServerUrl().ifBlank { "https://www.transferya.app" }
                    val browserIntent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(serverUrl))
                    startActivity(browserIntent)
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "No fue posible abrir el navegador.", Toast.LENGTH_SHORT).show()
                }
            }
        }
        auxActionsLayout.addView(openWebBtn)

        manualEnrollButton = Button(this).apply {
            text = "⌨️ Vincular con Código Manual (Pegar)"
            textSize = 12f
            setTextColor(Color.parseColor("#94A3B8"))
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#0C1422"),
                cornerRadiusDp = 10f,
                strokeColor = Color.parseColor("#16233B"),
                strokeWidthDp = 1f
            )
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(40f)
            ).apply {
                bottomMargin = dpToPx(8f)
            }
            setOnClickListener {
                showManualEnrollmentDialog()
            }
        }
        auxActionsLayout.addView(manualEnrollButton)

        restrictedSettingsBtn = Button(this).apply {
            text = "🔓 ¿Dice 'A la app se le negó el acceso'? Toca aquí"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#F59E0B"))
            background = createRoundedDrawable(
                bgColor = Color.parseColor("#261D12"),
                cornerRadiusDp = 10f,
                strokeColor = Color.parseColor("#4D381E"),
                strokeWidthDp = 1f
            )
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(40f)
            )
            visibility = View.GONE
            setOnClickListener {
                showRestrictedSettingsGuide()
            }
        }
        auxActionsLayout.addView(restrictedSettingsBtn)
        operationalContainer.addView(auxActionsLayout)

        // Enlace de Seguridad y Privacidad
        val securityPrivacyLink = TextView(this).apply {
            text = "🛡️ Seguridad y privacidad de datos"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#94A3B8"))
            gravity = Gravity.CENTER
            setPadding(0, dpToPx(8f), 0, dpToPx(6f))
            isClickable = true
            setOnClickListener {
                showSecurityExplanationDialog()
            }
        }
        operationalContainer.addView(securityPrivacyLink)

        val footerNote = TextView(this).apply {
            text = "TransferYA Centinela • Criptografía Hardware KeyStore"
            textSize = 10f
            setTextColor(Color.parseColor("#475569"))
            gravity = Gravity.CENTER
            setPadding(0, dpToPx(2f), 0, dpToPx(16f))
        }
        operationalContainer.addView(footerNote)

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
            
            🔓 5. AJUSTES RESTRINGIDOS (Android 13/14):
            Si ves el mensaje "A la app se le negó el acceso", ve a Info de la App > 3 puntos (⋮) > Permitir ajustes restringidos. Esto desbloquea el aviso normal de 10 segundos.
            
            🇨🇴 6. HABEAS DATA (Ley 1581 de 2012):
            Tus datos de ventas se usan únicamente para el arqueo de tu negocio. Jamás se venden ni comparten con terceros.
        """.trimIndent()

        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Garantía de Privacidad y Seguridad")
            .setMessage(message)
            .setPositiveButton("Entendido") { dialog, _ -> dialog.dismiss() }
            .show()
    }

    private fun showRestrictedSettingsGuide() {
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("🔓 Cómo Desbloquear el Permiso")
            .setMessage(
                "En Android 13 y 14 (Xiaomi HyperOS, MIUI, Samsung, Motorola), las apps descargadas directamente requieren autorizar los 'Ajustes Restringidos' antes de permitir el acceso.\n\n" +
                "📋 SIGUE ESTOS 3 SENCILLOS PASOS:\n\n" +
                "1️⃣ Toca el botón 'Ir a Info de la App' abajo.\n" +
                "2️⃣ Toca los 3 puntos (⋮) en la esquina superior derecha.\n" +
                "3️⃣ Selecciona 'Permitir ajustes restringidos' e introduce tu huella o PIN.\n\n" +
                "✅ ¡Listo! Regresa aquí y presiona '🔔 Activar Permiso de Notificaciones' para aceptar la advertencia normal de 10 segundos."
            )
            .setPositiveButton("Ir a Info de la App") { _, _ ->
                try {
                    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = android.net.Uri.fromParts("package", packageName, null)
                    }
                    startActivity(intent)
                } catch (_: Exception) {
                    startActivity(Intent(Settings.ACTION_SETTINGS))
                }
            }
            .setNegativeButton("Entendido", null)
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

        val isListenerBound = SentinelNotificationListener.isConnected

        if (state == SentinelState.ACTIVE_SENTINEL) {
            val deviceId = credentialsStorage.getDeviceId() ?: "Desconocido"
            val merchantId = credentialsStorage.getMerchantId() ?: "Desconocido"

            headerBadgeView.text = "● En línea"
            headerBadgeView.setTextColor(Color.parseColor("#20D6BA"))
            headerBadgeView.background = createRoundedDrawable(
                bgColor = Color.parseColor("#0E2A27"),
                cornerRadiusDp = 14f,
                strokeColor = Color.parseColor("#20D6BA"),
                strokeWidthDp = 1f
            )

            heroTitleView.text = "Caja conectada y activa"
            heroSubtitleView.text = "Escuchando pagos en tiempo real"
            heroSubtitleView.setTextColor(Color.parseColor("#94A3B8"))

            boxIdView.text = deviceId
            merchantIdView.text = if (merchantId.length > 18) {
                "${merchantId.take(8)}...${merchantId.takeLast(6)}"
            } else {
                merchantId
            }

            enrollButton.text = "📷 Cambiar o revincular código QR"
            startSentinelService()
        } else {
            headerBadgeView.text = "● Pendiente"
            headerBadgeView.setTextColor(Color.parseColor("#F59E0B"))
            headerBadgeView.background = createRoundedDrawable(
                bgColor = Color.parseColor("#281F0E"),
                cornerRadiusDp = 14f,
                strokeColor = Color.parseColor("#F59E0B"),
                strokeWidthDp = 1f
            )

            heroTitleView.text = "Caja pendiente de vincular"
            heroSubtitleView.text = "Apunta al código QR en transferya.app o vincula desde este celular"
            heroSubtitleView.setTextColor(Color.parseColor("#F59E0B"))

            boxIdView.text = "Sin asignar"
            merchantIdView.text = "Sin asignar"

            enrollButton.text = "📷 Vincular con Código QR (Desde PC)"
        }

        // Métricas
        paymentsCountView.text = dispatchedCount.toString()

        val lastPingAt = credentialsStorage.getLastHeartbeatAt()
        if (lastPingAt > 0L) {
            val secAgo = ((System.currentTimeMillis() - lastPingAt) / 1000L).coerceAtLeast(0L)
            if (secAgo < 60L) {
                businessConnectionView.text = "Conectado"
                businessConnectionView.setTextColor(Color.parseColor("#20D6BA"))
                businessConnectionSubtitleView.text = "Hace ${secAgo}s"
            } else {
                businessConnectionView.text = "En espera"
                businessConnectionView.setTextColor(Color.parseColor("#F59E0B"))
                businessConnectionSubtitleView.text = "Hace ${secAgo / 60L} min"
            }
        } else {
            businessConnectionView.text = "Conectando..."
            businessConnectionView.setTextColor(Color.parseColor("#94A3B8"))
            businessConnectionSubtitleView.text = "Conexión con negocio"
        }

        // Estado del sistema
        if (isPermGranted) {
            notifStatusBadge.text = "✓ Activo"
            notifStatusBadge.setTextColor(Color.parseColor("#20D6BA"))
            restrictedSettingsBtn.visibility = View.GONE
        } else {
            notifStatusBadge.text = "⚠️ Inactivo"
            notifStatusBadge.setTextColor(Color.parseColor("#EF4444"))
            restrictedSettingsBtn.visibility = View.VISIBLE
        }

        if (isListenerBound) {
            listenerStatusBadge.text = "✓ Escuchando"
            listenerStatusBadge.setTextColor(Color.parseColor("#20D6BA"))
        } else {
            listenerStatusBadge.text = "🔴 Desconectado"
            listenerStatusBadge.setTextColor(Color.parseColor("#EF4444"))
        }

        if (isIgnoringBattery) {
            batteryStatusBadge.text = "✓ Sin restricciones"
            batteryStatusBadge.setTextColor(Color.parseColor("#20D6BA"))
        } else {
            batteryStatusBadge.text = "⚠️ Requerido"
            batteryStatusBadge.setTextColor(Color.parseColor("#F59E0B"))
        }
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
