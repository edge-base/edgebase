package dev.edgebase.sdk.admin

import dev.edgebase.sdk.admin.generated.GeneratedAdminApi
import dev.edgebase.sdk.core.currentTimeMillis
import dev.edgebase.sdk.core.generated.GeneratedAnalyticsMethods
import dev.edgebase.sdk.core.generated.GeneratedDbApi

data class AnalyticsEvent(
    val name: String,
    val properties: Map<String, Any?>? = null,
    val timestamp: Long? = null,
    val userId: String? = null,
)

class AnalyticsClient(
    core: GeneratedDbApi,
    private val adminCore: GeneratedAdminApi,
) {
    private val methods = GeneratedAnalyticsMethods(core)

    @Suppress("UNCHECKED_CAST")
    suspend fun overview(options: Map<String, String> = emptyMap()): Map<String, Any?> =
        adminCore.queryAnalytics(buildQuery("overview", options)) as? Map<String, Any?> ?: emptyMap()

    @Suppress("UNCHECKED_CAST")
    suspend fun timeSeries(options: Map<String, String> = emptyMap()): List<Map<String, Any?>> {
        val result = adminCore.queryAnalytics(buildQuery("timeSeries", options)) as? Map<String, Any?> ?: return emptyList()
        return result["timeSeries"] as? List<Map<String, Any?>> ?: emptyList()
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun breakdown(options: Map<String, String> = emptyMap()): List<Map<String, Any?>> {
        val result = adminCore.queryAnalytics(buildQuery("breakdown", options)) as? Map<String, Any?> ?: return emptyList()
        return result["breakdown"] as? List<Map<String, Any?>> ?: emptyList()
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun topEndpoints(options: Map<String, String> = emptyMap()): List<Map<String, Any?>> {
        val result = adminCore.queryAnalytics(buildQuery("topEndpoints", options)) as? Map<String, Any?> ?: return emptyList()
        return result["topItems"] as? List<Map<String, Any?>> ?: emptyList()
    }

    suspend fun track(name: String, properties: Map<String, Any?> = emptyMap(), userId: String? = null) {
        trackBatch(listOf(AnalyticsEvent(name = name, properties = properties, userId = userId)))
    }

    suspend fun trackBatch(events: List<AnalyticsEvent>) {
        if (events.isEmpty()) return
        methods.track(
            mapOf(
                "events" to events.map { event ->
                    buildMap<String, Any?> {
                        put("name", event.name)
                        if (!event.properties.isNullOrEmpty()) put("properties", event.properties)
                        if (!event.userId.isNullOrBlank()) put("userId", event.userId)
                        put("timestamp", event.timestamp ?: currentTimeMillis())
                    }
                }
            )
        )
    }

    suspend fun queryEvents(options: Map<String, String> = emptyMap()): Any? =
        adminCore.queryCustomEvents(options.ifEmpty { null })

    private fun buildQuery(metric: String, options: Map<String, String>): Map<String, String> =
        buildMap {
            put("metric", metric)
            putAll(options)
        }
}
