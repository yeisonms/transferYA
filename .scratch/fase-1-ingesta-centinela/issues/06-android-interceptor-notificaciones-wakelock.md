# 06: [Android] Interceptor Nativo de Notificaciones con Foreground Service y Partial WakeLock de 15s

**What to build:**
Implementar el servicio nativo `PaymentNotificationListenerService` / `NotificationInterceptor` que intercepta las notificaciones push de Nequi y Daviplata en el dispositivo Android, adquiere un `Partial WakeLock` efímero de máximo 15s para evitar que el OS suspenda la CPU, encola inmediatamente el evento en la base de datos Room/SQLite, dispara el `NotificationDispatcher`, y se mantiene vivo mediante un `Foreground Service` continuo con notificación persistente.

**Blocked by:**
04: [Android] Almacenamiento Local Offline con Room (DAO, Entidad y Estados PENDING/DISPATCHED/FAILED)
05: [Android] Orquestador de Despacho de Red con WorkManager y Política de Conectividad

**Status:**
completed

- [x] Implementación de `NotificationInterceptor`: procesamiento de `RawNotificationEvent`.
- [x] Filtrado estricto por package name: procesar únicamente `com.nequi.MobileApp` y `com.davivienda.daviplata`; descartar silenciosamente cualquier otra aplicación.
- [x] Adquisición controlada de `IWakeLockManager` (`PARTIAL_WAKE_LOCK`) con timeout estricto de 15.000 ms y liberación garantizada en bloque `finally`.
- [x] Inserción síncrona/inmediata en SQLite con `capturedAt = event.postTime` y disparo del despachador de red.
- [x] `Foreground Service` acompañante con canal de notificación permanente ("TransferYA Centinela Activo") de baja molestia pero alta prioridad de proceso (`FOREGROUND_SERVICE_DATA_SYNC`).
- [x] Pruebas unitarias/de componentes simulando la llegada de notificaciones válidas e inválidas y verificando la inserción en base de datos y la adquisición/liberación del WakeLock.
