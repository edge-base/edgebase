// Core interface stubs — protocol definitions for client-only types.
// Full implementations live in :client module.
package dev.edgebase.sdk.core

import kotlinx.coroutines.flow.Flow

/** Minimal interface for token management used by HttpClient. */
interface TokenManager {
    suspend fun getAccessToken(): String?
    suspend fun getRefreshToken(): String?
    suspend fun setTokens(access: String, refresh: String)
    suspend fun clearTokens()
}

/** Minimal interface for database-live subscriptions used by TableRef. */
interface DatabaseLiveClient {
    fun subscribe(tableName: String): Flow<DbChange>
    fun unsubscribe(id: String)
}
