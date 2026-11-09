package com.transferya.sentinel.crypto

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.util.UUID

class HmacSignerTest {

    private val testAlias = "sentinel_device_key"
    private val testSecret = "super-secure-device-secret-key-12345"
    private val fixedNow = 1700000000000L
    private val validNonce = "d3b07384-d113-4682-a7f4-b2ef3a6b8256"

    private lateinit var mockVault: InMemoryKeyStoreVault
    private lateinit var signer: HmacSigner

    class InMemoryKeyStoreVault : IKeyStoreVault {
        private val storage = mutableMapOf<String, ByteArray>()
        override fun storeSecret(alias: String, secret: ByteArray) { storage[alias] = secret }
        override fun getSecret(alias: String): ByteArray? = storage[alias]
        override fun hasSecret(alias: String): Boolean = storage.containsKey(alias)
        override fun removeSecret(alias: String) { storage.remove(alias) }
    }

    @BeforeEach
    fun setUp() {
        mockVault = InMemoryKeyStoreVault()
        mockVault.storeSecret(testAlias, testSecret.toByteArray(Charsets.UTF_8))
        signer = HmacSigner(mockVault, testAlias)
    }

    @Test
    fun `1 debe construir la cadena canonica idéntica al formato de Node (Ticket 01)`() {
        val params = CanonicalParams(
            method = "post",
            path = "/api/v1/webhooks/notifications",
            timestamp = fixedNow,
            nonce = validNonce,
            body = "{\"test\":true}"
        )

        val canonical = signer.buildCanonicalString(params)

        // SHA-256 de '{"test":true}' es "6fd977db9b2afe87a9ceee48432881299a6aaf83d935fbbe83007660287f9c2e"
        val expected = "POST|/api/v1/webhooks/notifications|1700000000000|d3b07384-d113-4682-a7f4-b2ef3a6b8256|6fd977db9b2afe87a9ceee48432881299a6aaf83d935fbbe83007660287f9c2e"
        assertEquals(expected, canonical)
    }

    @Test
    fun `2 debe generar nonces criptograficos unicos y sin colisiones`() {
        val nonces = (1..500).map { signer.generateNonce() }.toSet()
        assertEquals(500, nonces.size, "Todos los nonces generados deben ser únicos")
        
        // Verificar que cumpla formato UUID seguro
        val sampleNonce = signer.generateNonce()
        assertDoesNotThrow { UUID.fromString(sampleNonce) }
    }

    @Test
    fun `3 debe firmar con HMAC-SHA256 produciendo firma hexadecimal valida`() {
        val signature = signer.sign(
            method = "POST",
            path = "/api/v1/webhooks/notifications",
            timestamp = fixedNow,
            nonce = validNonce,
            payloadJson = "{\"test\":true}"
        )

        assertNotNull(signature)
        assertEquals(64, signature.length, "La firma HMAC-SHA256 en hex debe tener exactamente 64 caracteres")
        assertTrue(signature.matches(Regex("^[a-f0-9]{64}$")), "La firma debe estar en minúsculas y caracteres hexadecimales válidos")
    }

    @Test
    fun `4 debe generar las cabeceras HTTP firmadas completas`() {
        val headers = signer.buildSignedHeaders(
            deviceId = "centinela-001",
            method = "POST",
            path = "/api/v1/webhooks/notifications",
            payloadJson = "{\"test\":true}",
            timestamp = fixedNow
        )

        assertEquals("centinela-001", headers.deviceId)
        assertEquals(fixedNow, headers.timestamp)
        assertNotNull(headers.nonce)
        assertEquals(64, headers.signature.length)

        val headerMap = headers.toHeaderMap()
        assertEquals("centinela-001", headerMap["X-Device-Id"])
        assertEquals("1700000000000", headerMap["X-Timestamp"])
        assertEquals(headers.nonce, headerMap["X-Nonce"])
        assertEquals(headers.signature, headerMap["X-Signature"])
    }

    @Test
    fun `5 debe lanzar excepcion si la clave secreta no existe en el Vault`() {
        val unconfiguredSigner = HmacSigner(mockVault, "non_existent_alias")
        assertThrows<IllegalStateException> {
            unconfiguredSigner.sign(
                method = "POST",
                path = "/api/v1/webhooks/notifications",
                timestamp = fixedNow,
                nonce = validNonce,
                payloadJson = "{}"
            )
        }
    }

    @Test
    fun `6 debe almacenar y recuperar secretos correctamente en AndroidKeyStoreVault`() {
        val vault = AndroidKeyStoreVault()
        val alias = "test_device_secret"
        val rawSecret = "my-secret-key-bytes".toByteArray(Charsets.UTF_8)

        assertFalse(vault.hasSecret(alias))
        assertNull(vault.getSecret(alias))

        vault.storeSecret(alias, rawSecret)
        assertTrue(vault.hasSecret(alias))
        assertArrayEquals(rawSecret, vault.getSecret(alias))

        vault.removeSecret(alias)
        assertFalse(vault.hasSecret(alias))
        assertNull(vault.getSecret(alias))
    }
}

