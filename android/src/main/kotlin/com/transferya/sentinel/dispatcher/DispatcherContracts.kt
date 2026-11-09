package com.transferya.sentinel.dispatcher

/**
 * Abstracción de cliente HTTP para desacoplar el orquestador de librerías concretas (OkHttp / Ktor).
 */
data class HttpCallResponse(
    val statusCode: Int,
    val body: String
)

interface ISentinelHttpClient {
    fun post(url: String, headers: Map<String, String>, bodyJson: String): HttpCallResponse
}

/**
 * Abstracción de conectividad para verificar el estado de la red (NetworkType.CONNECTED).
 */
interface IConnectivityProvider {
    fun isConnected(): Boolean
}

/**
 * Resultado de una ronda de despacho de notificaciones pendientes.
 */
sealed class DispatchResult {
    data class Success(val dispatchedCount: Int) : DispatchResult()
    data class Retry(val reason: String, val attemptedCount: Int) : DispatchResult()
    data class FatalFailure(val reason: String, val failedId: Long) : DispatchResult()
}

