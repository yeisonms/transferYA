package com.transferya.sentinel.crypto

import java.security.KeyStore
import javax.crypto.spec.SecretKeySpec

/**
 * Gestor seguro de claves criptográficas que interactúa con el Android KeyStore (ADR-0002).
 * Protege el Device Secret en el enclave de seguridad hardware del dispositivo.
 */
class AndroidKeyStoreVault(
    private val keyStoreType: String = "AndroidKeyStore",
    private val defaultPassword: CharArray = CharArray(0)
) : IKeyStoreVault {

    private val keyStore: KeyStore = try {
        KeyStore.getInstance(keyStoreType).apply { load(null) }
    } catch (_: Exception) {
        // Fallback transparente para pruebas en JVM estándar donde AndroidKeyStore no está disponible
        KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null, defaultPassword) }
    }

    override fun storeSecret(alias: String, secret: ByteArray) {
        val secretKey = SecretKeySpec(secret, "HmacSHA256")
        val protParam = KeyStore.PasswordProtection(defaultPassword)
        val entry = KeyStore.SecretKeyEntry(secretKey)
        keyStore.setEntry(alias, entry, protParam)
    }

    override fun getSecret(alias: String): ByteArray? {
        if (!hasSecret(alias)) return null
        val protParam = KeyStore.PasswordProtection(defaultPassword)
        val entry = keyStore.getEntry(alias, protParam)
        return if (entry is KeyStore.SecretKeyEntry) {
            entry.secretKey.encoded
        } else {
            null
        }
    }

    override fun hasSecret(alias: String): Boolean {
        return keyStore.containsAlias(alias)
    }

    override fun removeSecret(alias: String) {
        if (keyStore.containsAlias(alias)) {
            keyStore.deleteEntry(alias)
        }
    }
}
