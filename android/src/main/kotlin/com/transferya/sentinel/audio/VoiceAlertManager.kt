package com.transferya.sentinel.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import com.transferya.sentinel.onboarding.SharedPreferencesCredentialsStorage
import java.util.Locale

/**
 * Datos estructurados extraídos de la notificación bancaria para síntesis de voz y display.
 */
data class PaymentAlert(
    val wallet: String,
    val amountClean: String?,
    val payer: String?
)

/**
 * Parser puro de notificaciones bancarias colombianas (Nequi, DaviPlata, Bancolombia).
 * Desacoplado del framework de Android para permitir ejecución de pruebas unitarias puras en JVM.
 */
object PaymentNotificationParser {

    // 1. Monto con símbolo $: $50.000, $ 50.000, $50000, $150.000,00, $3
    private val currencyAmountRegex = Regex("""\$\s*([\d\.\,]{1,12})""")

    // 2. Respaldo sin símbolo $ tras verbos bancarios colombianos:
    //    "KAROLL SIERRA te envió 150, ¡lo mejor!", "Recibiste 1.500 de Juan"
    private val contextualAmountRegex = Regex(
        """(?:te\s+envi[oó]|te\s+transfiri[oó]|recibiste|pago\s+por|transferencia\s+(?:de|por)|valor(?:\s+de)?|por)\s+(?:COP\s*)?([\d][\d\.\,]{0,11})(?=\s|$|[,\.!¡])""",
        RegexOption.IGNORE_CASE
    )

    fun parseNotificationText(packageName: String, rawTitle: String, rawText: String): PaymentAlert {
        val title = rawTitle.trim()
        val text = rawText.trim()
        val combined = "$title $text"
        val lower = combined.lowercase()

        val wallet = when {
            packageName.contains("daviplata") || lower.contains("daviplata") -> "DaviPlata"
            packageName.contains("bancolombia") || lower.contains("bancolombia") || lower.contains("a la mano") -> "Bancolombia"
            packageName.contains("nequi") || lower.contains("nequi") -> "Nequi"
            else -> "Transferencia"
        }

        val amountMatch = currencyAmountRegex.find(combined) ?: contextualAmountRegex.find(combined)
        val rawAmount = amountMatch?.groups?.get(1)?.value?.trim()
        val cleanAmount = rawAmount?.trimEnd('.', ',')

        // Regex para detectar remitente
        // 1. Detectar remitente antes de "te envió / te transfirió": "Carlos Pérez te envió $50.000"
        val prefixPayerRegex = Regex("""^([A-Za-zÁ-ÿ\s]{3,25})\s+te\s+(?:envi[oó]|transfiri[oó])""", RegexOption.IGNORE_CASE)
        val prefixMatch = prefixPayerRegex.find(text)

        // 2. Detectar remitente después de "de / desde": "Recibiste $50.000 de Carlos Pérez"
        val suffixPayerRegex = Regex("""(?:de|desde)\s+([A-Za-zÁ-ÿ\s]{3,25})(?:\.|\s+a\s+través|\s+por|$)""", RegexOption.IGNORE_CASE)
        val suffixMatch = suffixPayerRegex.find(text)

        val rawPayer = (prefixMatch?.groups?.get(1)?.value ?: suffixMatch?.groups?.get(1)?.value)?.trim()

        val excludedWords = setOf(
            "pago", "transferencia", "plata", "fondos", "nequi", "daviplata",
            "bancolombia", "su", "tu", "un", "una", "cuenta", "origen", "bre-b", "breb"
        )

        val cleanPayer = if (rawPayer != null && !excludedWords.contains(rawPayer.lowercase())) {
            rawPayer
        } else null

        return PaymentAlert(wallet, cleanAmount, cleanPayer)
    }

    fun buildSpeechPhrase(alert: PaymentAlert): String {
        return if (!alert.amountClean.isNullOrBlank()) {
            if (!alert.payer.isNullOrBlank()) {
                "¡Pago confirmado! Recibiste ${alert.amountClean} pesos de ${alert.payer} por ${alert.wallet}."
            } else {
                "¡Pago confirmado! Recibiste ${alert.amountClean} pesos por ${alert.wallet}."
            }
        } else {
            "¡Pago confirmado por ${alert.wallet} recibido con éxito!"
        }
    }
}

/**
 * Gestor de Alertas Sonoras y Síntesis de Voz en Segundo Plano (Ticket Fase 1 - Soundbox Nativo).
 * Blindado contra suspensión de CPU (PARTIAL_WAKE_LOCK dedicado), desconexión silenciosa
 * del Binder de Google TTS en pantalla bloqueada y colisiones de canal de audio (AudioFocus + USAGE_MEDIA).
 */
