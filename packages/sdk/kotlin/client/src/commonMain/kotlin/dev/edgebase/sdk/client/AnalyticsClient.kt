package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.currentTimeMillis
import dev.edgebase.sdk.core.generated.GeneratedAnalyticsMethods
import dev.edgebase.sdk.core.generated.GeneratedDbApi

data class AnalyticsEvent(
    val name: String,
    val properties: Map<String, Any?>? = null,
    val timestamp: Long? = null
)

class AnalyticsClient(core: GeneratedDbApi) {
    private val methods = GeneratedAnalyticsMethods(core)

    suspend fun track(name: String, properties: Map<String, Any?> = emptyMap()) {
        trackBatch(listOf(AnalyticsEvent(name = name, properties = properties)))
    }

    suspend fun trackBatch(events: List<AnalyticsEvent>) {
        if (events.isEmpty()) return
        methods.track(
            mapOf(
                "events" to events.map { event ->
                    buildMap<String, Any?> {
                        put("name", event.name)
                        if (!event.properties.isNullOrEmpty()) put("properties", event.properties)
                        put("timestamp", event.timestamp ?: currentTimeMillis())
                    }
                }
            )
        )
    }

    suspend fun flush() {
        // Kotlin client sends immediately, so flush is a compatibility no-op.
    }

    fun destroy() {
        // No retained listeners/resources in the Kotlin implementation.
    }
}
