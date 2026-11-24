package com.transferya.sentinel.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
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

        // Regex para detectar monto colombiano: $50.000, $ 50.000, $50000, $150.000,00
        val amountRegex = Regex("""\$\s*([\d\.\,]{2,12})""")
        val amountMatch = amountRegex.find(combined)
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
 * Convierte el smartphone de cobro en una Caja Parlante: anuncia pagos en voz alta e instantáneamente
 * al recibir notificaciones de Nequi, DaviPlata o Bancolombia, incluso con la pantalla bloqueada.
 */
object VoiceAlertManager : TextToSpeech.OnInitListener {
    private const val TAG = "VoiceAlertManager"

    @Volatile
    private var tts: TextToSpeech? = null

    @Volatile
    private var isTtsReady = false

    @Volatile
    private var pendingPhrase: String? = null

    @Volatile
    private var mainHandler: Handler? = null

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
        if (tts == null) {
            getHandler().post {
                try {
                    tts = TextToSpeech(context.applicationContext, this)
                } catch (e: Exception) {
                    Log.e(TAG, "Error instanciando TextToSpeech nativo", e)
                }
            }
        }
    }

    override fun onInit(status: Int) {
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

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    val audioAttributes = AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                    currentTts.setAudioAttributes(audioAttributes)
                }

                isTtsReady = true
                Log.i(TAG, "Motor TextToSpeech inicializado exitosamente en español")

                val pending = pendingPhrase
                if (!pending.isNullOrBlank()) {
                    pendingPhrase = null
                    speakText(pending)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error configurando idioma de TextToSpeech", e)
            }
        } else {
            Log.w(TAG, "Fallo al inicializar TextToSpeech (status=$status)")
        }
    }

    fun playChime(context: Context) {
        try {
            val toneGen = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 95)
            toneGen.startTone(ToneGenerator.TONE_PROP_ACK, 250)
            getHandler().postDelayed({
                try {
                    toneGen.release()
                } catch (e: Exception) {
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
        if (!isTtsReady) {
            pendingPhrase = phrase
            return
        }
        val currentTts = tts ?: return
        getHandler().post {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    val params = Bundle().apply {
                        putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_NOTIFICATION)
                    }
                    currentTts.speak(phrase, TextToSpeech.QUEUE_FLUSH, params, "alert_${System.currentTimeMillis()}")
                } else {
                    @Suppress("DEPRECATION")
                    val map = HashMap<String, String>().apply {
                        put(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_NOTIFICATION.toString())
                    }
                    @Suppress("DEPRECATION")
                    currentTts.speak(phrase, TextToSpeech.QUEUE_FLUSH, map)
                }
                Log.i(TAG, "Enunciando alerta de voz: \"$phrase\"")
            } catch (e: Exception) {
                Log.e(TAG, "Error ejecutando tts.speak", e)
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
        }
    }

    fun playTestAlert(context: Context) {
        initialize(context)
        val storage = SharedPreferencesCredentialsStorage(context)
        val chimeEnabled = storage.isChimeAlertsEnabled()
        val voiceEnabled = storage.isVoiceAlertsEnabled()

        if (chimeEnabled) {
            playChime(context)
        }

        if (voiceEnabled) {
            val testPhrase = "¡TransferYA Centinela! Prueba de voz exitosa. Recibiste cincuenta mil pesos por Nequi."
            getHandler().postDelayed({
                speakText(testPhrase)
            }, if (chimeEnabled) 450L else 0L)
        }
    }
}
