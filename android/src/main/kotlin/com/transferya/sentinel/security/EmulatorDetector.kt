package com.transferya.sentinel.security

/**
 * Detector de emuladores para proteger contra granjas de scraping o virtualización maliciosa (ADR-0005).
 */
class EmulatorDetector(
    private val hardwareProvider: IDeviceHardwareProvider,
    private val fileSystemChecker: IFileSystemChecker
) : IEmulatorDetector {

    companion object {
        val EMULATOR_FILES = listOf(
            "/dev/qemu_pipe",
            "/dev/socket/qemud",
            "/system/lib/libc_malloc_debug_qemu.so",
            "/sys/qemu_trace",
            "/system/bin/qemu-props"
        )
    }

    override fun isEmulator(): Boolean {
        val fingerprint = hardwareProvider.fingerprint.lowercase()
        val model = hardwareProvider.model.lowercase()
        val manufacturer = hardwareProvider.manufacturer.lowercase()
        val brand = hardwareProvider.brand.lowercase()
        val device = hardwareProvider.device.lowercase()
        val product = hardwareProvider.product.lowercase()
        val hardware = hardwareProvider.hardware.lowercase()

        // 1. Huella y marcas genéricas de emulador
        if (fingerprint.startsWith("generic") ||
            fingerprint.startsWith("unknown") ||
            fingerprint.contains("emulator64")
        ) {
            return true
        }

        // 2. Modelo
        if (model.contains("google_sdk") ||
            model.contains("emulator") ||
            model.contains("android sdk built for x86") ||
            model.contains("bluestacks")
        ) {
            return true
        }

        // 3. Fabricante y Marca
        if (manufacturer.contains("genymotion") ||
            brand.contains("generic")
        ) {
            return true
        }

        // 4. Hardware
        if (hardware.contains("goldfish") ||
            hardware.contains("ranchu") ||
            hardware.contains("vbox86") ||
            hardware.contains("bst_")
        ) {
            return true
        }

        // 5. Producto o dispositivo
        if (product.contains("sdk") ||
            product.contains("google_sdk") ||
            product.contains("sdk_x86") ||
            product.contains("vbox86p") ||
            device.contains("bst_")
        ) {
            return true
        }

        // 6. Archivos y pipes de comunicación del hipervisor
        for (pipePath in EMULATOR_FILES) {
            if (fileSystemChecker.fileExists(pipePath)) {
                return true
            }
        }

        return false
    }
}
