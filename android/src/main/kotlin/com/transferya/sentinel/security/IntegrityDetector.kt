package com.transferya.sentinel.security

/**
 * Detector de integridad que identifica dispositivos con Root o firmas de desarrollo (ADR-0005).
 * Exporta su resultado hacia la telemetría pasiva de Heartbeat sin abortar la operación comercial.
 */
class IntegrityDetector(
    private val hardwareProvider: IDeviceHardwareProvider,
    private val fileSystemChecker: IFileSystemChecker
) : IIntegrityDetector {

    companion object {
        val KNOWN_ROOT_PATHS = listOf(
            "/system/app/Superuser.apk",
            "/sbin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/system/sd/xbin/su",
            "/system/bin/failsafe/su",
            "/data/local/su",
            "/system/etc/init.d/99SuperSUDaemon",
            "/dev/com.koushikdutta.superuser.daemon/"
        )
    }

    override fun isDeviceCompromised(): Boolean {
        // 1. Verificación de firmas de depuración/desarrollo (test-keys)
        val buildTags = hardwareProvider.buildTags.lowercase()
        if (buildTags.contains("test-keys")) {
            return true
        }

        // 2. Detección de binarios su o paquetes de superusuario
        for (path in KNOWN_ROOT_PATHS) {
            if (fileSystemChecker.fileExists(path)) {
                return true
            }
        }

        return false
    }
}