object VoiceAlertManager : TextToSpeech.OnInitListener {
    private const val TAG = "VoiceAlertManager"
    private const val WAKE_LOCK_TAG = "TransferYA:VoiceAlertLock"
    private const val MAX_WAKE_LOCK_MS = 15_000L
    private const val SAFETY_CLEANUP_MS = 14_000L

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var tts: TextToSpeech? = null

    @Volatile
    private var isTtsReady = false

    @Volatile
    private var isInitializing = false

    @Volatile
    private var pendingPhrase: String? = null

    @Volatile
    private var lastAttemptedPhrase: String? = null

    @Volatile
    private var retryCount = 0

    @Volatile
    private var mainHandler: Handler? = null

    private val lockGuard = Any()
    private var alertWakeLock: PowerManager.WakeLock? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var safetyCleanupRunnable: Runnable? = null

    // Cache de deduplicación en memoria para evitar repeticiones en ráfaga (< 15s)
    private val recentAlerts = mutableMapOf<String, Long>()

    private fun getHandler(): Handler {
        if (mainHandler == null) {
            synchronized(this) {
                if (mainHandler == null) {
                    mainHandler = Handler(Looper.getMainLooper())
                }
            }
        }
        return mainHandler!!
    }

    fun parseNotificationText(packageName: String, rawTitle: String, rawText: String): PaymentAlert =
        PaymentNotificationParser.parseNotificationText(packageName, rawTitle, rawText)

    fun buildSpeechPhrase(alert: PaymentAlert): String =
        PaymentNotificationParser.buildSpeechPhrase(alert)

    fun initialize(context: Context) {
        val appCtx = context.applicationContext
        appContext = appCtx
        if (tts == null && !isInitializing) {
            isInitializing = true
            getHandler().post {
                try {
                    tts = TextToSpeech(appCtx, this)
                } catch (e: Exception) {
                    isInitializing = false
                    Log.e(TAG, "Error instanciando TextToSpeech nativo", e)
                }
            }
        }
    }

    private fun resetAndReinitializeTts(phraseToRetry: String) {
        val ctx = appContext ?: return
        pendingPhrase = phraseToRetry
        isTtsReady = false
        isInitializing = true
        getHandler().post {
            try {
                tts?.stop()
                tts?.shutdown()
            } catch (e: Exception) {
                Log.w(TAG, "Advertencia cerrando instancia TTS obsoleta: ${e.message}")
            }
            tts = null
            try {
                Log.i(TAG, "Reinicializando motor TextToSpeech para recuperar conexión en segundo plano")
                tts = TextToSpeech(ctx, this)
            } catch (e: Exception) {
                isInitializing = false
                Log.e(TAG, "Error reinstanciando TextToSpeech nativo", e)
                releaseAudioResources()
            }
        }
    }

