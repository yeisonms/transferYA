package com.transferya.sentinel.onboarding

/**
 * Estados del ciclo de vida de enrolamiento del Dispositivo Centinela (ADR-0004).
 */
enum class SentinelState {
    UNENROLLED,
    ENROLLING,
    ACTIVE_SENTINEL,
    REVOKED
}

/**
 * Estructura de datos decodificada a partir del código QR escaneado en el punto de venta.
 * URI canónico: transferya://enroll?token=<token>&deviceId=<deviceId>
 */
data class EnrollmentQrPayload(
    val token: String,
    val deviceId: String
)

/**
 * Respuesta estructurada del endpoint HTTPS /api/v1/devices/enroll.
 */
data class EnrollmentResponse(
    val success: Boolean,
    val deviceId: String? = null,
    val deviceSecret: String? = null,
    val merchantId: String? = null,
    val error: String? = null,
    val message: String? = null
)

/**
 * Resultado de dominio de la operación de emparejamiento.
 */
data class EnrollmentResult(
    val isSuccess: Boolean,
    val deviceId: String? = null,
    val merchantId: String? = null,
    val errorMessage: String? = null
)

/**
 * Contrato de cliente HTTP nativo para la llamada TLS de enrolamiento.
 */
interface IEnrollmentHttpClient {
    fun enroll(token: String, deviceId: String): EnrollmentResponse
}

/**
 * Almacenamiento local de identificadores no secretos (SharedPreferences / EncryptedSharedPreferences).
 */
interface IDeviceCredentialsStorage {
    fun getDeviceId(): String?
    fun saveDeviceId(deviceId: String)
    fun clearDeviceId()

    fun getMerchantId(): String?
    fun saveMerchantId(merchantId: String)
    fun clearMerchantId()
}

/**
 * Parser de códigos QR del protocolo TransferYA.
 */
interface IQrPayloadParser {
    fun parse(rawQrContent: String): EnrollmentQrPayload?
}

