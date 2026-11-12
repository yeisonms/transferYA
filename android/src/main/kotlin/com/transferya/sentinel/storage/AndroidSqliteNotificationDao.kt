package com.transferya.sentinel.storage

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * Implementación SQLite nativa de Android para persistencia local del Centinela (ADR-0001).
 * Usa SQLiteOpenHelper para almacenar en el almacenamiento privado de la app sin dependencias externas.
 */
class AndroidSqliteNotificationDao(context: Context) :
    SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION),
    ICapturedNotificationDao {

    companion object {
        const val DATABASE_NAME = "sentinel_notifications.db"
        const val DATABASE_VERSION = 1
        const val TABLE_NAME = "captured_notifications"

        const val COL_ID = "id"
        const val COL_DEVICE_ID = "device_id"
        const val COL_WALLET_PACKAGE = "wallet_package"
        const val COL_RAW_TITLE = "raw_title"
        const val COL_RAW_TEXT = "raw_text"
        const val COL_CAPTURED_AT = "captured_at"
        const val COL_DISPATCHED_AT = "dispatched_at"
        const val COL_STATUS = "status"
        const val COL_RETRY_COUNT = "retry_count"
        const val COL_LAST_ERROR = "last_error"
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS $TABLE_NAME (
                $COL_ID INTEGER PRIMARY KEY AUTOINCREMENT,
                $COL_DEVICE_ID TEXT NOT NULL,
                $COL_WALLET_PACKAGE TEXT NOT NULL,
                $COL_RAW_TITLE TEXT NOT NULL,
                $COL_RAW_TEXT TEXT NOT NULL,
                $COL_CAPTURED_AT INTEGER NOT NULL,
                $COL_DISPATCHED_AT INTEGER,
                $COL_STATUS TEXT NOT NULL,
                $COL_RETRY_COUNT INTEGER NOT NULL DEFAULT 0,
                $COL_LAST_ERROR TEXT
            );
            """.trimIndent()
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS idx_status_captured_at ON $TABLE_NAME ($COL_STATUS, $COL_CAPTURED_AT);"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Migraciones futuras
    }

    override fun insertPending(entity: CapturedNotificationEntity): Long {
        val db = writableDatabase
        val values = ContentValues().apply {
            put(COL_DEVICE_ID, entity.deviceId)
            put(COL_WALLET_PACKAGE, entity.walletPackage)
            put(COL_RAW_TITLE, entity.rawTitle)
            put(COL_RAW_TEXT, entity.rawText)
            put(COL_CAPTURED_AT, entity.capturedAt)
            put(COL_STATUS, NotificationStatus.PENDING.name)
            put(COL_RETRY_COUNT, 0)
        }
        val id = db.insert(TABLE_NAME, null, values)
        if (id == -1L) {
            throw IllegalStateException("Fallo al insertar notificación en SQLite local de Android")
        }
        return id
    }

    override fun getPendingNotifications(limit: Int): List<CapturedNotificationEntity> {
        val db = readableDatabase
        val cursor: Cursor = db.query(
            TABLE_NAME,
            null,
            "$COL_STATUS = ?",
            arrayOf(NotificationStatus.PENDING.name),
            null,
            null,
            "$COL_CAPTURED_AT ASC",
            limit.toString()
        )
        val list = mutableListOf<CapturedNotificationEntity>()
        cursor.use {
            while (it.moveToNext()) {
                list.add(mapCursorToEntity(it))
            }
        }
        return list
    }

    override fun getById(id: Long): CapturedNotificationEntity? {
        val db = readableDatabase
        val cursor = db.query(
            TABLE_NAME,
            null,
            "$COL_ID = ?",
            arrayOf(id.toString()),
            null,
            null,
            null
        )
        return cursor.use {
            if (it.moveToNext()) mapCursorToEntity(it) else null
        }
    }

    override fun markAsDispatched(id: Long, dispatchedAt: Long): Boolean {
        val db = writableDatabase
        val values = ContentValues().apply {
            put(COL_STATUS, NotificationStatus.DISPATCHED.name)
            put(COL_DISPATCHED_AT, dispatchedAt)
        }
        return db.update(TABLE_NAME, values, "$COL_ID = ?", arrayOf(id.toString())) > 0
    }

    override fun incrementRetry(id: Long, error: String): Boolean {
        val db = writableDatabase
        db.execSQL(
            "UPDATE $TABLE_NAME SET $COL_RETRY_COUNT = $COL_RETRY_COUNT + 1, $COL_LAST_ERROR = ? WHERE $COL_ID = ?",
            arrayOf(error, id.toString())
        )
        return true
    }

    override fun markAsFailed(id: Long, error: String): Boolean {
        val db = writableDatabase
        db.execSQL(
            "UPDATE $TABLE_NAME SET $COL_STATUS = ?, $COL_RETRY_COUNT = $COL_RETRY_COUNT + 1, $COL_LAST_ERROR = ? WHERE $COL_ID = ?",
            arrayOf(NotificationStatus.FAILED.name, error, id.toString())
        )
        return true
    }

    override fun failPendingForOtherDevices(activeDeviceId: String): Int {
        val db = writableDatabase
        val values = ContentValues().apply {
            put(COL_STATUS, NotificationStatus.FAILED.name)
            put(COL_LAST_ERROR, "Descartado al re-emparejar a $activeDeviceId")
        }
        return db.update(
            TABLE_NAME,
            values,
            "$COL_STATUS = ? AND $COL_DEVICE_ID != ?",
            arrayOf(NotificationStatus.PENDING.name, activeDeviceId)
        )
    }

    override fun getLastError(): String? {
        val db = readableDatabase
        val cursor = db.rawQuery(
            "SELECT $COL_LAST_ERROR FROM $TABLE_NAME WHERE $COL_LAST_ERROR IS NOT NULL AND $COL_LAST_ERROR != '' ORDER BY $COL_ID DESC LIMIT 1",
            null
        )
        return cursor.use {
            if (it.moveToNext()) it.getString(0) else null
        }
    }

    override fun getCountByStatus(status: NotificationStatus): Int {
        val db = readableDatabase
        val cursor = db.rawQuery(
            "SELECT COUNT(*) FROM $TABLE_NAME WHERE $COL_STATUS = ?",
            arrayOf(status.name)
        )
        return cursor.use {
            if (it.moveToNext()) it.getInt(0) else 0
        }
    }

    private fun mapCursorToEntity(c: Cursor): CapturedNotificationEntity {
        val dispatchedAtCol = c.getColumnIndexOrThrow(COL_DISPATCHED_AT)
        val dispatchedAt = if (c.isNull(dispatchedAtCol)) null else c.getLong(dispatchedAtCol)

        return CapturedNotificationEntity(
            id = c.getLong(c.getColumnIndexOrThrow(COL_ID)),
            deviceId = c.getString(c.getColumnIndexOrThrow(COL_DEVICE_ID)),
            walletPackage = c.getString(c.getColumnIndexOrThrow(COL_WALLET_PACKAGE)),
            rawTitle = c.getString(c.getColumnIndexOrThrow(COL_RAW_TITLE)),
            rawText = c.getString(c.getColumnIndexOrThrow(COL_RAW_TEXT)),
            capturedAt = c.getLong(c.getColumnIndexOrThrow(COL_CAPTURED_AT)),
            dispatchedAt = dispatchedAt,
            status = NotificationStatus.valueOf(c.getString(c.getColumnIndexOrThrow(COL_STATUS))),
            retryCount = c.getInt(c.getColumnIndexOrThrow(COL_RETRY_COUNT)),
            lastError = c.getString(c.getColumnIndexOrThrow(COL_LAST_ERROR))
        )
    }
}

