package com.transferya.sentinel.telemetry

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class HeartbeatCoordinatorTest {

    @Test
    fun `1 debe emitir de inmediato en el primer arranque y respetar intervalo de 2 min tras exito`() {
        var fakeNow = 1_700_000_000_000L
        val coordinator = HeartbeatCoordinator(
            intervalMs = 120_000L,
            nowProvider = { fakeNow }
        )

        var calls = 0
        assertTrue(coordinator.runIfDue { calls++; true })
        assertEquals(1, calls)
        assertEquals(fakeNow, coordinator.lastSuccessAtMs)

        // 30 segundos después no debe enviar todavía
        fakeNow += 30_000L
        assertFalse(coordinator.runIfDue { calls++; true })
        assertEquals(1, calls)

        // A los 120 segundos exactos vuelve a emitir
        fakeNow += 90_000L
        assertTrue(coordinator.runIfDue { calls++; true })
        assertEquals(2, calls)
    }

    @Test
    fun `2 si falla el envio no debe actualizar lastSuccessAtMs para reintentar en el siguiente ciclo`() {
        var fakeNow = 1_700_000_000_000L
        val coordinator = HeartbeatCoordinator(
            intervalMs = 120_000L,
            nowProvider = { fakeNow }
        )

        assertFalse(coordinator.runIfDue { false })
        assertEquals(0L, coordinator.lastSuccessAtMs)

        // 10 segundos después debe volver a intentar sin esperar 2 minutos
        fakeNow += 10_000L
        assertTrue(coordinator.isDue())
        assertTrue(coordinator.runIfDue { true })
        assertEquals(fakeNow, coordinator.lastSuccessAtMs)
    }

    @Test
    fun `3 force true debe permitir heartbeat inmediato tras emparejamiento aunque no haya vencido el intervalo`() {
        var fakeNow = 1_700_000_000_000L
        val coordinator = HeartbeatCoordinator(
            intervalMs = 120_000L,
            nowProvider = { fakeNow }
        )

        assertTrue(coordinator.runIfDue { true })
        fakeNow += 5_000L
        assertFalse(coordinator.isDue(force = false))
        assertTrue(coordinator.runIfDue(force = true) { true })
        assertEquals(fakeNow, coordinator.lastSuccessAtMs)
    }

    @Test
    fun `4 debe respetar intervalo liviano de 5 minutos cuando la cuenta esta suspendida o vencida (Ticket 21)`() {
        var fakeNow = 1_700_000_000_000L
        val coordinator = HeartbeatCoordinator(
            intervalMs = HeartbeatCoordinator.DEFAULT_HEARTBEAT_INTERVAL_MS,
            nowProvider = { fakeNow }
        )

        // Primer ping exitoso
        assertTrue(coordinator.runIfDue { true })

        // Pasa a estado suspendido (intervalo cambia a 5 min)
        coordinator.intervalMs = HeartbeatCoordinator.SUSPENDED_HEARTBEAT_INTERVAL_MS

        // A los 2 minutos (120s) NO debe emitir aún
        fakeNow += 120_000L
        assertFalse(coordinator.runIfDue { true })

        // A los 4 minutos tampoco
        fakeNow += 120_000L
        assertFalse(coordinator.runIfDue { true })

        // A los 5 minutos exactos (300s desde el inicio) emite
        fakeNow += 60_000L
        assertTrue(coordinator.runIfDue { true })
        assertEquals(fakeNow, coordinator.lastSuccessAtMs)
    }
}

