# 04: [Android] Almacenamiento Local Offline con Room (DAO, Entidad y Estados PENDING/DISPATCHED/FAILED)

**What to build:**
Implementar la capa de base de datos local SQLite mediante Android Jetpack `Room` / DAO para garantizar que toda notificación bancaria interceptada quede atómicamente resguardada en disco antes de cualquier intento de envío de red, soportando el ciclo de vida local (`PENDING`, `DISPATCHED`, `FAILED`).

**Blocked by:**
01: [Protocol] Especificación del Contrato de Ingesta y Validador Criptográfico HMAC-SHA256

**Status:**
completed

- [x] Entidad `CapturedNotificationEntity` con columnas: `id` (autoincrement/Long), `deviceId`, `walletPackage`, `rawTitle`, `rawText`, `capturedAt` (timestamp SO), `dispatchedAt` (nullable), `status` (enum `PENDING`, `DISPATCHED`, `FAILED`), `retryCount` (int), `lastError` (nullable string).
- [x] DAO `CapturedNotificationDao` con métodos: `insertPending(...)`, `getPendingNotifications(limit: Int): List<...>`, `markAsDispatched(id, dispatchedAt)`, `incrementRetry(id, error)`.
- [x] Base de datos SQLite / Room thread-safe con `PRAGMA` / índices optimizados por `(status, captured_at)`.
- [x] Pruebas unitarias de persistencia usando base de datos en memoria (`jdbc:sqlite::memory:`) probando concurrencia de inserción masiva en hilos y cambios de estado atómicos.
