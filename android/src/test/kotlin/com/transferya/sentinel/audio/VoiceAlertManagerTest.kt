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
}
