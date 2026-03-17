package dev.edgebase.sdk.admin

import dev.edgebase.sdk.core.HttpClient

data class FunctionCallOptions(
    val method: String = "POST",
    val body: Map<String, Any?>? = null,
    val query: Map<String, String>? = null
)

class FunctionsClient(
    private val httpClient: HttpClient
) {
    suspend fun call(path: String, options: FunctionCallOptions = FunctionCallOptions()): Any? {
        val normalizedPath = "/functions/$path"
        return when (options.method.uppercase()) {
            "GET" -> httpClient.get(normalizedPath, options.query)
            "PUT" -> httpClient.put(normalizedPath, options.body ?: emptyMap())
            "PATCH" -> httpClient.patch(normalizedPath, options.body ?: emptyMap())
            "DELETE" -> httpClient.delete(normalizedPath)
            else -> httpClient.post(normalizedPath, options.body ?: emptyMap())
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
