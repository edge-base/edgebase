package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.HttpClient

data class FunctionCallOptions(
    val method: String = "POST",
    val body: Map<String, Any?>? = null,
    val query: Map<String, String>? = null,
    val captchaToken: String? = null
)

class FunctionsClient(
    private val httpClient: HttpClient
) {
    suspend fun call(path: String, options: FunctionCallOptions = FunctionCallOptions()): Any? {
        val normalizedPath = "/functions/$path"
        options.captchaToken?.let {
            require(it.isNotEmpty() && it.length <= 2_048) {
                "captchaToken must be non-empty and at most 2048 characters"
            }
        }
        return when (options.method.uppercase()) {
            "GET" -> httpClient.get(normalizedPath, options.query, options.captchaToken)
            "PUT" -> httpClient.put(normalizedPath, options.body ?: emptyMap(), options.captchaToken)
            "PATCH" -> httpClient.patch(normalizedPath, options.body ?: emptyMap(), options.captchaToken)
            "DELETE" -> httpClient.delete(normalizedPath, captchaToken = options.captchaToken)
            else -> httpClient.post(normalizedPath, options.body ?: emptyMap(), options.captchaToken)
        }
    }

    suspend fun get(path: String, query: Map<String, String>? = null): Any? =
        call(path, FunctionCallOptions(method = "GET", query = query))

    suspend fun post(path: String, body: Map<String, Any?> = emptyMap()): Any? =
        call(path, FunctionCallOptions(method = "POST", body = body))

    suspend fun put(path: String, body: Map<String, Any?> = emptyMap()): Any? =
        call(path, FunctionCallOptions(method = "PUT", body = body))

    suspend fun patch(path: String, body: Map<String, Any?> = emptyMap()): Any? =
        call(path, FunctionCallOptions(method = "PATCH", body = body))

    suspend fun delete(path: String): Any? =
        call(path, FunctionCallOptions(method = "DELETE"))
}
