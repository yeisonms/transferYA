package com.transferya.sentinel.onboarding

import com.transferya.sentinel.crypto.IKeyStoreVault
import java.net.URLDecoder

/**
 * Parser estándar para el URI canónico de enrolamiento de TransferYA.
 * Ejemplo: transferya://enroll?token=abcdef...&deviceId=dev_centinela_1
 */
class TransferYaQrParser : IQrPayloadParser {
    override fun parse(rawQrContent: String): EnrollmentQrPayload? {
        val trimmed = rawQrContent.trim()
        if (!trimmed.startsWith("transferya://enroll?")) {
            return null
        }

        val queryString = trimmed.substringAfter("transferya://enroll?")
        val params = queryString.split("&").mapNotNull { param ->
            val parts = param.split("=", limit = 2)
            if (parts.size == 2) {
                val value = try {
                    URLDecoder.decode(parts[1], "UTF-8")
                } catch (_: Exception) {
                    parts[1]
                }
                parts[0] to value
            } else null
        }.toMap()

        val token = params["token"]?.trim()?.takeIf { it.isNotBlank() } ?: return null
        val deviceId = params["deviceId"]?.trim()?.takeIf { it.isNotBlank() } ?: return null

        return EnrollmentQrPayload(token = token, deviceId = deviceId)
    }
}

/**
 * Gestor integral de enrolamiento y ciclo de vida de credenciales del Centinela (ADR-0004).
 */
class DeviceEnrollmentManager(
    private val qrParser: IQrPayloadParser = TransferYaQrParser(),
    private val httpClient: IEnrollmentHttpClient,
    private val keyStoreVault: IKeyStoreVault,
    private val credentialsStorage: IDeviceCredentialsStorage
) {
    companion object {
        const val KEYSTORE_ALIAS_SECRET = "sentinel_hmac_secret"
    }

    /**
     * Consulta el estado de activación del Dispositivo Centinela.
     */
    fun getSentinelState(): SentinelState {
        val hasSecret = keyStoreVault.hasSecret(KEYSTORE_ALIAS_SECRET)
        val hasDeviceId = !credentialsStorage.getDeviceId().isNullOrBlank()

        return if (hasSecret && hasDeviceId) {
            SentinelState.ACTIVE_SENTINEL
        } else {
            SentinelState.UNENROLLED
        }
    }

    /**
     * Ejecuta el emparejamiento físico a partir del contenido de un código QR escaneado.
     */
    fun enrollFromQr(rawQrContent: String): EnrollmentResult {
        val qrPayload = qrParser.parse(rawQrContent)
            ?: return EnrollmentResult(
                isSuccess = false,
                errorMessage = "Formato de código QR inválido"
            )

        val response = try {
            httpClient.enroll(qrPayload.token, qrPayload.deviceId)
        } catch (e: Exception) {
            return EnrollmentResult(
                isSuccess = false,
                errorMessage = e.message ?: "Error de red durante el enrolamiento"
            )
        }

        if (!response.success || response.deviceSecret.isNullOrBlank() || response.deviceId.isNullOrBlank()) {
            val errorMsg = response.message ?: response.error ?: "Fallo de autorización de enrolamiento"
            return EnrollmentResult(
                isSuccess = false,
                errorMessage = errorMsg
            )
        }

        return try {
            val secretBytes = hexToByteArray(response.deviceSecret)
            keyStoreVault.storeSecret(KEYSTORE_ALIAS_SECRET, secretBytes)
            credentialsStorage.saveDeviceId(response.deviceId)
            response.merchantId?.let { credentialsStorage.saveMerchantId(it) }

            EnrollmentResult(
                isSuccess = true,
                deviceId = response.deviceId,
                merchantId = response.merchantId
            )
        } catch (e: Exception) {
            EnrollmentResult(
                isSuccess = false,
                errorMessage = "Error persistiendo claves en KeyStore: ${e.message}"
            )
        }
    }

    /**
     * Restablece el dispositivo eliminando las credenciales criptográficas del KeyStore.
     */
    fun resetEnrollment() {
        keyStoreVault.removeSecret(KEYSTORE_ALIAS_SECRET)
        credentialsStorage.clearDeviceId()
        credentialsStorage.clearMerchantId()
    }

    private fun hexToByteArray(hex: String): ByteArray {
        val cleanHex = hex.trim()
        val len = cleanHex.length
        val data = ByteArray(len / 2)
        var i = 0
        while (i < len) {
            data[i / 2] = ((Character.digit(cleanHex[i], 16) shl 4) +
                    Character.digit(cleanHex[i + 1], 16)).toByte()
            i += 2
        }
        return data
    }
}
