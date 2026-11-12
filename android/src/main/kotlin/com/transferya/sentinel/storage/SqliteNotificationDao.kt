package com.transferya.sentinel.storage

import java.sql.Connection
import java.sql.DriverManager
import java.sql.ResultSet
import java.sql.Statement

/**
 * Implementación de producción del DAO SQLite local para el Dispositivo Centinela (ADR-0001).
 * Garantiza persistencia atómica, orden cronológico FIFO y seguridad entre hilos.
 */
class SqliteNotificationDao(private val jdbcUrl: String = "jdbc:sqlite::memory:") : ICapturedNotificationDao, AutoCloseable {

    private val connection: Connection = DriverManager.getConnection(jdbcUrl)
    private val dbLock = Any()

    init {
        createTableIfNotExists()
    }

    private fun createTableIfNotExists() = synchronized(dbLock) {
        connection.createStatement().use { stmt ->
            stmt.execute(
                """
                CREATE TABLE IF NOT EXISTS captured_notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id TEXT NOT NULL,
                    wallet_package TEXT NOT NULL,
                    raw_title TEXT NOT NULL,
                    raw_text TEXT NOT NULL,
                    captured_at INTEGER NOT NULL,
                    dispatched_at INTEGER,
                    status TEXT NOT NULL,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_status_captured_at ON captured_notifications(status, captured_at);
                """.trimIndent()
            )
        }
    }

    override fun insertPending(entity: CapturedNotificationEntity): Long = synchronized(dbLock) {
        val sql = """
            INSERT INTO captured_notifications (device_id, wallet_package, raw_title, raw_text, captured_at, status, retry_count)
            VALUES (?, ?, ?, ?, ?, 'PENDING', 0)
        """.trimIndent()

        connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS).use { stmt ->
            stmt.setString(1, entity.deviceId)
            stmt.setString(2, entity.walletPackage)
            stmt.setString(3, entity.rawTitle)
            stmt.setString(4, entity.rawText)
            stmt.setLong(5, entity.capturedAt)

            stmt.executeUpdate()

            val generatedKeys = stmt.generatedKeys
            if (generatedKeys.next()) {
                generatedKeys.getLong(1)
            } else {
                throw IllegalStateException("No se pudo obtener el ID autoincremental de la notificación insertada")
            }
        }
    }

    override fun getPendingNotifications(limit: Int): List<CapturedNotificationEntity> = synchronized(dbLock) {
        val sql = """
            SELECT id, device_id, wallet_package, raw_title, raw_text, captured_at, dispatched_at, status, retry_count, last_error
            FROM captured_notifications
            WHERE status = 'PENDING'
            ORDER BY captured_at ASC
            LIMIT ?
        """.trimIndent()

        val results = mutableListOf<CapturedNotificationEntity>()
        connection.prepareStatement(sql).use { stmt ->
            stmt.setInt(1, limit)
            stmt.executeQuery().use { rs ->
                while (rs.next()) {
                    results.add(mapRowToEntity(rs))
                }
            }
        }
        results
    }

    override fun getById(id: Long): CapturedNotificationEntity? = synchronized(dbLock) {
        val sql = """
            SELECT id, device_id, wallet_package, raw_title, raw_text, captured_at, dispatched_at, status, retry_count, last_error
            FROM captured_notifications
            WHERE id = ?
        """.trimIndent()

        connection.prepareStatement(sql).use { stmt ->
            stmt.setLong(1, id)
            stmt.executeQuery().use { rs ->
                if (rs.next()) {
                    mapRowToEntity(rs)
                } else {
                    null
                }
            }
        }
    }

    override fun markAsDispatched(id: Long, dispatchedAt: Long): Boolean = synchronized(dbLock) {
        val sql = """
            UPDATE captured_notifications
            SET status = 'DISPATCHED', dispatched_at = ?
            WHERE id = ?
        """.trimIndent()

        connection.prepareStatement(sql).use { stmt ->
            stmt.setLong(1, dispatchedAt)
            stmt.setLong(2, id)
            stmt.executeUpdate() > 0
        }
    }

    override fun incrementRetry(id: Long, error: String): Boolean = synchronized(dbLock) {
        val sql = """
            UPDATE captured_notifications
            SET retry_count = retry_count + 1, last_error = ?
            WHERE id = ?
        """.trimIndent()

        connection.prepareStatement(sql).use { stmt ->
            stmt.setString(1, error)
            stmt.setLong(2, id)
            stmt.executeUpdate() > 0
        }
    }

    override fun markAsFailed(id: Long, error: String): Boolean = synchronized(dbLock) {
        val sql = """
            UPDATE captured_notifications
            SET status = 'FAILED', retry_count = retry_count + 1, last_error = ?
            WHERE id = ?
        """.trimIndent()

        connection.prepareStatement(sql).use { stmt ->
            stmt.setString(1, error)
            stmt.setLong(2, id)
            stmt.executeUpdate() > 0
        }
    }

    override fun failPendingForOtherDevices(activeDeviceId: String): Int = synchronized(dbLock) {
        val sql = """
            UPDATE captured_notifications
            SET status = 'FAILED', last_error = ?
            WHERE status = 'PENDING' AND device_id != ?
        """.trimIndent()

        connection.prepareStatement(sql).use { stmt ->
            stmt.setString(1, "Descartado al re-emparejar a $activeDeviceId")
            stmt.setString(2, activeDeviceId)
            stmt.executeUpdate()
        }
    }

    override fun getLastError(): String? = synchronized(dbLock) {
        val sql = """
            SELECT last_error FROM captured_notifications
            WHERE last_error IS NOT NULL AND last_error != ''
            ORDER BY id DESC LIMIT 1
        """.trimIndent()

        connection.prepareStatement(sql).use { stmt ->
            stmt.executeQuery().use { rs ->
                if (rs.next()) rs.getString(1) else null
            }
        }
    }

    override fun getCountByStatus(status: NotificationStatus): Int = synchronized(dbLock) {
        val sql = "SELECT COUNT(*) FROM captured_notifications WHERE status = ?"
        connection.prepareStatement(sql).use { stmt ->
            stmt.setString(1, status.name)
            stmt.executeQuery().use { rs ->
                if (rs.next()) rs.getInt(1) else 0
            }
        }
    }

    private fun mapRowToEntity(rs: ResultSet): CapturedNotificationEntity {
        val dispatchedAtLong = rs.getLong("dispatched_at")
        val dispatchedAt = if (rs.wasNull()) null else dispatchedAtLong

        return CapturedNotificationEntity(
            id = rs.getLong("id"),
            deviceId = rs.getString("device_id"),
            walletPackage = rs.getString("wallet_package"),
            rawTitle = rs.getString("raw_title"),
            rawText = rs.getString("raw_text"),
            capturedAt = rs.getLong("captured_at"),
            dispatchedAt = dispatchedAt,
            status = NotificationStatus.valueOf(rs.getString("status")),
            retryCount = rs.getInt("retry_count"),
            lastError = rs.getString("last_error")
        )
    }

    override fun close() {
        if (!connection.isClosed) {
            connection.close()
        }
    }
}
