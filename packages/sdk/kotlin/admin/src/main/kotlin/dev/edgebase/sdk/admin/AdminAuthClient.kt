// EdgeBase Kotlin SDK — Admin authentication client.
//
// Server-side user management with Service Key authentication.
//
// Usage:
// ```kotlin
// val client = EdgeBase.server("https://...", serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: "")
// val user = admin.adminAuth.getUser("user-id")
// admin.adminAuth.setCustomClaims("user-id", mapOf("role" to "pro"))
// ```

package dev.edgebase.sdk.admin

import dev.edgebase.sdk.admin.generated.GeneratedAdminApi
import dev.edgebase.sdk.core.*

/**
 * Admin auth client for server-side user management.
 *
 * Only available via [ServerEdgeBase] / [EdgeBase.server()].
 * Service Key is injected automatically via [HttpClient].
 *
 * All HTTP calls delegate to [GeneratedAdminApi] — no hardcoded API paths.
 */
class AdminAuthClient(
    private val client: HttpClient,
    private val serviceKey: String?,
    private val adminCore: GeneratedAdminApi
) {
    private fun requireServiceKey() {
        if (serviceKey.isNullOrEmpty()) {
            throw EdgeBaseError(
                statusCode = 403,
                message = "Service Key required for admin operations. Use EdgeBase.server(url, serviceKey)."
            )
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun getUser(userId: String): Map<String, Any?> {
        requireServiceKey()
        val response = adminCore.adminAuthGetUser(userId) as Map<String, Any?>
        // Server returns { user: { id, email, ... } } — unwrap to flat map for callers.
        @Suppress("UNCHECKED_CAST")
        return (response["user"] as? Map<String, Any?>) ?: response
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun listUsers(limit: Int? = null, cursor: String? = null): Map<String, Any?> {
        requireServiceKey()
        val params = buildMap<String, String> {
            if (limit != null) put("limit", limit.toString())
            if (cursor != null) put("cursor", cursor)
        }
        return adminCore.adminAuthListUsers(params.ifEmpty { null }) as Map<String, Any?>
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun createUser(data: Map<String, Any>): Map<String, Any?> {
        requireServiceKey()
        return adminCore.adminAuthCreateUser(data) as Map<String, Any?>
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun updateUser(userId: String, data: Map<String, Any>): Map<String, Any?> {
        requireServiceKey()
        return adminCore.adminAuthUpdateUser(userId, data) as Map<String, Any?>
    }

    suspend fun deleteUser(userId: String) {
        requireServiceKey()
        adminCore.adminAuthDeleteUser(userId)
    }

    /**
     * Set custom JWT claims for a user.
     *
     * Delegates to [GeneratedAdminApi.adminAuthSetClaims] — PUT /api/auth/admin/users/{id}/claims.
     *
     * ```kotlin
     * admin.adminAuth.setCustomClaims("user-id", mapOf("role" to "pro", "tier" to "premium"))
     * ```
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun setCustomClaims(userId: String, claims: Map<String, Any?>): Map<String, Any?> {
        requireServiceKey()
        return adminCore.adminAuthSetClaims(userId, claims) as Map<String, Any?>
    }

    /**
     * Revoke all sessions for a user.
     *
     * Forces the user to sign in again on all devices.
     * Delegates to [GeneratedAdminApi.adminAuthRevokeUserSessions].
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun revokeAllSessions(userId: String): Map<String, Any?> {
        requireServiceKey()
        return adminCore.adminAuthRevokeUserSessions(userId) as Map<String, Any?>
    }
}
