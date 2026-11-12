# ==============================================================================
# TransferYA Sentinel - ProGuard / R8 Hardening Rules (ADR-0005)
# ==============================================================================

# 1. Optimización y Reducción General
-repackageclasses 'com.transferya.sentinel.internal'
-allowaccessmodification

# 2. Ofuscación de Identificadores Propios
# Todas las clases, métodos y campos de dominio e infraestructura se ofuscan agresivamente
# a menos que estén explícitamente preservadas abajo.

# 3. Puntos de Entrada del Sistema Operativo Android (Keep Obligatorio)
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.service.notification.NotificationListenerService
-keep public class * extends androidx.work.ListenableWorker

# 4. Entidades y Modelos SQLite / Serialización
-keepclassmembers class com.transferya.sentinel.storage.CapturedNotificationEntity {
    <fields>;
    <init>(...);
}

# 5. Seguridad Criptográfica y KeyStore
# Evitar que R8 renombre las clases de algoritmos o constantes de KeyStore
-keepclassmembers class com.transferya.sentinel.crypto.** {
    <fields>;
    <methods>;
}

# 5b. Escáner QR Nativo (ZXing Embedded)
-keep class com.journeyapps.barcodescanner.** { *; }
-keep class com.google.zxing.** { *; }
-dontwarn com.google.zxing.**

# 6. Eliminación de Logs en Compilaciones Release
# Remueve llamadas a Log.v, Log.d y Log.i en el binario final
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int d(...);
    public static int i(...);
}

# 7. Preservar atributos de depuración esenciales para mapping.txt
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

