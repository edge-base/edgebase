// EdgeBase Kotlin SDK — Error types.
//
// Mirrors Dart SDK error structure.

package dev.edgebase.sdk.core

/**
 * General EdgeBase API error.
 *
 * Contains HTTP status code, message, and optional field-level validation details.
 */
class EdgeBaseError(
    val statusCode: Int,
    override val message: String,
    val details: Map<String, List<String>>? = null
) : Exception(message) {

    override fun toString(): String {
        val base = "EdgeBaseError($statusCode): $message"
        if (details.isNullOrEmpty()) return base
        val fieldInfo = details.entries.joinToString(", ") { (k, v) -> "$k: ${v.joinToString(", ")}" }
        return "$base [$fieldInfo]"
    }

    companion object {
        /**
         * Parse a EdgeBase error from JSON response body.
         */
        @Suppress("UNCHECKED_CAST")
        fun fromJson(json: Map<String, Any?>, statusCode: Int): EdgeBaseError {
            val message = (json["message"] as? String)
                ?: (json["error"] as? String)
                ?: "Request failed with HTTP $statusCode and no error message from the server."
            val rawDetails = json["details"] as? Map<String, Any?>
            val details = rawDetails?.mapValues { (_, v) ->
                when (v) {
                    is List<*> -> v.filterIsInstance<String>()
                    else -> listOf(v.toString())
                }
            }
            return EdgeBaseError(statusCode, message, details)
        }
    }
}

/**
 * Authentication-specific error.
 */
class EdgeBaseAuthError(
    val statusCode: Int,
    override val message: String
) : Exception(message) {

    override fun toString(): String = "EdgeBaseAuthError($statusCode): $message"
}
