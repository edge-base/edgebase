// PushClient — Push notification management for Admin SDK.
package dev.edgebase.sdk.admin

import dev.edgebase.sdk.admin.generated.GeneratedAdminApi
import dev.edgebase.sdk.core.*

/**
 * Client for push notification operations.
 *
 * ```kotlin
 * val result = client.push.send("userId", mapOf("title" to "Hello", "body" to "World"))
 * val result = client.push.sendMany(listOf("u1", "u2"), mapOf("title" to "News"))
 * val logs = client.push.getLogs("userId")
 * ```
 */
class PushClient internal constructor(
    private val client: HttpClient
) {
    private val adminCore = GeneratedAdminApi(client)

    /** Send a push notification to a single user's devices. */
    @Suppress("UNCHECKED_CAST")
    suspend fun send(userId: String, payload: Map<String, Any?>): Map<String, Any?> {
        val res = client.post("/push/send", mapOf("userId" to userId, "payload" to payload))
        return res as? Map<String, Any?> ?: emptyMap()
    }

    /** Send a push notification to multiple users (no limit — server chunks internally). */
    @Suppress("UNCHECKED_CAST")
    suspend fun sendMany(userIds: List<String>, payload: Map<String, Any?>): Map<String, Any?> {
        val res = client.post("/push/send-many", mapOf("userIds" to userIds, "payload" to payload))
        return res as? Map<String, Any?> ?: emptyMap()
    }

    /** Send a push notification to a specific device token. */
    @Suppress("UNCHECKED_CAST")
    suspend fun sendToToken(token: String, payload: Map<String, Any?>, platform: String? = null): Map<String, Any?> {
        val res = client.post("/push/send-to-token", mapOf("token" to token, "payload" to payload, "platform" to (platform ?: "web")))
        return res as? Map<String, Any?> ?: emptyMap()
    }

    /** Get registered device tokens for a user — token values NOT exposed. */
    @Suppress("UNCHECKED_CAST")
    suspend fun getTokens(userId: String): List<Map<String, Any?>> {
        val res = adminCore.getPushTokens(mapOf("userId" to userId))
        val map = res as? Map<String, Any?> ?: return emptyList()
        val items = map["items"] as? List<*> ?: return emptyList()
        return items.filterIsInstance<Map<String, Any?>>()
    }

    /** Get push send logs for a user (last 24 hours). */
    @Suppress("UNCHECKED_CAST")
    suspend fun getLogs(userId: String, limit: Int? = null): List<Map<String, Any?>> {
        val query = mutableMapOf("userId" to userId)
        if (limit != null) query["limit"] = limit.toString()
        val res = adminCore.getPushLogs(query)
        val map = res as? Map<String, Any?> ?: return emptyList()
        val items = map["items"] as? List<*> ?: return emptyList()
        return items.filterIsInstance<Map<String, Any?>>()
    }

    /** Send a push notification to an FCM topic. */
    @Suppress("UNCHECKED_CAST")
    suspend fun sendToTopic(topic: String, payload: Map<String, Any?>): Map<String, Any?> {
        val res = client.post("/push/send-to-topic", mapOf("topic" to topic, "payload" to payload))
        return res as? Map<String, Any?> ?: emptyMap()
    }

    /** Broadcast a push notification to all devices via /topics/all. */
    @Suppress("UNCHECKED_CAST")
    suspend fun broadcast(payload: Map<String, Any?>): Map<String, Any?> {
        val res = client.post("/push/broadcast", mapOf("payload" to payload))
        return res as? Map<String, Any?> ?: emptyMap()
    }
}
