package com.transferya.sentinel.crypto

/**
 * Parámetros para la canonicalización determinista según ADR-0002.
 */
data class CanonicalParams(
    val method: String,
    val path: String,
    val timestamp: Long,
    val nonce: String,
    val body: String
)

/**
 * Cabeceras HTTP firmadas listas para ser inyectadas en peticiones hacia el Webhook.
 */
data class SignedHeaders(
    val deviceId: String,
    val timestamp: Long,
    val nonce: String,
    val signature: String
) {
    fun toHeaderMap(): Map<String, String> = mapOf(
        "X-Device-Id" to deviceId,
        "X-Timestamp" to timestamp.toString(),
        "X-Nonce" to nonce,
        "X-Signature" to signature
    )
}

/**
 * Abstracción del almacén de claves criptográficas (enclave seguro / KeyStore).
 */
interface IKeyStoreVault {
    fun storeSecret(alias: String, secret: ByteArray)
    fun getSecret(alias: String): ByteArray?
    fun hasSecret(alias: String): Boolean
    fun removeSecret(alias: String)
}

/**
 * Contrato del generador de firmas HMAC-SHA256 y nonces efímeros para el Centinela.
 */
interface IHmacSigner {
    fun buildCanonicalString(params: CanonicalParams): String
    fun generateNonce(): String
    fun sign(method: String, path: String, timestamp: Long, nonce: String, payloadJson: String): String
    fun buildSignedHeaders(
        deviceId: String,
        method: String,
        path: String,
        payloadJson: String,
        timestamp: Long = System.currentTimeMillis()
    ): SignedHeaders
}

