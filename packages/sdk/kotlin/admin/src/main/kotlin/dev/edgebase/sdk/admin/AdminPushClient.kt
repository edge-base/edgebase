// EdgeBase Kotlin SDK — Admin push notification client.
//
// Admin-side push notification management.
// Requires Service Key.

package dev.edgebase.sdk.admin

import dev.edgebase.sdk.admin.generated.GeneratedAdminApi
import dev.edgebase.sdk.core.HttpClient

/** Push payload. */
data class PushPayload(
    val title: String? = null,
    val body: String? = null,
    val image: String? = null,
    val sound: String? = null,
    val badge: Int? = null,
    val data: Map<String, Any>? = null,
    val silent: Boolean? = null,
    val collapseId: String? = null,
    val ttl: Int? = null,
    val apns: Map<String, Any>? = null,
    val fcm: Map<String, Any>? = null,
    val wns: Map<String, Any>? = null,
    val web: Map<String, Any>? = null
) {
    /** Convert to Map for JSON serialization (anyToJsonElement handles Map, not data class). */
    fun toMap(): Map<String, Any?> {
        val map = mutableMapOf<String, Any?>()
        if (title != null) map["title"] = title
        if (body != null) map["body"] = body
        if (image != null) map["image"] = image
        if (sound != null) map["sound"] = sound
        if (badge != null) map["badge"] = badge
        if (data != null) map["data"] = data
        if (silent != null) map["silent"] = silent
        if (collapseId != null) map["collapseId"] = collapseId
        if (ttl != null) map["ttl"] = ttl
        if (apns != null) map["apns"] = apns
        if (fcm != null) map["fcm"] = fcm
        if (wns != null) map["wns"] = wns
        if (web != null) map["web"] = web
        return map
    }
}

/** Result of a send operation. */
data class PushSendResult(
    val sent: Int,
    val failed: Int,
    val removed: Int
)

/** Device token record (Admin only). */
data class DeviceTokenRecord(
    val deviceId: String,
    val token: String,
    val platform: String,
    val updatedAt: String,
    val deviceInfo: Map<String, String>? = null,
    val metadata: Map<String, Any>? = null
)

/** Send log entry. */
data class PushLogEntry(
    val sentAt: String,
    val userId: String,
    val platform: String,
    val status: String,
    val collapseId: String? = null,
    val error: String? = null
)

/**
 * Server-side push notification management (Admin).
 * Enables sending messages, viewing tokens, and reading logs.
 * Requires a Service Key with appropriate permissions.
 */
class AdminPushClient(private val client: HttpClient) {

    private val adminCore = GeneratedAdminApi(client)

    private fun asNullableAnyMap(value: Any?): Map<String, Any?>? {
        val map = value as? Map<*, *> ?: return null
        return buildMap {
            for ((key, entryValue) in map) {
                if (key is String) {
                    put(key, entryValue)
                }
            }
        }
    }

    private fun asAnyMap(value: Any?): Map<String, Any>? {
        val map = value as? Map<*, *> ?: return null
        return buildMap {
            for ((key, entryValue) in map) {
                if (key is String && entryValue != null) {
                    put(key, entryValue)
                }
            }
        }
    }

    private fun asStringMap(value: Any?): Map<String, String>? {
        val map = value as? Map<*, *> ?: return null
        return buildMap {
            for ((key, entryValue) in map) {
                if (key is String && entryValue is String) {
                    put(key, entryValue)
                }
            }
        }
    }

    private fun asMapList(value: Any?): List<Map<String, Any?>> {
        val list = value as? List<*> ?: return emptyList()
        return list.mapNotNull(::asNullableAnyMap)
    }

    /**
     * Send a push notification to a specific user.
     * The server will route it to all the user's registered devices.
     */
    suspend fun send(userId: String, payload: PushPayload): PushSendResult {
        val body = mapOf("userId" to userId, "payload" to payload.toMap())
        @Suppress("UNCHECKED_CAST")
        val res = client.post("/push/send", body) as Map<String, Any?>
        return PushSendResult(
            sent = (res["sent"] as? Number)?.toInt() ?: 0,
            failed = (res["failed"] as? Number)?.toInt() ?: 0,
            removed = (res["removed"] as? Number)?.toInt() ?: 0
        )
    }

    /**
     * Send a push notification to multiple users.
     * Batched sequentially in chunks of 500 on the server.
     */
    suspend fun sendMany(userIds: List<String>, payload: PushPayload): PushSendResult {
        val body = mapOf("userIds" to userIds, "payload" to payload.toMap())
        @Suppress("UNCHECKED_CAST")
        val res = client.post("/push/send-many", body) as Map<String, Any?>
        return PushSendResult(
            sent = (res["sent"] as? Number)?.toInt() ?: 0,
            failed = (res["failed"] as? Number)?.toInt() ?: 0,
            removed = (res["removed"] as? Number)?.toInt() ?: 0
        )
    }

    /**
     * Send a push notification to a specific device token.
     */
    suspend fun sendToToken(token: String, payload: PushPayload, platform: String? = null): PushSendResult {
        val body = mapOf("token" to token, "payload" to payload.toMap(), "platform" to (platform ?: "web"))
        @Suppress("UNCHECKED_CAST")
        val res = client.post("/push/send-to-token", body) as Map<String, Any?>
        return PushSendResult(
            sent = (res["sent"] as? Number)?.toInt() ?: 0,
            failed = (res["failed"] as? Number)?.toInt() ?: 0,
            removed = (res["removed"] as? Number)?.toInt() ?: 0
        )
    }

    /**
     * View registered devices for a user.
     * The token value itself is returned because it's an Admin API.
     */
    suspend fun getTokens(userId: String): List<DeviceTokenRecord> {
        @Suppress("UNCHECKED_CAST")
        val res = adminCore.getPushTokens(mapOf("userId" to userId)) as Map<String, Any?>
        val items = asMapList(res["items"])
        return items.map { item ->
            DeviceTokenRecord(
                deviceId = item["deviceId"] as String,
                token = item["token"] as String,
                platform = item["platform"] as String,
                updatedAt = item["updatedAt"] as String,
                deviceInfo = asStringMap(item["deviceInfo"]),
                metadata = asAnyMap(item["metadata"])
            )
        }
    }

    /**
     * Get recent push logs for a user (last 24h).
     */
    suspend fun getLogs(userId: String, limit: Int = 50): List<PushLogEntry> {
        val query = mutableMapOf("userId" to userId)
        if (limit > 0) query["limit"] = limit.toString()
        @Suppress("UNCHECKED_CAST")
        val res = adminCore.getPushLogs(query) as Map<String, Any?>
        val items = asMapList(res["items"])
        return items.map { item ->
            PushLogEntry(
                sentAt = item["sentAt"] as String,
                userId = item["userId"] as String,
                platform = item["platform"] as String,
                status = item["status"] as String,
                collapseId = item["collapseId"] as? String,
                error = item["error"] as? String
            )
        }
    }

    /**
     * Send a push notification to an FCM topic.
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun sendToTopic(topic: String, payload: Map<String, Any?>): Map<String, Any?> {
        val res = client.post("/push/send-to-topic", mapOf("topic" to topic, "payload" to payload))
        return res as? Map<String, Any?> ?: emptyMap()
    }

    /**
     * Broadcast a push notification to all devices via /topics/all.
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun broadcast(payload: Map<String, Any?>): Map<String, Any?> {
        val res = client.post("/push/broadcast", mapOf("payload" to payload))
        return res as? Map<String, Any?> ?: emptyMap()
    }
}
