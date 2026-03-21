// EdgeBase Kotlin SDK — HTTP client (Ktor-based, KMP).
//
// Ktor-based HTTP client with automatic authentication,
// 401 retry, and multipart uploads.
//: OkHttp → Ktor for KMP support. #133/#136: ContextManager removed.

package dev.edgebase.sdk.core

import io.ktor.client.HttpClient as KtorHttpClient
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.utils.io.core.*
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*

/**
 * HTTP client for EdgeBase API communication.
 *
 * Features:
 * - Automatic Bearer token injection
 * - 401 response → token refresh → automatic retry
 * - Multipart file uploads
 * - Public endpoints (no auth required)
 */
class HttpClient(
    val baseUrl: String,
    private val tokenManager: TokenManager,
    private val serviceKey: String? = null,
    private val projectId: String? = null,
    private val client: KtorHttpClient = createPlatformHttpClient()
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val maxTransportRetries = 2
    private var locale: String? = null

    // MARK: - Public API

    @Suppress("UNCHECKED_CAST")
    suspend fun get(path: String, queryParams: Map<String, String>? = null): Any? =
        request("GET", path, queryParams = queryParams)

    @Suppress("UNCHECKED_CAST")
    suspend fun post(path: String, body: Map<String, Any?> = emptyMap()): Any? =
        request("POST", path, body)

    /**
     * POST with both JSON body and query parameters.
     * Used by generated core for insert/batch endpoints that accept query params (e.g. upsert=true).
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun postWithQuery(path: String, body: Map<String, Any?> = emptyMap(), queryParams: Map<String, String>? = null): Any? =
        request("POST", path, body, queryParams = queryParams)

    @Suppress("UNCHECKED_CAST")
    suspend fun patch(path: String, body: Map<String, Any?> = emptyMap()): Any? =
        request("PATCH", path, body)

    @Suppress("UNCHECKED_CAST")
    suspend fun put(path: String, body: Map<String, Any?> = emptyMap()): Any? =
        request("PUT", path, body)

    /**
     * PUT with both JSON body and query parameters.
     * Used by generated core for update endpoints that accept query params.
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun putWithQuery(path: String, body: Map<String, Any?> = emptyMap(), queryParams: Map<String, String>? = null): Any? =
        request("PUT", path, body, queryParams = queryParams)

    @Suppress("UNCHECKED_CAST")
    suspend fun delete(path: String, body: Map<String, Any?>? = null): Any? =
        request("DELETE", path, body)

    /** HEAD request — returns true if resource exists (2xx). */
    suspend fun head(path: String): Boolean {
        val url = buildUrl(path)
        val response = executeRequestWithRetry {
            client.request(url) {
                method = HttpMethod.Head
                if (serviceKey != null) {
                    header("X-EdgeBase-Service-Key", serviceKey)
                } else {
                    val token = try { tokenManager.getAccessToken() } catch (_: Exception) { null }
                    if (token != null) header(HttpHeaders.Authorization, "Bearer $token")
                }
                addContextHeaders(this)
            }
        }
        return response.status.isSuccess()
    }

    /**
     * GET from public endpoint (no authentication).
     */
    suspend fun getPublic(path: String, queryParams: Map<String, String>? = null): Any? =
        request("GET", path, queryParams = queryParams, isPublic = true)

    /**
     * POST to public endpoint (no authentication).
     */
    suspend fun postPublic(path: String, body: Map<String, Any?> = emptyMap()): Any? =
        request("POST", path, body, isPublic = true)

    /**
     * POST raw binary data with optional query params.
     */
    suspend fun postBinary(
        path: String,
        data: ByteArray,
        contentType: String = "application/octet-stream",
        queryParams: Map<String, String>? = null,
        isPublic: Boolean = false
    ): Any? {
        val url = buildUrl(path, queryParams)
        val response = executeRequestWithRetry {
            client.request(url) {
                method = HttpMethod.Post
                header(HttpHeaders.ContentType, contentType)
                setBody(data)

                if (!isPublic) {
                    if (serviceKey != null) {
                        header("X-EdgeBase-Service-Key", serviceKey)
                    } else {
                        val token = try { tokenManager.getAccessToken() } catch (_: Exception) { null }
                        if (token != null) header(HttpHeaders.Authorization, "Bearer $token")
                    }
                }

                addContextHeaders(this)
            }
        }

        return parseResponse(response)
    }

    /**
     * Upload file data via multipart POST.
     */
    suspend fun uploadMultipart(
        path: String,
        fileName: String,
        data: ByteArray,
        contentType: String = "application/octet-stream",
        extraFields: Map<String, String> = emptyMap()
    ): Any? {
        val url = buildUrl(path)

        val boundary = "EdgeBaseBoundary${currentTimeMillis()}"
        @Suppress("DEPRECATION")
        val multipartBody = buildPacket {
            extraFields.forEach { (key, value) ->
                writeText("--$boundary\r\n")
                writeText("Content-Disposition: form-data; name=\"$key\"\r\n\r\n")
                writeText(value)
                writeText("\r\n")
            }
            writeText("--$boundary\r\n")
            writeText("Content-Disposition: form-data; name=\"file\"; filename=\"$fileName\"\r\n")
            writeText("Content-Type: $contentType\r\n\r\n")
            writeFully(data)
            writeText("\r\n")
            writeText("--$boundary--\r\n")
        }.readBytes()

        val response = executeRequestWithRetry {
            client.request(url) {
                method = HttpMethod.Post
                header(HttpHeaders.ContentType, "multipart/form-data; boundary=$boundary")
                setBody(multipartBody)

                if (serviceKey != null) {
                    header("X-EdgeBase-Service-Key", serviceKey)
                } else {
                    val token = tokenManager.getAccessToken()
                    if (token != null) header(HttpHeaders.Authorization, "Bearer $token")
                }
                addContextHeaders(this)
            }
        }

        return parseResponse(response)
    }

    /**
     * Download raw bytes.
     */
    suspend fun downloadRaw(path: String): ByteArray {
        val url = buildUrl(path)

        val response = executeRequestWithRetry {
            client.get(url) {
                val token = tokenManager.getAccessToken()
                if (token != null) header(HttpHeaders.Authorization, "Bearer $token")
                addContextHeaders(this)
            }
        }

        if (!response.status.isSuccess()) {
            throw EdgeBaseError(response.status.value, "Download failed: ${response.status.description}")
        }
        return response.bodyAsBytes()
    }

    fun setLocale(locale: String?) {
        this.locale = locale
    }

    fun getLocale(): String? = locale

    // MARK: - Internal

    @Suppress("UNCHECKED_CAST")
    private suspend fun request(
        method: String,
        path: String,
        body: Map<String, Any?>? = null,
        isPublic: Boolean = false,
        isRetry: Boolean = false,
        queryParams: Map<String, String>? = null,
        rateLimitAttempt: Int = 0
    ): Any? {
        val url = buildUrl(path, queryParams)
        val requestBody = body?.let { mapToJsonString(it) }

        val response = executeRequestWithRetry {
            client.request(url) {
                this.method = HttpMethod.parse(method)

                // Set body
                if (requestBody != null) {
                    contentType(ContentType.Application.Json)
                    setBody(requestBody)
                } else if (method != "GET") {
                    contentType(ContentType.Application.Json)
                    setBody("{}")
                }

                // Add auth headers (skip for public endpoints)
                if (!isPublic) {
                    if (serviceKey != null) {
                        header("X-EdgeBase-Service-Key", serviceKey)
                    } else {
                        val token = tokenManager.getAccessToken()
                        if (token != null) header(HttpHeaders.Authorization, "Bearer $token")
                    }
                }

                // Add request metadata headers
                addContextHeaders(this)
            }
        }

        // 429 retry with Retry-After header
        if (response.status.value == 429 && rateLimitAttempt < 3) {
            val retryAfter = response.headers["Retry-After"]
            val baseDelayMs = retryAfter?.toLongOrNull()?.let { it * 1000 }
                ?: (1000L * (1L shl rateLimitAttempt))
            val jitter = (baseDelayMs * 0.25 * kotlin.random.Random.nextDouble()).toLong()
            delay(minOf(baseDelayMs + jitter, 10000L))
            return request(method, path, body, isPublic, isRetry, queryParams, rateLimitAttempt + 1)
        }

        // Handle 401 — retry once after token refresh
        if (response.status.value == 401 && !isRetry && !isPublic) {
            val refreshToken = tokenManager.getRefreshToken()
            if (refreshToken != null) {
                try {
                    tokenManager.getAccessToken() // triggers refresh internally
                } catch (_: Exception) { /* ignore */ }
            }
            return request(method, path, body, isPublic, isRetry = true, queryParams = queryParams)
        }

        return parseResponse(response)
    }

    private suspend fun executeRequestWithRetry(block: suspend () -> HttpResponse): HttpResponse {
        var attempt = 0
        while (true) {
            try {
                return block()
            } catch (error: Throwable) {
                if (attempt >= maxTransportRetries || !isRetryableTransportFailure(error)) {
                    throw error
                }
                attempt += 1
                delay(50L * attempt)
            }
        }
    }

    private fun isRetryableTransportFailure(error: Throwable): Boolean {
        val normalized = (error.message ?: error.toString()).lowercase()
        return normalized.contains("timeout") ||
            normalized.contains("timed out") ||
            normalized.contains("connect") ||
            normalized.contains("connection") ||
            normalized.contains("refused") ||
            normalized.contains("reset") ||
            normalized.contains("econnreset") ||
            normalized.contains("eof") ||
            normalized.contains("end of file") ||
            normalized.contains("prematurely closed") ||
            normalized.contains("closed the connection") ||
            normalized.contains("nxdomain") ||
            normalized.contains("network is unreachable")
    }

    private fun buildUrl(path: String, queryParams: Map<String, String>? = null): String {
        val base = "$baseUrl/api$path"
        if (queryParams.isNullOrEmpty()) return base
        val query = queryParams.entries.joinToString("&") { (k, v) ->
            "${platformUrlEncode(k)}=${platformUrlEncode(v)}"
        }
        return "$base?$query"
    }

    private suspend fun addContextHeaders(builder: HttpRequestBuilder) {
        // #133/#136: X-EdgeBase-Context header removed. namespace+id are in the URL path.
        if (projectId != null) {
            builder.header("X-EdgeBase-Project-Id", projectId)
        }
        if (!locale.isNullOrBlank()) {
            builder.header(HttpHeaders.AcceptLanguage, locale!!)
        }
    }

    @Suppress("UNCHECKED_CAST")
    private suspend fun parseResponse(response: HttpResponse): Any? {
        val bodyStr = response.bodyAsText()

        if (!response.status.isSuccess()) {
            try {
                val parsed = jsonStringToMap(bodyStr)
                throw EdgeBaseError.fromJson(parsed, response.status.value)
            } catch (e: EdgeBaseError) {
                throw e
            } catch (_: Exception) {
                throw EdgeBaseError(response.status.value, bodyStr.ifEmpty { response.status.description })
            }
        }

        if (bodyStr.isEmpty()) return null

        val contentType = response.headers[HttpHeaders.ContentType]
        if (!isLikelyJsonResponse(bodyStr, contentType)) {
            throw IllegalStateException("Invalid JSON response body")
        }

        return try {
            val element = json.parseToJsonElement(bodyStr)
            jsonElementToAny(element)
        } catch (error: Exception) {
            throw IllegalStateException("Invalid JSON response body", error)
        }
    }

    // MARK: - Response body as bytes (Ktor)

    private suspend fun HttpResponse.bodyAsBytes(): ByteArray {
        return this.readRawBytes()
    }

    // MARK: - JSON helpers

    private fun isLikelyJsonResponse(bodyStr: String, contentType: String?): Boolean {
        val normalizedContentType = contentType?.lowercase()
        if (normalizedContentType != null && (normalizedContentType.contains("/json") || normalizedContentType.contains("+json"))) {
            return true
        }

        val trimmed = bodyStr.trim()
        if (trimmed.isEmpty()) return false
        if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("\"") || trimmed.startsWith("-")) {
            return true
        }
        if (trimmed.first().isDigit()) {
            return true
        }
        return trimmed.startsWith("true") || trimmed.startsWith("false") || trimmed.startsWith("null")
    }

    private fun mapToJsonString(map: Map<String, Any?>): String {
        val element = anyToJsonElement(map)
        return json.encodeToString(JsonElement.serializer(), element)
    }

    @Suppress("UNCHECKED_CAST")
    private fun jsonStringToMap(str: String): Map<String, Any?> {
        val element = json.parseToJsonElement(str)
        return jsonElementToAny(element) as? Map<String, Any?> ?: emptyMap()
    }

    /** Close the underlying Ktor engine. Call from SDK destroy(). */
    fun close() {
        client.close()
    }

    companion object {
        @Suppress("UNCHECKED_CAST")
        fun anyToJsonElement(value: Any?): JsonElement = when (value) {
            null -> JsonNull
            is Boolean -> JsonPrimitive(value)
            is Number -> JsonPrimitive(value)
            is String -> JsonPrimitive(value)
            is Map<*, *> -> JsonObject((value as Map<String, Any?>).mapValues { anyToJsonElement(it.value) })
            is List<*> -> JsonArray(value.map { anyToJsonElement(it) })
            else -> JsonPrimitive(value.toString())
        }

        fun jsonElementToAny(element: JsonElement): Any? = when (element) {
            is JsonNull -> null
            is JsonPrimitive -> {
                if (element.isString) element.content
                else element.longOrNull ?: element.doubleOrNull ?: element.booleanOrNull ?: element.content
            }
            is JsonObject -> element.entries.associate { (k, v) -> k to jsonElementToAny(v) }
            is JsonArray -> element.map { jsonElementToAny(it) }
        }
    }
}
