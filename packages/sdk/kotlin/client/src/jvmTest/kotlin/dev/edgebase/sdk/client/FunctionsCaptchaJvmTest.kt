package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.HttpClient
import io.ktor.client.HttpClient as KtorHttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails

class FunctionsCaptchaJvmTest {
    @Test
    fun captchaHeaderIsSentForGetPostAndDelete() = runBlocking {
        val seenMethods = CopyOnWriteArrayList<String>()
        val seenTokens = CopyOnWriteArrayList<String?>()
        val engine = MockEngine { request ->
            seenMethods += request.method.value
            seenTokens += request.headers["X-EdgeBase-Captcha-Token"]
            respond(
                content = "{}",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
            )
        }
        val http = HttpClient(
            "https://api.example.test",
            NoOpTokenManager(),
            client = KtorHttpClient(engine),
        )
        val functions = FunctionsClient(http)

        for (method in listOf("GET", "POST", "DELETE")) {
            functions.call(
                "protected-${method.lowercase()}",
                FunctionCallOptions(
                    method = method,
                    body = if (method == "POST") mapOf("ok" to true) else null,
                    query = if (method == "GET") mapOf("page" to "1") else null,
                    captchaToken = "captcha-$method",
                ),
            )
        }

        assertEquals(listOf("GET", "POST", "DELETE"), seenMethods)
        assertEquals(
            listOf<String?>("captcha-GET", "captcha-POST", "captcha-DELETE"),
            seenTokens,
        )
        http.close()
    }

    @Test
    fun captchaRequestNeverReplaysNetwork401Or429Failures() = runBlocking {
        val attempts = ConcurrentHashMap<String, Int>()
        val engine = MockEngine { request ->
            val name = request.url.segments.last()
            attempts.compute(name) { _, count -> (count ?: 0) + 1 }
            when (name) {
                "network" -> throw SocketTimeoutException("synthetic timeout")
                "unauthorized" -> respond(
                    content = """{"message":"synthetic failure"}""",
                    status = HttpStatusCode.Unauthorized,
                    headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
                )
                else -> respond(
                    content = """{"message":"synthetic failure"}""",
                    status = HttpStatusCode.TooManyRequests,
                    headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
                )
            }
        }
        val http = HttpClient(
            "https://api.example.test",
            NoOpTokenManager(),
            client = KtorHttpClient(engine),
        )
        val functions = FunctionsClient(http)

        for (name in listOf("network", "unauthorized", "rate-limited")) {
            assertFails {
                functions.call(
                    name,
                    FunctionCallOptions(captchaToken = "single-use-token"),
                )
            }
        }

        assertEquals(
            mapOf("network" to 1, "unauthorized" to 1, "rate-limited" to 1),
            attempts,
        )
        http.close()
    }
}
