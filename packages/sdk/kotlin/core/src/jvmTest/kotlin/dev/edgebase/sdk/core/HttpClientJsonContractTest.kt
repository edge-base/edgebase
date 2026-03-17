package dev.edgebase.sdk.core

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import io.ktor.client.HttpClient as KtorHttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.Executors

class HttpClientJsonContractTest {

    @Test
    fun successfulPlainTextResponseThrowsParseFailure() = withServer(200, "text/plain", "plain-text") { baseUrl ->
        val client = HttpClient(baseUrl, NoopTokenManager())

        val error = assertFailsWith<IllegalStateException> {
            runBlocking { client.get("/plain-text") }
        }
        assertEquals("Invalid JSON response body", error.message)
        client.close()
    }

    @Test
    fun successfulMalformedJsonResponseThrowsParseFailure() = withServer(200, "application/json", "{\"broken\":") { baseUrl ->
        val client = HttpClient(baseUrl, NoopTokenManager())

        val error = assertFailsWith<IllegalStateException> {
            runBlocking { client.get("/broken-json") }
        }
        assertEquals("Invalid JSON response body", error.message)
        client.close()
    }

    @Test
    fun retriesTransientTransportTimeoutBeforeReturningSuccess() {
        val attempts = AtomicInteger(0)
        val engine = MockEngine {
            when (attempts.getAndIncrement()) {
                0 -> throw SocketTimeoutException("Operation timed out")
                else -> respond(
                    content = """{"ok":true}""",
                    status = HttpStatusCode.OK,
                    headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
                )
            }
        }

        val client = HttpClient("https://example.com", NoopTokenManager(), client = KtorHttpClient(engine))
        val result = runBlocking { client.get("/retry-success") } as Map<*, *>

        assertEquals(true, result["ok"])
        assertEquals(2, attempts.get())
        client.close()
    }

    private class NoopTokenManager : TokenManager {
        override suspend fun getAccessToken(): String? = null
        override suspend fun getRefreshToken(): String? = null
        override suspend fun setTokens(access: String, refresh: String) = Unit
        override suspend fun clearTokens() = Unit
    }

    private fun withServer(status: Int, contentType: String, body: String, block: (String) -> Unit) {
        val server = HttpServer.create(InetSocketAddress(0), 0)
        server.executor = Executors.newSingleThreadExecutor()
        server.createContext("/") { exchange -> writeResponse(exchange, status, contentType, body) }
        server.start()
        try {
            block("http://127.0.0.1:${server.address.port}")
        } finally {
            server.stop(0)
        }
    }

    private fun writeResponse(exchange: HttpExchange, status: Int, contentType: String, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        exchange.responseHeaders.set("Content-Type", contentType)
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { output ->
            output.write(bytes)
        }
    }
}
