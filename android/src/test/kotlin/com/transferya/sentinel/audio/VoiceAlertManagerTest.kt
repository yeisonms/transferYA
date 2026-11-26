package com.transferya.sentinel.audio

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class VoiceAlertManagerTest {

    @Test
    fun `debe parsear y enunciar correctamente notificacion estandar de Nequi`() {
        val alert = PaymentNotificationParser.parseNotificationText(
            packageName = "com.nequi.MobileApp",
            rawTitle = "Te enviaron plata",
            rawText = "Carlos Perez te envio $50.000. ¡Que buena plata!"
        )

        assertEquals("Nequi", alert.wallet)
        assertEquals("50.000", alert.amountClean)
        assertNotNull(alert.payer)

        val phrase = PaymentNotificationParser.buildSpeechPhrase(alert)
        assertTrue(phrase.contains("50.000 pesos"), "La frase debe contener el monto")
        assertTrue(phrase.contains("Nequi"), "La frase debe nombrar a Nequi")
    }

    @Test
    fun `debe parsear y enunciar correctamente notificacion de DaviPlata`() {
        val alert = PaymentNotificationParser.parseNotificationText(
            packageName = "com.davivienda.daviplata",
            rawTitle = "DaviPlata",
            rawText = "Ha recibido una transferencia por $35.000 de Maria Gomez."
        )

        assertEquals("DaviPlata", alert.wallet)
        assertEquals("35.000", alert.amountClean)

        val phrase = PaymentNotificationParser.buildSpeechPhrase(alert)
        assertTrue(phrase.contains("35.000 pesos"))
        assertTrue(phrase.contains("DaviPlata"))
    }

    @Test
    fun `debe parsear y enunciar correctamente notificacion de Bancolombia`() {
        val alert = PaymentNotificationParser.parseNotificationText(
            packageName = "com.bancolombia.personas",
            rawTitle = "Bancolombia",
            rawText = "Bancolombia le informa recepcion de pago por $120.000"
        )

        assertEquals("Bancolombia", alert.wallet)
        assertEquals("120.000", alert.amountClean)

        val phrase = PaymentNotificationParser.buildSpeechPhrase(alert)
        assertEquals("¡Pago confirmado! Recibiste 120.000 pesos por Bancolombia.", phrase)
    }

    @Test
    fun `debe manejar notificaciones sin monto con frase generica segura`() {
        val alert = PaymentNotificationParser.parseNotificationText(
            packageName = "com.nequi.MobileApp",
            rawTitle = "Nequi Negocios",
            rawText = "Recibiste un nuevo pago exitoso."
        )

        assertEquals("Nequi", alert.wallet)
        assertNull(alert.amountClean)

        val phrase = PaymentNotificationParser.buildSpeechPhrase(alert)
        assertEquals("¡Pago confirmado por Nequi recibido con éxito!", phrase)
    }

    @Test
    fun `debe parsear montos de Nequi sin simbolo peso como te envio 150`() {
        val alert = PaymentNotificationParser.parseNotificationText(
            packageName = "com.nequi.MobileApp",
            rawTitle = "Envío",
            rawText = "KAROLL SIERRA te envió 150, ¡lo mejor!"
        )

        assertEquals("Nequi", alert.wallet)
        assertEquals("150", alert.amountClean)
        assertEquals("KAROLL SIERRA", alert.payer)

        val phrase = PaymentNotificationParser.buildSpeechPhrase(alert)
        assertEquals("¡Pago confirmado! Recibiste 150 pesos de KAROLL SIERRA por Nequi.", phrase)
    }

    @Test
    fun `debe parsear montos pequenos de un solo digito con simbolo peso`() {
        val alert = PaymentNotificationParser.parseNotificationText(
            packageName = "com.nequi.MobileApp",
            rawTitle = "Te enviaron plata por Bre-B",
            rawText = "Te enviaron $3. Entra a tu app y revisa tu saldo."
        )

        assertEquals("Nequi", alert.wallet)
        assertEquals("3", alert.amountClean)
        val phrase = PaymentNotificationParser.buildSpeechPhrase(alert)
        assertEquals("¡Pago confirmado! Recibiste 3 pesos por Nequi.", phrase)
    }

    @Test
    fun `debe descartar publicidad Black Friday de DaviPlata y no cantarla como pago`() {
        assertFalse(
            PaymentNotificationParser.isIncomingPayment(
                rawTitle = "Cuidado personal en Bellapiel con..",
                rawText = "¡En Black Friday activa tu Tarjeta Débito DaviPlata hoy! Llegan tus favoritos en cuidado personal"
            )
        )
    }

    @Test
    fun `debe descartar promociones, pagos salientes, retiros y claves dinamicas`() {
        assertFalse(
            PaymentNotificationParser.isIncomingPayment(
                rawTitle = "Nequi",
                rawText = "¡Pide tu tarjeta de crédito Nequi sin cuota de manejo hoy!"
            )
        )
        assertFalse(
            PaymentNotificationParser.isIncomingPayment(
                rawTitle = "Nequi",
                rawText = "Enviaste $50.000 a Carlos Perez"
            )
        )
        assertFalse(
            PaymentNotificationParser.isIncomingPayment(
                rawTitle = "Bancolombia",
                rawText = "Retiro exitoso por $200.000 en cajero Bancolombia"
            )
        )
        assertFalse(
            PaymentNotificationParser.isIncomingPayment(
                rawTitle = "DaviPlata",
                rawText = "Tu clave dinámica es 482910. No la compartas."
            )
        )
    }

    @Test
    fun `debe aceptar pagos entrantes reales y enunciar alerta preventiva en DaviPlata Bre-B sin monto`() {
        assertTrue(
            PaymentNotificationParser.isIncomingPayment(
                rawTitle = "Te enviaron plata por Bre-B",
                rawText = "Te enviaron $100.000. Entra a tu app y revisa tu saldo."
            )
        )
        assertTrue(
            PaymentNotificationParser.isIncomingPayment(
                rawTitle = "DaviPlata",
                rawText = "Recibiste una transferencia por Bre-B. Entra a la app para ver el detalle."
            )
        )

        val brebAlert = PaymentNotificationParser.parseNotificationText(
            packageName = "com.davivienda.daviplataapp",
            rawTitle = "DaviPlata",
            rawText = "Recibiste una transferencia por Bre-B. Entra a la app para ver el detalle."
        )
        assertTrue(brebAlert.isBreBHiddenAmount)
        val phrase = PaymentNotificationParser.buildSpeechPhrase(brebAlert)
        assertTrue(phrase.contains("Bre-B") && phrase.contains("Verifica el valor"))
    }
}
