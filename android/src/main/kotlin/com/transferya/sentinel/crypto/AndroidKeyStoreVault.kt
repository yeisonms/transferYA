package com.transferya.sentinel.crypto

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Gestor seguro de claves criptográficas que interactúa con el Android KeyStore (ADR-0002).
 * Protege el Device Secret en el enclave de seguridad hardware del dispositivo mediante AES-256-GCM.
 * Si se ejecuta en entorno de pruebas (JVM estándar), conmuta transparentemente a almacenamiento en memoria.
 */
class AndroidKeyStoreVault(
    private val context: Context? = null,
    private val keyStoreType: String = "AndroidKeyStore"
) : IKeyStoreVault {

    companion object {
        private const val MASTER_KEY_ALIAS = "sentinel_vault_master_key"
        private const val PREFS_NAME = "sentinel_secure_vault"
        private const val GCM_IV_LENGTH = 12
        private const val GCM_TAG_LENGTH = 128
    }

    private val memoryFallback = ConcurrentHashMap<String, ByteArray>()

    private val isAndroidKeyStoreAvailable: Boolean by lazy {
        try {
            KeyStore.getInstance(keyStoreType).apply { load(null) }
            true
        } catch (_: Throwable) {
            false
        }
    }

    private fun getOrCreateMasterKey(): SecretKey {
        val ks = KeyStore.getInstance(keyStoreType).apply { load(null) }
        if (!ks.containsAlias(MASTER_KEY_ALIAS)) {
            val keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                keyStoreType
            )
            val parameterSpec = KeyGenParameterSpec.Builder(
                MASTER_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()

            keyGenerator.init(parameterSpec)
            keyGenerator.generateKey()
        }
        return ks.getKey(MASTER_KEY_ALIAS, null) as SecretKey
    }

    override fun storeSecret(alias: String, secret: ByteArray) {
        if (!isAndroidKeyStoreAvailable || context == null) {
            memoryFallback[alias] = secret.copyOf()
            return
        }

        try {
            val masterKey = getOrCreateMasterKey()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, masterKey)
            val iv = cipher.iv
            val encryptedBytes = cipher.doFinal(secret)

            val combined = ByteArray(iv.size + encryptedBytes.size)
            System.arraycopy(iv, 0, combined, 0, iv.size)
            System.arraycopy(encryptedBytes, 0, combined, iv.size, encryptedBytes.size)

            val base64 = Base64.getEncoder().encodeToString(combined)
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(alias, base64).commit()
            memoryFallback[alias] = secret.copyOf()
        } catch (_: Throwable) {
            memoryFallback[alias] = secret.copyOf()
        }
    }

    override fun getSecret(alias: String): ByteArray? {
        if (!isAndroidKeyStoreAvailable || context == null) {
            return memoryFallback[alias]?.copyOf()
        }

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val base64 = prefs.getString(alias, null)

        if (base64 == null) {
            return memoryFallback[alias]?.copyOf()
        }

        return try {
            val combined = Base64.getDecoder().decode(base64)
            if (combined.size <= GCM_IV_LENGTH) {
                return memoryFallback[alias]?.copyOf()
            }

            val iv = combined.copyOfRange(0, GCM_IV_LENGTH)
            val ciphertext = combined.copyOfRange(GCM_IV_LENGTH, combined.size)

            val masterKey = getOrCreateMasterKey()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val spec = GCMParameterSpec(GCM_TAG_LENGTH, iv)
            cipher.init(Cipher.DECRYPT_MODE, masterKey, spec)
            val decrypted = cipher.doFinal(ciphertext)
            memoryFallback[alias] = decrypted.copyOf()
            decrypted
        } catch (_: Throwable) {
            memoryFallback[alias]?.copyOf()
        }
    }

    override fun hasSecret(alias: String): Boolean {
        if (memoryFallback.containsKey(alias)) return true
        if (!isAndroidKeyStoreAvailable || context == null) return false

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.contains(alias)
    }

    override fun removeSecret(alias: String) {
        memoryFallback.remove(alias)
        if (isAndroidKeyStoreAvailable && context != null) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().remove(alias).commit()
        }
    }
}
