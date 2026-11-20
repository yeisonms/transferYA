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

    @Test
    fun `4 debe identificar correctamente paquetes de mensajeria SMS`() {
        assertTrue(NotificationFilter.isSmsPackage("com.google.android.apps.messaging"))
        assertTrue(NotificationFilter.isSmsPackage("com.android.mms"))
        assertTrue(NotificationFilter.isSmsPackage("com.samsung.android.messaging"))
        assertTrue(NotificationFilter.isSmsPackage("com.miui.smsextra"))
        assertFalse(NotificationFilter.isSmsPackage("com.nequi.MobileApp"))
        assertFalse(NotificationFilter.isSmsPackage("com.whatsapp"))
    }

    @Test
    fun `5 debe validar y aceptar exclusivamente SMS transaccionales bancarios de Nequi Bre-B y DaviPlata`() {
        // SMS oficial Nequi Negocios Bre-B desde 890806
        assertTrue(
            NotificationFilter.isBankingSms(
                rawTitle = "890806",
                rawText = "Nequi: Tu negocio LA SINVERGUECERIA BURGUER recibio $110 de YEISON MURCIA el 15/11/2026 a las 10:25 p.m. a través de Bre-B - Vende mas con Nequi Negocios."
            )
        )

        // SMS oficial DaviPlata desde 85888
        assertTrue(
            NotificationFilter.isBankingSms(
                rawTitle = "85888",
                rawText = "DaviPlata le informa que recibio $25.000 de Carlos Mendoza."
            )
        )

        // SMS oficial Bancolombia desde 890001 o con titulo Bancolombia (caso real)
        assertTrue(
            NotificationFilter.isBankingSms(
                rawTitle = "890001",
                rawText = "Bancolombia: JEFFERSON, recibiste una transferencia de YEISON STIVEN MURCIA CALVO por $15.00 en tu cuenta *5871 conectada a la llave @jefferson0769 el 20/11/26 a las 10:39. Con llaves es de una y gratis. Dudas al 018000912345."
            )
        )
        assertTrue(
            NotificationFilter.isBankingSms(
                rawTitle = "Bancolombia",
                rawText = "Bancolombia: recibiste una transferencia de YEISON STIVEN MURCIA CALVO por $15.00"
            )
        )

        // SMS de Nequi sin titulo 890806 pero con texto de Nequi
        assertTrue(
            NotificationFilter.isBankingSms(
                rawTitle = "Mensaje nuevo",
                rawText = "Nequi: Recibiste $50.000 a través de Bre-B"
            )
        )
    }

    @Test
    fun `6 debe rechazar de inmediato mensajes SMS personales o de terceros protegiendo Habeas Data`() {
        // Mensajes personales
        assertFalse(
            NotificationFilter.isBankingSms(
                rawTitle = "+573001234567",
                rawText = "Hola amor, ya voy para la casa"
            )
        )
        // Publicidad de operadores
        assertFalse(
            NotificationFilter.isBankingSms(
                rawTitle = "Claro",
                rawText = "Tu factura ya está disponible, paga antes del 20"
            )
        )
        // Códigos de seguridad de otras apps (ej. Uber, Facebook)
        assertFalse(
            NotificationFilter.isBankingSms(
                rawTitle = "Uber",
                rawText = "Tu código de verificación es 4821"
            )
        )
    }

    @Test
    fun `7 debe resolver el paquete bancario adecuado para SMS`() {
        org.junit.jupiter.api.Assertions.assertEquals(
            "com.nequi.MobileApp",
            NotificationFilter.resolveBankingPackageForSms(
                "890806",
                "Nequi: Tu negocio recibio $110 a través de Bre-B"
            )
        )
        org.junit.jupiter.api.Assertions.assertEquals(
            "com.davivienda.daviplata",
            NotificationFilter.resolveBankingPackageForSms(
                "85888",
                "DaviPlata le informa que recibio $50.000"
            )
        )
        org.junit.jupiter.api.Assertions.assertEquals(
            "com.bancolombia.personas",
            NotificationFilter.resolveBankingPackageForSms(
                "890001",
                "Bancolombia: JEFFERSON, recibiste una transferencia de YEISON STIVEN MURCIA CALVO por $15.00"
            )
        )
        org.junit.jupiter.api.Assertions.assertEquals(
            "com.bancolombia.personas",
            NotificationFilter.resolveBankingPackageForSms(
                "Mensajes",
                "Bancolombia: recibiste $50.000 en tu cuenta"
            )
        )
    }
}

