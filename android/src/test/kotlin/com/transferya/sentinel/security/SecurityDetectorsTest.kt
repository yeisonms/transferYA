package com.transferya.sentinel.security

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class SecurityDetectorsTest {

    data class MockHardware(
        override val fingerprint: String = "samsung/a14nsxx/a14:13/TP1A.220624.014/A145FXXU3BWI1:user/release-keys",
        override val model: String = "SM-A145F",
        override val manufacturer: String = "samsung",
        override val brand: String = "samsung",
        override val device: String = "a14",
        override val product: String = "a14nsxx",
        override val hardware: String = "mt6769t",
        override val buildTags: String = "release-keys"
    ) : IDeviceHardwareProvider

    class MockFileSystem(private val existingPaths: Set<String> = emptySet()) : IFileSystemChecker {
        override fun fileExists(path: String): Boolean = existingPaths.contains(path)
    }

    @Test
    fun `1 EmulatorDetector debe retornar false para celulares fisicos reales (Samsung A14 y Xiaomi Redmi)`() {
        val samsung = MockHardware()
        val detectorSamsung = EmulatorDetector(samsung, MockFileSystem())
        assertFalse(detectorSamsung.isEmulator())

        val xiaomi = MockHardware(
            fingerprint = "Redmi/topaz_eea/topaz:13/TKQ1.221114.001/V14.0.9.0.TMGEUXM:user/release-keys",
            model = "23021RAAEG",
            manufacturer = "Xiaomi",
            brand = "Redmi",
            device = "topaz",
            product = "topaz_eea",
            hardware = "qcom"
        )
        val detectorXiaomi = EmulatorDetector(xiaomi, MockFileSystem())
        assertFalse(detectorXiaomi.isEmulator())
    }

    @Test
    fun `2 EmulatorDetector debe detectar emuladores oficiales de Android Studio (Ranchu y QEMU)`() {
        val qemuSdk = MockHardware(
            fingerprint = "google/sdk_gphone64_arm64/emulator64_arm64:14/dev-keys",
            model = "sdk_gphone64_arm64",
            manufacturer = "Google",
            hardware = "ranchu",
            product = "sdk_gphone64_arm64"
        )
        val detector = EmulatorDetector(qemuSdk, MockFileSystem())
        assertTrue(detector.isEmulator())
    }

    @Test
    fun `3 EmulatorDetector debe detectar emuladores de terceros como BlueStacks o Genymotion`() {
        val genymotion = MockHardware(
            manufacturer = "Genymotion",
            model = "Custom Phone",
            hardware = "vbox86"
        )
        val detectorGeny = EmulatorDetector(genymotion, MockFileSystem())
        assertTrue(detectorGeny.isEmulator())

        val blueStacks = MockHardware(
            model = "BlueStacks",
            hardware = "bst_arm64"
        )
        val detectorBs = EmulatorDetector(blueStacks, MockFileSystem())
        assertTrue(detectorBs.isEmulator())
    }

    @Test
    fun `4 EmulatorDetector debe detectar presencia del pipe de comunicacion qemu en el filesystem`() {
        val cleanHw = MockHardware()
        val qemuPipeFs = MockFileSystem(setOf("/dev/qemu_pipe"))
        val detector = EmulatorDetector(cleanHw, qemuPipeFs)
        assertTrue(detector.isEmulator())
    }

    @Test
    fun `5 IntegrityDetector debe retornar false en un dispositivo comercial integro y sin root`() {
        val cleanHw = MockHardware(buildTags = "release-keys")
        val cleanFs = MockFileSystem()
        val detector = IntegrityDetector(cleanHw, cleanFs)
        assertFalse(detector.isDeviceCompromised())
    }

    @Test
    fun `6 IntegrityDetector debe reportar comprometido si la ROM fue compilada con test-keys`() {
        val testKeysHw = MockHardware(buildTags = "test-keys")
        val cleanFs = MockFileSystem()
        val detector = IntegrityDetector(testKeysHw, cleanFs)
        assertTrue(detector.isDeviceCompromised())
    }

    @Test
    fun `7 IntegrityDetector debe reportar comprometido si detecta binario su en system o sbin`() {
        val cleanHw = MockHardware()

        val suInXbin = MockFileSystem(setOf("/system/xbin/su"))
        assertTrue(IntegrityDetector(cleanHw, suInXbin).isDeviceCompromised())

        val suInSbin = MockFileSystem(setOf("/sbin/su"))
        assertTrue(IntegrityDetector(cleanHw, suInSbin).isDeviceCompromised())

        val superuserApk = MockFileSystem(setOf("/system/app/Superuser.apk"))
        assertTrue(IntegrityDetector(cleanHw, superuserApk).isDeviceCompromised())
    }
}

