// EdgeBase Kotlin SDK — Context manager.
//
// Manages multi-tenancy context (isolateBy).
//: auth.id is silently filtered — server extracts from JWT only.

package dev.edgebase.sdk.core

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Context manager for multi-tenancy support.
 *
 * The `auth.id` key is silently filtered from context  * the server extracts it from JWT only.
 *
 * Usage:
 * ```kotlin
 * client.setContext(mapOf("tenantId" to "tenant1"))
 * ```
 */
class ContextManager {
    private val mutex = Mutex()
    private var context: Map<String, Any> = emptyMap()

    // Filter out auth.id — server extracts from JWT only
    suspend fun setContext(ctx: Map<String, Any>) = mutex.withLock {
        context = ctx.filterKeys { it != "auth.id" }
    }
    suspend fun getContext(): Map<String, Any> = mutex.withLock { context }
    suspend fun clearContext() = mutex.withLock { context = emptyMap() }
}
