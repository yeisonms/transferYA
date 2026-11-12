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

    @Test
    fun `3 debe decodificar el payload comercial de suscripcion y notificar a onResponseReceived (Ticket 21)`() {
        var receivedResponse: HeartbeatResponse? = null
        val mockVault = HmacSignerTest.InMemoryKeyStoreVault()
        mockVault.storeSecret("heartbeat_key", "secret-test-key-heartbeat-99".toByteArray(Charsets.UTF_8))
        val customSigner = HmacSigner(mockVault, "heartbeat_key")

        val commercialClient = object : ISentinelHttpClient {
            override fun post(url: String, headers: Map<String, String>, bodyJson: String): HttpCallResponse {
                val json = """{"success":true,"subscription_status":"PAST_DUE","subscription_ends_at":"2026-11-12T00:00:00.000Z","subscription_ends_at_ms":1700000000000,"remaining_days":0,"billing_qr_payload":"https://recarga.nequi.com.co/bdigital/?phone=3113654315&amount=50000","billing_amount_cop":50000}"""
                return HttpCallResponse(200, json)
            }
        }

        val commercialEmitter = HeartbeatEmitter(
            deviceStatusProvider = mockStatusProvider,
            signer = customSigner,
            httpClient = commercialClient,
            heartbeatUrl = testHeartbeatUrl,
            deviceId = testDeviceId,
            nowProvider = { fixedNow },
            onResponseReceived = { resp -> receivedResponse = resp }
        )

        val success = commercialEmitter.emitHeartbeat()

        assertTrue(success)
        assertNotNull(receivedResponse)
        assertEquals("PAST_DUE", receivedResponse?.subscriptionStatus)
        assertEquals(0, receivedResponse?.remainingDays)
        assertEquals(50000L, receivedResponse?.billingAmountCop)
        assertEquals("https://recarga.nequi.com.co/bdigital/?phone=3113654315&amount=50000", receivedResponse?.billingQrPayload)
        assertEquals(1700000000000L, receivedResponse?.subscriptionEndsAtMs)
    }
}

