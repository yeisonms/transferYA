package com.transferya.sentinel.storage

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class SqliteNotificationDaoTest {

    private lateinit var dao: SqliteNotificationDao
    private val fixedNow = 1700000000000L

    private val sampleEntity = CapturedNotificationEntity(
        deviceId = "centinela-device-med-01",
        walletPackage = "com.nequi.MobileApp",
        rawTitle = "Nequi",
        rawText = "Te transfirieron $30.000 de Ana Perez",
        capturedAt = fixedNow
    )

    @BeforeEach
    fun setUp() {
        // Base de datos SQLite en memoria aislada por cada prueba
        dao = SqliteNotificationDao("jdbc:sqlite::memory:")
    }

    @Test
    fun `1 debe insertar atómicamente una notificacion en estado PENDING y retornar ID generado`() {
        val id = dao.insertPending(sampleEntity)

        assertTrue(id > 0, "El ID generado por autoincrement debe ser > 0")

        val stored = dao.getById(id)
        assertNotNull(stored)
        assertEquals(id, stored!!.id)
        assertEquals(sampleEntity.deviceId, stored.deviceId)
        assertEquals(sampleEntity.walletPackage, stored.walletPackage)
        assertEquals(sampleEntity.rawTitle, stored.rawTitle)
        assertEquals(sampleEntity.rawText, stored.rawText)
        assertEquals(sampleEntity.capturedAt, stored.capturedAt)
        assertEquals(NotificationStatus.PENDING, stored.status)
        assertEquals(0, stored.retryCount)
        assertNull(stored.dispatchedAt)
        assertNull(stored.lastError)
    }

    @Test
    fun `2 debe consultar las notificaciones en estado PENDING en orden cronologico`() {
        dao.insertPending(sampleEntity.copy(capturedAt = fixedNow + 2000, rawText = "Pago 2"))
        dao.insertPending(sampleEntity.copy(capturedAt = fixedNow + 1000, rawText = "Pago 1"))
        dao.insertPending(sampleEntity.copy(capturedAt = fixedNow + 3000, rawText = "Pago 3"))

        val pendingList = dao.getPendingNotifications(limit = 10)

        assertEquals(3, pendingList.size)
        assertEquals("Pago 1", pendingList[0].rawText)
        assertEquals("Pago 2", pendingList[1].rawText)
        assertEquals("Pago 3", pendingList[2].rawText)
    }

    @Test
    fun `3 debe marcar como DISPATCHED y registrar dispatchedAt excluyendo de pendientes`() {
        val id = dao.insertPending(sampleEntity)
        val dispatchTimestamp = fixedNow + 1500

        val success = dao.markAsDispatched(id, dispatchTimestamp)
        assertTrue(success)

        val updated = dao.getById(id)
        assertNotNull(updated)
        assertEquals(NotificationStatus.DISPATCHED, updated!!.status)
        assertEquals(dispatchTimestamp, updated.dispatchedAt)

        val pending = dao.getPendingNotifications(limit = 10)
        assertTrue(pending.isEmpty(), "Un registro marcado como DISPATCHED no debe aparecer en la cola de pendientes")
    }

    @Test
    fun `4 debe incrementar contador de reintentos y persistir mensaje de ultimo error`() {
        val id = dao.insertPending(sampleEntity)

        val updatedOnce = dao.incrementRetry(id, "HTTP 504 Gateway Timeout")
        assertTrue(updatedOnce)

        var record = dao.getById(id)
        assertNotNull(record)
        assertEquals(1, record!!.retryCount)
        assertEquals("HTTP 504 Gateway Timeout", record.lastError)
        assertEquals(NotificationStatus.PENDING, record.status)

        dao.incrementRetry(id, "Conexión rechazada")
        record = dao.getById(id)
        assertEquals(2, record!!.retryCount)
        assertEquals("Conexión rechazada", record.lastError)
    }

    @Test
    fun `5 debe ser thread-safe permitiendo inserciones concurrentes sin bloqueo ni corrupcion`() {
        val threadCount = 8
        val itemsPerThread = 25
        val executor = Executors.newFixedThreadPool(threadCount)

        for (t in 0 until threadCount) {
            executor.submit {
                for (i in 0 until itemsPerThread) {
                    dao.insertPending(
                        sampleEntity.copy(
                            capturedAt = fixedNow + (t * 1000) + i,
                            rawText = "Hilo $t - Item $i"
                        )
                    )
                }
            }
        }

        executor.shutdown()
        val finished = executor.awaitTermination(5, TimeUnit.SECONDS)
        assertTrue(finished, "Las operaciones concurrentes debieron terminar dentro del tiempo límite")

        val totalPending = dao.getCountByStatus(NotificationStatus.PENDING)
        assertEquals(threadCount * itemsPerThread, totalPending, "Todas las inserciones concurrentes deben persistir íntegramente")
    }
}