    private fun resolvePreferredStreamAndAttributes(context: Context?): Pair<Int, AudioAttributes> {
        val audioManager = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val musicVolume = try {
            audioManager?.getStreamVolume(AudioManager.STREAM_MUSIC) ?: 1
        } catch (_: Exception) {
            1
        }
        val notifVolume = try {
            audioManager?.getStreamVolume(AudioManager.STREAM_NOTIFICATION) ?: 0
        } catch (_: Exception) {
            0
        }

        // Preferir STREAM_MUSIC / USAGE_MEDIA (inmune a colisión con Nequi y supresión OEM con pantalla bloqueada).
        // Solo hacer fallback a STREAM_NOTIFICATION si el usuario tiene Multimedia en 0 y Notificaciones con volumen.
        return if (musicVolume > 0 || notifVolume == 0) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            Pair(AudioManager.STREAM_MUSIC, attrs)
        } else {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            Pair(AudioManager.STREAM_NOTIFICATION, attrs)
        }
    }

    private fun acquireAlertWakeLock(context: Context?, timeoutMs: Long = MAX_WAKE_LOCK_MS) {
        val ctx = context?.applicationContext ?: appContext ?: return
        synchronized(lockGuard) {
            try {
                val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
                if (alertWakeLock == null) {
                    alertWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
                        setReferenceCounted(false)
                    }
                }
                alertWakeLock?.acquire(timeoutMs)
            } catch (e: Exception) {
                Log.w(TAG, "No se pudo adquirir WakeLock para alerta de voz: ${e.message}")
            }
        }
        scheduleSafetyCleanup(SAFETY_CLEANUP_MS)
    }

    private fun scheduleSafetyCleanup(delayMs: Long) {
        val handler = getHandler()
        synchronized(lockGuard) {
            safetyCleanupRunnable?.let { handler.removeCallbacks(it) }
            val runnable = Runnable {
                releaseAudioResources()
            }
            safetyCleanupRunnable = runnable
            handler.postDelayed(runnable, delayMs)
        }
    }

    private fun requestTransientAudioFocus(audioAttributes: AudioAttributes) {
        val ctx = appContext ?: return
        val audioManager = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        synchronized(lockGuard) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
                    val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(audioAttributes)
                        .setAcceptsDelayedFocusGain(false)
                        .setWillPauseWhenDucked(false)
                        .build()
                    audioFocusRequest = req
                    audioManager.requestAudioFocus(req)
                } else {
                    @Suppress("DEPRECATION")
                    audioManager.requestAudioFocus(
                        null,
                        AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
                    )
                }
            } catch (e: Exception) {
                Log.w(TAG, "Advertencia solicitando AudioFocus: ${e.message}")
            }
        }
    }

    private fun releaseAudioResources() {
        val handler = getHandler()
        synchronized(lockGuard) {
            safetyCleanupRunnable?.let { handler.removeCallbacks(it) }
            safetyCleanupRunnable = null

            try {
                val ctx = appContext
                val audioManager = ctx?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
                if (audioManager != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
                        audioFocusRequest = null
                    } else {
                        @Suppress("DEPRECATION")
                        audioManager.abandonAudioFocus(null)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Advertencia liberando AudioFocus: ${e.message}")
            }

            try {
                if (alertWakeLock?.isHeld == true) {
                    alertWakeLock?.release()
                }
            } catch (e: Exception) {
                Log.w(TAG, "Advertencia liberando WakeLock de voz: ${e.message}")
            }
        }
    }

    override fun onInit(status: Int) {
        isInitializing = false
        if (status == TextToSpeech.SUCCESS) {
            val currentTts = tts ?: return
            try {
                val colombianSpanish = Locale.forLanguageTag("es-CO")
                val langResult = currentTts.setLanguage(colombianSpanish)
                if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                    currentTts.setLanguage(Locale.forLanguageTag("es-ES"))
                }
                currentTts.setPitch(1.0f)
                currentTts.setSpeechRate(1.05f)

                val (_, attrs) = resolvePreferredStreamAndAttributes(appContext)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    currentTts.setAudioAttributes(attrs)
                }

                currentTts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {
                        Log.d(TAG, "Reproducción TTS iniciada ($utteranceId)")
                    }

                    override fun onDone(utteranceId: String?) {
                        retryCount = 0
                        lastAttemptedPhrase = null
                        releaseAudioResources()
                    }

                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) {
                        handleTtsUtteranceError(utteranceId, -1)
                    }

                    override fun onError(utteranceId: String?, errorCode: Int) {
                        handleTtsUtteranceError(utteranceId, errorCode)
                    }
                })

                isTtsReady = true
                Log.i(TAG, "Motor TextToSpeech inicializado exitosamente en español")

                val pending = pendingPhrase
                if (!pending.isNullOrBlank()) {
                    pendingPhrase = null
                    speakText(pending)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error configurando idioma de TextToSpeech", e)
                releaseAudioResources()
            }
        } else {
            isTtsReady = false
            Log.w(TAG, "Fallo al inicializar TextToSpeech (status=$status)")
            releaseAudioResources()
        }
    }

    private fun handleTtsUtteranceError(utteranceId: String?, errorCode: Int) {
        Log.w(TAG, "Error durante reproducción TTS (utterance=$utteranceId, code=$errorCode)")
        val phraseToRetry = lastAttemptedPhrase
        if (!phraseToRetry.isNullOrBlank() && retryCount < 1) {
            retryCount += 1
            resetAndReinitializeTts(phraseToRetry)
        } else {
            retryCount = 0
            lastAttemptedPhrase = null
            releaseAudioResources()
        }
    }

    fun playChime(context: Context) {
        appContext = context.applicationContext
        val (streamType, _) = resolvePreferredStreamAndAttributes(context)
        try {
            val toneGen = ToneGenerator(streamType, 95)
            toneGen.startTone(ToneGenerator.TONE_PROP_ACK, 250)
            getHandler().postDelayed({
                try {
                    toneGen.release()
                } catch (_: Exception) {
                    // Ignorar liberación
                }
            }, 400)
        } catch (e: Exception) {
            try {
                val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                val ringtone = RingtoneManager.getRingtone(context.applicationContext, uri)
                ringtone?.play()
            } catch (ex: Exception) {
                Log.w(TAG, "No se pudo reproducir chime de notificación: ${ex.message}")
            }
        }
    }

    fun speakText(phrase: String) {
        acquireAlertWakeLock(appContext)
        lastAttemptedPhrase = phrase

        val currentTts = tts
        if (!isTtsReady || currentTts == null) {
            pendingPhrase = phrase
            if (!isInitializing) {
                appContext?.let { initialize(it) }
            }
            return
        }

        getHandler().post {
            try {
                val (streamType, audioAttributes) = resolvePreferredStreamAndAttributes(appContext)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    currentTts.setAudioAttributes(audioAttributes)
                }
                requestTransientAudioFocus(audioAttributes)

                val utteranceId = "alert_${System.currentTimeMillis()}"
                val speakResult = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    val params = Bundle().apply {
                        putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, streamType)
                        putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f)
                    }
                    currentTts.speak(phrase, TextToSpeech.QUEUE_FLUSH, params, utteranceId)
                } else {
                    @Suppress("DEPRECATION")
                    val map = HashMap<String, String>().apply {
                        put(TextToSpeech.Engine.KEY_PARAM_STREAM, streamType.toString())
                        put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
                    }
                    @Suppress("DEPRECATION")
                    currentTts.speak(phrase, TextToSpeech.QUEUE_FLUSH, map)
                }

                if (speakResult == TextToSpeech.ERROR) {
                    Log.w(TAG, "tts.speak retornó ERROR (posible binder desconectado en pantalla bloqueada). Reintentando...")
                    if (retryCount < 1) {
                        retryCount += 1
                        resetAndReinitializeTts(phrase)
                    } else {
                        retryCount = 0
                        lastAttemptedPhrase = null
                        releaseAudioResources()
                    }
                } else {
                    Log.i(TAG, "Enunciando alerta de voz (stream=$streamType): \"$phrase\"")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error ejecutando tts.speak", e)
                if (retryCount < 1) {
                    retryCount += 1
                    resetAndReinitializeTts(phrase)
                } else {
                    retryCount = 0
                    lastAttemptedPhrase = null
                    releaseAudioResources()
                }
            }
        }
    }

    fun handleIncomingNotification(
        context: Context,
        packageName: String,
        rawTitle: String,
        rawText: String,
        isLive: Boolean = true
    ) {
        if (!isLive) {
            Log.d(TAG, "Notificación histórica o represada omitida de alerta sonora")
            return
        }

        appContext = context.applicationContext
        initialize(context)
        val storage = SharedPreferencesCredentialsStorage(context)
        val chimeEnabled = storage.isChimeAlertsEnabled()
        val voiceEnabled = storage.isVoiceAlertsEnabled()

        if (!chimeEnabled && !voiceEnabled) {
            Log.d(TAG, "Alertas sonoras y voz desactivadas por el usuario en Centinela")
            return
        }

        val alert = parseNotificationText(packageName, rawTitle, rawText)

        // Ventana de deduplicación (15s): evitar que la misma alerta hable dos veces seguidas
        val alertKey = "${alert.wallet}:${alert.amountClean ?: alert.payer ?: "gen"}"
        val now = System.currentTimeMillis()
        val isDuplicate = synchronized(recentAlerts) {
            val last = recentAlerts[alertKey] ?: 0L
            if (now - last < 15_000L) {
                true
            } else {
                recentAlerts[alertKey] = now
                false
            }
        }
        if (isDuplicate) {
            Log.d(TAG, "Alerta sonora descartada por deduplicación en ráfaga (< 15s): $alertKey")
            return
        }

        // Mantener el CPU despierto desde t=0ms hasta que termine tanto el timbre como el dictado TTS
        acquireAlertWakeLock(context)
        retryCount = 0

        // 1. Timbre de cobro (suena primero)
        if (chimeEnabled) {
            playChime(context)
        }

        // 2. Voz en español (suena ~450ms después para no sobreponerse al timbre)
        if (voiceEnabled) {
            val phrase = buildSpeechPhrase(alert)
            getHandler().postDelayed({
                speakText(phrase)
            }, if (chimeEnabled) 450L else 0L)
        } else {
            // Solo timbre: liberar WakeLock apenas termina el tono
            scheduleSafetyCleanup(1_200L)
        }
    }

    fun playTestAlert(context: Context) {
        appContext = context.applicationContext
        initialize(context)
        val storage = SharedPreferencesCredentialsStorage(context)
        val chimeEnabled = storage.isChimeAlertsEnabled()
        val voiceEnabled = storage.isVoiceAlertsEnabled()

        acquireAlertWakeLock(context)
        retryCount = 0

        if (chimeEnabled) {
            playChime(context)
        }

        if (voiceEnabled) {
            val testPhrase = "¡TransferYA Centinela! Prueba de voz exitosa. Recibiste cincuenta mil pesos por Nequi."
            getHandler().postDelayed({
                speakText(testPhrase)
            }, if (chimeEnabled) 450L else 0L)
        } else {
            scheduleSafetyCleanup(1_200L)
        }
    }
}
