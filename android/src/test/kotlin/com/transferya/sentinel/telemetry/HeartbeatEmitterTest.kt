package com.transferya.sentinel.telemetry

import com.transferya.sentinel.crypto.HmacSigner
import com.transferya.sentinel.crypto.HmacSignerTest
import com.transferya.sentinel.dispatcher.HttpCallResponse
import com.transferya.sentinel.dispatcher.ISentinelHttpClient
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class HeartbeatEmitterTest {

    private lateinit var signer: HmacSigner
    private lateinit var mockHttpClient: MockTelemetryHttpClient
    private lateinit var mockStatusProvider: MockDeviceStatusProvider
    private lateinit var emitter: HeartbeatEmitter

    private val testDeviceId = "centinela-heartbeat-001"
    private val testHeartbeatUrl = "https://api.transferya.co/api/v1/devices/heartbeat"
    private val fixedNow = 1700000000000L

    class MockTelemetryHttpClient : ISentinelHttpClient {
        var responseCode = 200
        var recordedUrl: String? = null
        var recordedHeaders: Map<String, String>? = null
        var recordedBody: String? = null

        override fun post(url: String, headers: Map<String, String>, bodyJson: String): HttpCallResponse {
            recordedUrl = url
            recordedHeaders = headers
            recordedBody = bodyJson
            return HttpCallResponse(responseCode, """{"success":true}""")
        }
    }

    class MockDeviceStatusProvider : IDeviceStatusProvider {
        override fun getBatteryLevel(): Int = 92
        override fun isCharging(): Boolean = true
        override fun getNetworkType(): String = "WIFI"
        override fun getAppVersion(): String = "1.0.0"
    }

    @BeforeEach
    fun setUp() {
        val mockVault = HmacSignerTest.InMemoryKeyStoreVault()
        mockVault.storeSecret("heartbeat_key", "secret-test-key-heartbeat-99".toByteArray(Charsets.UTF_8))
        signer = HmacSigner(mockVault, "heartbeat_key")

        mockHttpClient = MockTelemetryHttpClient()
        mockStatusProvider = MockDeviceStatusProvider()

        emitter = HeartbeatEmitter(
            deviceStatusProvider = mockStatusProvider,
            signer = signer,
            httpClient = mockHttpClient,
            heartbeatUrl = testHeartbeatUrl,
            deviceId = testDeviceId,
            nowProvider = { fixedNow }
        )
    }

    @Test
    fun `1 debe emitir ping de telemetria firmado hacia el backend exitosamente ante HTTP 200`() {
        val success = emitter.emitHeartbeat()

        assertTrue(success)
        assertEquals(testHeartbeatUrl, mockHttpClient.recordedUrl)

        val headers = mockHttpClient.recordedHeaders!!
        assertEquals(testDeviceId, headers["X-Device-Id"])
        assertEquals(fixedNow.toString(), headers["X-Timestamp"])
        assertNotNull(headers["X-Nonce"])
        assertNotNull(headers["X-Signature"])

        val body = mockHttpClient.recordedBody!!
        assertTrue(body.contains("\"battery_level\":92"))
        assertTrue(body.contains("\"is_charging\":true"))
        assertTrue(body.contains("\"network_type\":\"WIFI\""))
        assertTrue(body.contains("\"sent_at\":$fixedNow"))
    }

    @Test
    fun `2 debe retornar false y manejar fallos de conexion sin lanzar excepciones`() {
        mockHttpClient.responseCode = 503

        val success = emitter.emitHeartbeat()

        assertFalse(success, "Debe retornar false si el backend responde con error de servidor")
    }
}

