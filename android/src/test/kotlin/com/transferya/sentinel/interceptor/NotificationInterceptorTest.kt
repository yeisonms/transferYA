package com.transferya.sentinel.interceptor

import com.transferya.sentinel.storage.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class NotificationInterceptorTest {

    private lateinit var dao: SqliteNotificationDao
    private lateinit var mockWakeLock: MockWakeLockManager
    private lateinit var mockForeground: MockForegroundController
    private lateinit var interceptor: NotificationInterceptor

    private val testDeviceId = "centinela-interceptor-001"
    private val fixedNow = 1700000000000L

    class MockWakeLockManager : IWakeLockManager {
        val acquiredCalls = mutableListOf<Pair<String, Long>>()
        val releasedCalls = mutableListOf<String>()
        private var held: Boolean = false

        override fun acquirePartialWakeLock(tag: String, timeoutMs: Long) {
            acquiredCalls.add(Pair(tag, timeoutMs))
            held = true
        }

        override fun releaseWakeLock(tag: String) {
            releasedCalls.add(tag)
            held = false
        }

        override fun isHeld(tag: String): Boolean = held
    }

    class MockForegroundController : IForegroundServiceController {
        var running: Boolean = false
        var lastTitle: String? = null
        var lastText: String? = null

        override fun startForegroundService(notificationTitle: String, notificationText: String) {
            running = true
            lastTitle = notificationTitle
            lastText = notificationText
        }

        override fun stopForegroundService() {
            running = false
        }

        override fun isRunning(): Boolean = running
    }

    @BeforeEach
    fun setUp() {
        dao = SqliteNotificationDao("jdbc:sqlite::memory:")
        mockWakeLock = MockWakeLockManager()
        mockForeground = MockForegroundController()

        interceptor = NotificationInterceptor(
            dao = dao,
            dispatcher = null,
            wakeLockManager = mockWakeLock,
            foregroundController = mockForeground,
            deviceId = testDeviceId
        )
    }

    @Test
    fun `1 debe ignorar silenciosamente notificaciones ajenas a Nequi y Daviplata sin activar WakeLock`() {
        val nonBankingEvent = RawNotificationEvent(
            packageName = "com.whatsapp",
            title = "Mensaje de WhatsApp",
            text = "Hola, ¿cómo estás?",
            postTime = fixedNow
        )

        val result = interceptor.onNotificationReceived(nonBankingEvent)

        assertTrue(result is InterceptionResult.Ignored)
        val ignored = result as InterceptionResult.Ignored
        assertEquals("com.whatsapp", ignored.packageName)
        assertEquals("Paquete no soportado", ignored.reason)

        // Verificaciones de contención
        assertEquals(0, mockWakeLock.acquiredCalls.size, "No debe adquirirse WakeLock para apps no bancarias")
        assertEquals(0, dao.getCountByStatus(NotificationStatus.PENDING), "No debe insertarse en base de datos")
    }

    @Test
    fun `2 debe adquirir WakeLock de 15s, persistir en SQLite y liberar WakeLock para notificacion de Nequi`() {
        val nequiEvent = RawNotificationEvent(
            packageName = "com.nequi.MobileApp",
            title = "Nequi",
            text = "Te transfirieron $45.000 de Carlos Mendoza (Saldo: $100.000)",
            postTime = fixedNow
        )

        val result = interceptor.onNotificationReceived(nequiEvent)

        assertTrue(result is InterceptionResult.Accepted)
        val accepted = result as InterceptionResult.Accepted
        assertEquals("com.nequi.MobileApp", accepted.walletPackage)
        assertTrue(accepted.entityId > 0)

        // Verificación de WakeLock según ADR-0003
        assertEquals(1, mockWakeLock.acquiredCalls.size)
        val (tag, timeout) = mockWakeLock.acquiredCalls.first()
        assertEquals("TransferYA:Interception", tag)
        assertEquals(15000L, timeout, "Timeout del WakeLock debe ser estrictamente 15 segundos")
        assertEquals(1, mockWakeLock.releasedCalls.size, "El WakeLock debe haber sido liberado tras procesar")
        assertFalse(mockWakeLock.isHeld("TransferYA:Interception"))

        // Verificación de persistencia atómica en SQLite
        val record = dao.getById(accepted.entityId)
        assertNotNull(record)
        assertEquals(testDeviceId, record!!.deviceId)
        assertEquals("com.nequi.MobileApp", record.walletPackage)
        assertEquals("Te transfirieron $45.000 de Carlos Mendoza (Saldo: $100.000)", record.rawText)
        assertEquals(fixedNow, record.capturedAt)
        assertEquals(NotificationStatus.PENDING, record.status)
    }

    @Test
    fun `3 debe procesar y persistir exitosamente notificaciones de Daviplata`() {
        val daviplataEvent = RawNotificationEvent(
            packageName = "com.davivienda.daviplata",
            title = "DaviPlata",
            text = "DaviPlata le informa que recibio $25.000 de Laura Gomez",
            postTime = fixedNow
        )

        val result = interceptor.onNotificationReceived(daviplataEvent)

        assertTrue(result is InterceptionResult.Accepted)
        val accepted = result as InterceptionResult.Accepted
        assertEquals("com.davivienda.daviplata", accepted.walletPackage)

        assertEquals(1, mockWakeLock.acquiredCalls.size)
        assertEquals(1, mockWakeLock.releasedCalls.size)
        assertEquals(1, dao.getCountByStatus(NotificationStatus.PENDING))
    }

    @Test
    fun `4 debe garantizar la liberacion del WakeLock en bloque finally si ocurre una excepcion`() {
        val failingDao = object : ICapturedNotificationDao {
            override fun insertPending(entity: CapturedNotificationEntity): Long = throw RuntimeException("Disco lleno / Error SQLite")
            override fun getPendingNotifications(limit: Int): List<CapturedNotificationEntity> = emptyList()
            override fun getById(id: Long): CapturedNotificationEntity? = null
            override fun markAsDispatched(id: Long, dispatchedAt: Long): Boolean = false
            override fun incrementRetry(id: Long, error: String): Boolean = false
            override fun getCountByStatus(status: NotificationStatus): Int = 0
        }

        val faultInterceptor = NotificationInterceptor(
            dao = failingDao,
            dispatcher = null,
            wakeLockManager = mockWakeLock,
            foregroundController = mockForeground,
            deviceId = testDeviceId
        )

        val nequiEvent = RawNotificationEvent(
            packageName = "com.nequi.MobileApp",
            title = "Nequi",
            text = "Pago de prueba",
            postTime = fixedNow
        )

        val result = faultInterceptor.onNotificationReceived(nequiEvent)

        assertTrue(result is InterceptionResult.Error)
        val error = result as InterceptionResult.Error
        assertTrue(error.message.contains("Error SQLite"))

        // Verificación crítica: el WakeLock DEBIÓ ser liberado en el bloque finally
        assertEquals(1, mockWakeLock.acquiredCalls.size)
        assertEquals(1, mockWakeLock.releasedCalls.size, "El WakeLock DEBE liberarse incluso si falla la persistencia")
        assertFalse(mockWakeLock.isHeld("TransferYA:Interception"))
    }

    @Test
    fun `5 debe inicializar y verificar el Foreground Service persistente para supervivencia del proceso`() {
        mockForeground.startForegroundService(
            notificationTitle = "TransferYA Centinela Activo",
            notificationText = "Verificando pagos en tiempo real"
        )

        assertTrue(mockForeground.isRunning(), "El Foreground Service debe permanecer en ejecución")
        assertEquals("TransferYA Centinela Activo", mockForeground.lastTitle)
    }
}

