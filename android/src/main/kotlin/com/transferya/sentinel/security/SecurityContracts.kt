package com.transferya.sentinel.security

/**
 * Proveedor de propiedades de hardware y compilación del sistema Android (ADR-0005).
 */
interface IDeviceHardwareProvider {
    val fingerprint: String
    val model: String
    val manufacturer: String
    val brand: String
    val device: String
    val product: String
    val hardware: String
    val buildTags: String
}

/**
 * Abstracción de verificación de rutas en el sistema de archivos para comprobación de binarios.
 */
interface IFileSystemChecker {
    fun fileExists(path: String): Boolean
}

/**
 * Detector de entornos emulados o virtualizados (BlueStacks, QEMU, Genymotion, SDK emulator).
 */
interface IEmulatorDetector {
    fun isEmulator(): Boolean
}

/**
 * Detector pasivo de compromisos del sistema operativo (Root, Magisk, test-keys).
 */
interface IIntegrityDetector {
    fun isDeviceCompromised(): Boolean
}

