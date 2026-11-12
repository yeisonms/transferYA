package com.transferya.sentinel.interceptor

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class NotificationFilterTest {

    @Test
    fun `1 debe descartar resumenes de grupo Android FLAG_GROUP_SUMMARY`() {
        val groupFlags = NotificationFilter.FLAG_GROUP_SUMMARY
        assertFalse(
            NotificationFilter.shouldProcess(
                flags = groupFlags,
                rawTitle = "Nequi",
                rawText = "2 notificaciones nuevas"
            )
        )
    }

    @Test
    fun `2 debe descartar notificaciones fantasma con titulo y texto vacios o en blanco`() {
        assertFalse(NotificationFilter.shouldProcess(flags = 0, rawTitle = "", rawText = ""))
        assertFalse(NotificationFilter.shouldProcess(flags = 0, rawTitle = "   ", rawText = "\n\t "))
    }

    @Test
    fun `3 debe permitir notificaciones bancarias validas con titulo o texto no vacio sin FLAG_GROUP_SUMMARY`() {
        assertTrue(
            NotificationFilter.shouldProcess(
                flags = 16,
                rawTitle = "Envío",
                rawText = "KAROLL SIERRA te envió 150, ¡lo mejor!"
            )
        )
        assertTrue(
            NotificationFilter.shouldProcess(
                flags = 0,
                rawTitle = "Te enviaron plata por Bre-B",
                rawText = "Te enviaron $66.000. Entra a tu app y revisa tu saldo."
            )
        )
        assertTrue(
            NotificationFilter.shouldProcess(
                flags = 0,
                rawTitle = "",
                rawText = "Te acaban de enviar $10.000 en Nequi."
            )
        )
    }
}

