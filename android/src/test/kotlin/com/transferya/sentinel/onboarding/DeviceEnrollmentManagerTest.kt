package com.transferya.sentinel.onboarding

import com.transferya.sentinel.crypto.IKeyStoreVault
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class DeviceEnrollmentManagerTest {

    private lateinit var mockKeyStoreVault: MockKeyStoreVault
    private lateinit var mockStorage: MockCredentialsStorage
    private lateinit var mockHttpClient: MockEnrollmentHttpClient
    private lateinit var qrParser: IQrPayloadParser
    private lateinit var manager: DeviceEnrollmentManager

    class MockKeyStoreVault : IKeyStoreVault {
        val storage = mutableMapOf<String, ByteArray>()
        override fun storeSecret(alias: String, secret: ByteArray) { storage[alias] = secret }
        override fun getSecret(alias: String): ByteArray? = storage[alias]
        override fun hasSecret(alias: String): Boolean = storage.containsKey(alias)
        override fun removeSecret(alias: String) { storage.remove(alias) }
    }

    class MockCredentialsStorage : IDeviceCredentialsStorage {
        var storedDeviceId: String? = null
        var storedMerchantId: String? = null

        override fun getDeviceId(): String? = storedDeviceId
        override fun saveDeviceId(deviceId: String) { storedDeviceId = deviceId }
        override fun clearDeviceId() { storedDeviceId = null }

        override fun getMerchantId(): String? = storedMerchantId
        override fun saveMerchantId(merchantId: String) { storedMerchantId = merchantId }
        override fun clearMerchantId() { storedMerchantId = null }
    }

    class MockEnrollmentHttpClient : IEnrollmentHttpClient {
        var responseToReturn: EnrollmentResponse = EnrollmentResponse(success = true)
        var lastTokenPassed: String? = null
        var lastDeviceIdPassed: String? = null

        override fun enroll(token: String, deviceId: String): EnrollmentResponse {
            lastTokenPassed = token
            lastDeviceIdPassed = deviceId
            return responseToReturn
        }
    }

    @BeforeEach
    fun setUp() {
        mockKeyStoreVault = MockKeyStoreVault()
        mockStorage = MockCredentialsStorage()
        mockHttpClient = MockEnrollmentHttpClient()
        qrParser = TransferYaQrParser()

        manager = DeviceEnrollmentManager(
            qrParser = qrParser,
            httpClient = mockHttpClient,
            keyStoreVault = mockKeyStoreVault,
            credentialsStorage = mockStorage
        )
    }

    @Test
    fun `1 Parser de QR debe extraer correctamente token y deviceId del protocolo transferya`() {
        val rawQr = "transferya://enroll?token=tok_abc123456&deviceId=dev_caja_1"
        val payload = qrParser.parse(rawQr)

        assertNotNull(payload)
        assertEquals("tok_abc123456", payload?.token)
        assertEquals("dev_caja_1", payload?.deviceId)
    }

    @Test
    fun `2 Parser de QR debe rechazar URIs con esquema invalido o parametros incompletos`() {
        assertNull(qrParser.parse("https://transferya.co/enroll?token=123"))
        assertNull(qrParser.parse("transferya://enroll?token=123")) // Falta deviceId
        assertNull(qrParser.parse("transferya://enroll?deviceId=caja_1")) // Falta token
        assertNull(qrParser.parse("texto_plano_no_uri"))
    }

    @Test
    fun `3 Dispositivo sin credenciales debe reportar estado UNENROLLED`() {
        assertEquals(SentinelState.UNENROLLED, manager.getSentinelState())
    }

    @Test
    fun `4 Flujo Feliz de Enrolamiento debe almacenar secreto en KeyStore y transicionar a ACTIVE_SENTINEL`() {
        val rawQr = "transferya://enroll?token=tok_valido_99&deviceId=dev_centinela_caja_1"
        val mockSecretHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

        mockHttpClient.responseToReturn = EnrollmentResponse(
            success = true,
            deviceId = "dev_centinela_caja_1",
            deviceSecret = mockSecretHex,
            merchantId = "merchant_el_sol"
        )

        val result = manager.enrollFromQr(rawQr)

        assertTrue(result.isSuccess)
        assertEquals("dev_centinela_caja_1", result.deviceId)
        assertEquals("merchant_el_sol", result.merchantId)

        // Verificar llamada al cliente HTTP
        assertEquals("tok_valido_99", mockHttpClient.lastTokenPassed)
        assertEquals("dev_centinela_caja_1", mockHttpClient.lastDeviceIdPassed)

        // Verificar que el secreto se almacenó en el KeyStore
        assertTrue(mockKeyStoreVault.hasSecret(DeviceEnrollmentManager.KEYSTORE_ALIAS_SECRET))
        val storedSecret = mockKeyStoreVault.getSecret(DeviceEnrollmentManager.KEYSTORE_ALIAS_SECRET)
        assertNotNull(storedSecret)
        assertEquals(32, storedSecret?.size) // 32 bytes binarios

        // Verificar persistencia de IDs
        assertEquals("dev_centinela_caja_1", mockStorage.getDeviceId())
        assertEquals("merchant_el_sol", mockStorage.getMerchantId())

        // El estado ahora debe ser ACTIVE_SENTINEL
        assertEquals(SentinelState.ACTIVE_SENTINEL, manager.getSentinelState())
    }

    @Test
    fun `5 Enrolamiento con QR malformado debe fallar sin contactar al servidor`() {
        val result = manager.enrollFromQr("qr_invalido_123")

        assertFalse(result.isSuccess)
        assertTrue(result.errorMessage!!.contains("QR", ignoreCase = true))
        assertNull(mockHttpClient.lastTokenPassed)
        assertEquals(SentinelState.UNENROLLED, manager.getSentinelState())
    }

    @Test
    fun `6 Fallo de red o token expirado en servidor debe retornar error y no alterar KeyStore`() {
        val rawQr = "transferya://enroll?token=tok_expirado&deviceId=dev_centinela_caja_1"

        mockHttpClient.responseToReturn = EnrollmentResponse(
            success = false,
            error = "TOKEN_EXPIRED",
            message = "El token de enrolamiento ha expirado"
        )

        val result = manager.enrollFromQr(rawQr)

        assertFalse(result.isSuccess)
        assertEquals("El token de enrolamiento ha expirado", result.errorMessage)
        assertFalse(mockKeyStoreVault.hasSecret(DeviceEnrollmentManager.KEYSTORE_ALIAS_SECRET))
        assertNull(mockStorage.getDeviceId())
        assertEquals(SentinelState.UNENROLLED, manager.getSentinelState())
    }

    @Test
    fun `7 Reset de enrolamiento debe purgar KeyStore y SharedPreferences retornando a UNENROLLED`() {
        // Simular dispositivo previamente enrolado
        mockStorage.saveDeviceId("dev_1")
        mockStorage.saveMerchantId("merch_1")
        mockKeyStoreVault.storeSecret(DeviceEnrollmentManager.KEYSTORE_ALIAS_SECRET, ByteArray(32))

        assertEquals(SentinelState.ACTIVE_SENTINEL, manager.getSentinelState())

        manager.resetEnrollment()

        assertFalse(mockKeyStoreVault.hasSecret(DeviceEnrollmentManager.KEYSTORE_ALIAS_SECRET))
        assertNull(mockStorage.getDeviceId())
        assertNull(mockStorage.getMerchantId())
        assertEquals(SentinelState.UNENROLLED, manager.getSentinelState())
    }

    @Test
    fun `8 Parser de QR debe limpiar espacios alrededor y decodificar parametros URL-encoded`() {
        val rawQr = "  transferya://enroll?token=tok_clean_99&deviceId=dev_caja%5Fprincipal  \n"
        val payload = qrParser.parse(rawQr)

        assertNotNull(payload)
        assertEquals("tok_clean_99", payload?.token)
        assertEquals("dev_caja_principal", payload?.deviceId)
    }
}

