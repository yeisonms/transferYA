package com.transferya.sentinel.dispatcher

import com.transferya.sentinel.crypto.*
import com.transferya.sentinel.storage.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class NotificationDispatcherTest {

    private lateinit var dao: SqliteNotificationDao
    private lateinit var signer: HmacSigner
    private lateinit var mockHttpClient: MockHttpClient
    private lateinit var mockConnectivity: MockConnectivityProvider
    private lateinit var dispatcher: NotificationDispatcher

    private val testDeviceId = "centinela-disp-001"
    private val testWebhookUrl = "https://api.transferya.co/api/v1/webhooks/notifications"
    private val fixedNow = 1700000000000L

    class MockHttpClient : ISentinelHttpClient {
        var nextResponse: HttpCallResponse = HttpCallResponse(202, """{"success":true}""")
        val recordedCalls = mutableListOf<RecordedCall>()

        data class RecordedCall(val url: String, val headers: Map<String, String>, val bodyJson: String)

        override fun post(url: String, headers: Map<String, String>, bodyJson: String): HttpCallResponse {
            recordedCalls.add(RecordedCall(url, headers, bodyJson))
            return nextResponse
        }
    }

    class MockConnectivityProvider(var connected: Boolean = true) : IConnectivityProvider {
        override fun isConnected(): Boolean = connected
    }

    @BeforeEach
    fun setUp() {
        dao = SqliteNotificationDao("jdbc:sqlite::memory:")

        val mockVault = HmacSignerTest.InMemoryKeyStoreVault()
        mockVault.storeSecret("device_key", "secret-test-key-12345".toByteArray(Charsets.UTF_8))
        signer = HmacSigner(mockVault, "device_key")

        mockHttpClient = MockHttpClient()
        mockConnectivity = MockConnectivityProvider(connected = true)

        dispatcher = NotificationDispatcher(
            dao = dao,
            signer = signer,
            httpClient = mockHttpClient,
            connectivity = mockConnectivity,
            webhookUrl = testWebhookUrl,
            deviceId = testDeviceId,
            nowProvider = { fixedNow }
        )
    }

    @Test
    fun `1 debe abortar y solicitar reintento si no hay conectividad de red`() {
        mockConnectivity.connected = false
        dao.insertPending(
            CapturedNotificationEntity(
                deviceId = testDeviceId,
                walletPackage = "com.nequi.MobileApp",
                rawTitle = "Nequi",
                rawText = "Recibiste $10.000",
                capturedAt = fixedNow
            )
        )

        val result = dispatcher.dispatchPending()

        assertTrue(result is DispatchResult.Retry)
        assertEquals("Sin conectividad de red activa", (result as DispatchResult.Retry).reason)
        assertEquals(0, result.attemptedCount)
        assertEquals(0, mockHttpClient.recordedCalls.size, "No debe realizarse ninguna llamada HTTP")
        assertEquals(1, dao.getCountByStatus(NotificationStatus.PENDING), "El registro debe permanecer PENDING")
    }

    @Test
    fun `2 debe retornar exito con cero despachos si la cola esta vacia`() {
        val result = dispatcher.dispatchPending()

        assertTrue(result is DispatchResult.Success)
        assertEquals(0, (result as DispatchResult.Success).dispatchedCount)
        assertEquals(0, mockHttpClient.recordedCalls.size)
    }

    @Test
    fun `3 debe despachar exitosamente, firmar peticion y marcar como DISPATCHED ante HTTP 202`() {
        val id = dao.insertPending(
            CapturedNotificationEntity(
                deviceId = testDeviceId,
                walletPackage = "com.nequi.MobileApp",
                rawTitle = "Nequi",
                rawText = "Te transfirieron $50.000 de Pedro",
                capturedAt = fixedNow - 2000
            )
        )

        mockHttpClient.nextResponse = HttpCallResponse(202, """{"success":true,"message":"Accepted"}""")

        val result = dispatcher.dispatchPending()

        assertTrue(result is DispatchResult.Success)
        assertEquals(1, (result as DispatchResult.Success).dispatchedCount)

        // Verificar llamada HTTP
        assertEquals(1, mockHttpClient.recordedCalls.size)
        val call = mockHttpClient.recordedCalls.first()
        assertEquals(testWebhookUrl, call.url)

        // Verificar cabeceras de firma requeridas por ADR-0002
        assertEquals(testDeviceId, call.headers["X-Device-Id"])
        assertEquals(fixedNow.toString(), call.headers["X-Timestamp"])
        assertNotNull(call.headers["X-Nonce"])
        assertNotNull(call.headers["X-Signature"])

        // Verificar que el payload incluya dispatched_at y captured_at
        assertTrue(call.bodyJson.contains("\"captured_at\":${fixedNow - 2000}"))
        assertTrue(call.bodyJson.contains("\"dispatched_at\":$fixedNow"))

        // Verificar mutación en DAO
        val updated = dao.getById(id)
        assertNotNull(updated)
        assertEquals(NotificationStatus.DISPATCHED, updated!!.status)
        assertEquals(fixedNow, updated.dispatchedAt)
    }

    @Test
    fun `4 debe solicitar reintento e incrementar contador de fallos ante error de servidor 5xx`() {
        val id = dao.insertPending(
            CapturedNotificationEntity(
                deviceId = testDeviceId,
                walletPackage = "com.nequi.MobileApp",
                rawTitle = "Nequi",
                rawText = "Te transfirieron $100.000",
                capturedAt = fixedNow
            )
        )

        mockHttpClient.nextResponse = HttpCallResponse(504, "Gateway Timeout")

        val result = dispatcher.dispatchPending()

        assertTrue(result is DispatchResult.Retry)
        assertEquals(1, (result as DispatchResult.Retry).attemptedCount)
        assertTrue(result.reason.contains("504"))

        // Verificar que el registro permanezca PENDING con retry incrementado
        val record = dao.getById(id)
        assertNotNull(record)
        assertEquals(NotificationStatus.PENDING, record!!.status)
        assertEquals(1, record.retryCount)
        assertTrue(record.lastError!!.contains("504"))
    }

    @Test
    fun `5 debe marcar falla fatal ante error de cliente 401 Dispositivo no reconocido`() {
        val id = dao.insertPending(
            CapturedNotificationEntity(
                deviceId = testDeviceId,
                walletPackage = "com.nequi.MobileApp",
                rawTitle = "Nequi",
                rawText = "Te transfirieron $20.000",
                capturedAt = fixedNow
            )
        )

        mockHttpClient.nextResponse = HttpCallResponse(401, """{"error":"UNAUTHORIZED"}""")

        val result = dispatcher.dispatchPending()

        assertTrue(result is DispatchResult.FatalFailure)
        val fatal = result as DispatchResult.FatalFailure
        assertEquals(id, fatal.failedId)
        assertTrue(fatal.reason.contains("401"))

        val record = dao.getById(id)
        assertNotNull(record)
        assertEquals(1, record!!.retryCount)
    }

    @Test
    fun `6 debe despachar en orden FIFO un lote de notificaciones acumuladas offline`() {
        dao.insertPending(
            CapturedNotificationEntity(
                deviceId = testDeviceId,
                walletPackage = "com.nequi.MobileApp",
                rawTitle = "Nequi",
                rawText = "Pago 1",
                capturedAt = fixedNow - 3000
            )
        )
        dao.insertPending(
            CapturedNotificationEntity(
                deviceId = testDeviceId,
                walletPackage = "com.davivienda.daviplata",
                rawTitle = "Daviplata",
                rawText = "Pago 2",
                capturedAt = fixedNow - 2000
            )
        )

        mockHttpClient.nextResponse = HttpCallResponse(202, """{"success":true}""")

        val result = dispatcher.dispatchPending(limit = 10)

        assertTrue(result is DispatchResult.Success)
        assertEquals(2, (result as DispatchResult.Success).dispatchedCount)
        assertEquals(2, mockHttpClient.recordedCalls.size)

        // Verificar orden FIFO
        assertTrue(mockHttpClient.recordedCalls[0].bodyJson.contains("Pago 1"))
        assertTrue(mockHttpClient.recordedCalls[1].bodyJson.contains("Pago 2"))

        // Cero notificaciones pendientes restantes
        assertEquals(0, dao.getCountByStatus(NotificationStatus.PENDING))
        assertEquals(2, dao.getCountByStatus(NotificationStatus.DISPATCHED))
    }

    @Test
    fun `7 hilos concurrentes llamando dispatchPending deben enviar cada notificacion una sola vez`() {
        dao.insertPending(
            CapturedNotificationEntity(
                deviceId = testDeviceId,
                walletPackage = "com.nequi.MobileApp",
                rawTitle = "Envío",
                rawText = "KAROLL SIERRA te envió 200, ¡lo mejor!",
                capturedAt = fixedNow
            )
        )

        mockHttpClient.nextResponse = HttpCallResponse(202, """{"success":true}""")

        val startLatch = java.util.concurrent.CountDownLatch(1)
        val doneLatch = java.util.concurrent.CountDownLatch(2)

        repeat(2) {
            Thread {
                startLatch.await()
                dispatcher.dispatchPending()
                doneLatch.countDown()
            }.start()
        }

        startLatch.countDown()
        doneLatch.await()

        assertEquals(1, mockHttpClient.recordedCalls.size, "Solo debe haberse realizado 1 HTTP POST entre los 2 hilos")
        assertEquals(1, dao.getCountByStatus(NotificationStatus.DISPATCHED))
    }
}

