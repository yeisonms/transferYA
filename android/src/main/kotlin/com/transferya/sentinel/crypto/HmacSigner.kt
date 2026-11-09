package com.transferya.sentinel.crypto

import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Implementación de producción del firmador HMAC para Android Centinela (ADR-0002).
 * Garantiza paridad estricta con el validador Node.js del backend.
 */
class HmacSigner(
    private val vault: IKeyStoreVault,
    private val secretAlias: String
) : IHmacSigner {

    private fun sha256Hex(data: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(data.toByteArray(Charsets.UTF_8))
        return hashBytes.joinToString("") { "%02x".format(it) }
    }

    override fun buildCanonicalString(params: CanonicalParams): String {
        val method = params.method.uppercase()
        val path = params.path
        val timestamp = params.timestamp.toString()
        val nonce = params.nonce
        val bodyHash = sha256Hex(params.body)

        return "$method|$path|$timestamp|$nonce|$bodyHash"
    }

    override fun generateNonce(): String {
        return UUID.randomUUID().toString()
    }

    override fun sign(
        method: String,
        path: String,
        timestamp: Long,
        nonce: String,
        payloadJson: String
    ): String {
        val secretBytes = vault.getSecret(secretAlias)
            ?: throw IllegalStateException("Secret key not found in vault for alias: $secretAlias")

        val canonical = buildCanonicalString(
            CanonicalParams(
                method = method,
                path = path,
                timestamp = timestamp,
                nonce = nonce,
                body = payloadJson
            )
        )

        val mac = Mac.getInstance("HmacSHA256")
        val keySpec = SecretKeySpec(secretBytes, "HmacSHA256")
        mac.init(keySpec)

        val hmacBytes = mac.doFinal(canonical.toByteArray(Charsets.UTF_8))
        return hmacBytes.joinToString("") { "%02x".format(it) }
    }

    override fun buildSignedHeaders(
        deviceId: String,
        method: String,
        path: String,
        payloadJson: String,
        timestamp: Long
    ): SignedHeaders {
        val nonce = generateNonce()
        val signature = sign(
            method = method,
            path = path,
            timestamp = timestamp,
            nonce = nonce,
            payloadJson = payloadJson
        )

        return SignedHeaders(
            deviceId = deviceId,
            timestamp = timestamp,
            nonce = nonce,
            signature = signature
        )
    }
}
