package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.HttpClient
import io.ktor.client.HttpClient as KtorHttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.content.TextContent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class TokenPersistenceJvmTest {
    @Test
    fun replacement_tokens_are_persisted_before_they_are_exposed() = runTest {
        val storage = FailingTokenStorage()
        val manager = ClientTokenManager(storage)
        val original = TokenPair("original-access", "original-refresh")
        manager.setTokens(original)

        storage.failWrites = true
        val error = assertFailsWith<TokenPersistenceException> {
            manager.setTokens(TokenPair("replacement-access", "replacement-refresh"))
        }

        assertEquals("save", error.operation)
        assertEquals("synthetic persistence failure", error.cause?.message)
        assertEquals("original-access", manager.getAccessToken())
        assertEquals("original-refresh", manager.getRefreshToken())
        assertEquals(original, storage.tokens)
    }

    @Test
    fun refresh_persistence_failure_is_never_downgraded_to_a_stale_token() = runTest {
        val storage = FailingTokenStorage()
        val manager = ClientTokenManager(storage)
        val expiring = TokenPair(
            "header.eyJleHAiOjB9.signature",
            "anonymous-refresh",
        )
        manager.setTokens(expiring)
        manager.setRefreshCallback {
            TokenPair("replacement-access", "replacement-refresh")
        }

        storage.failWrites = true
        val error = assertFailsWith<TokenPersistenceException> {
            manager.getAccessToken()
        }

        assertEquals("save", error.operation)
        assertEquals("synthetic persistence failure", error.cause?.message)
        assertEquals(expiring, storage.tokens)
        assertEquals("anonymous-refresh", manager.getRefreshToken())
    }

    @Test
    fun account_upgrade_fails_closed_without_durable_storage() {
        val manager = ClientTokenManager(MemoryTokenStorage())
        val error = assertFailsWith<IllegalStateException> {
            manager.requireDurableStorageForAccountUpgrade()
        }
        assertEquals(true, error.message?.contains("DurableTokenStorage"))
    }

    @Test
    fun incomplete_stored_pair_is_never_exposed() = runTest {
        val manager = ClientTokenManager(object : DurableTokenStorage {
            override suspend fun getTokens() = TokenPair("", "refresh-only")
            override suspend fun saveTokens(pair: TokenPair) = Unit
            override suspend fun clearTokens() = Unit
        })

        val error = assertFailsWith<InvalidTokenPairException> {
            manager.tryRestoreSession()
        }

        assertEquals("restore", error.operation)
        assertEquals(null, manager.getAccessToken())
    }

    @Test
    fun authenticated_http_never_swallows_refresh_persistence_failure() = runTest {
        val storage = FailingTokenStorage()
        val manager = ClientTokenManager(storage)
        val original = TokenPair(
            "header.eyJleHAiOjB9.signature",
            "anonymous-refresh",
        )
        manager.setTokens(original)
        manager.setRefreshCallback {
            TokenPair("replacement-access", "replacement-refresh")
        }
        storage.failWrites = true
        var networkRequests = 0
        val engine = MockEngine {
            networkRequests += 1
            error("network must not run after persistence failure")
        }
        val http = HttpClient(
            "https://api.example.test",
            manager,
            client = KtorHttpClient(engine),
        )

        val error = assertFailsWith<TokenPersistenceException> {
            http.head("/protected")
        }

        assertEquals("save", error.operation)
        assertEquals(0, networkRequests)
        assertEquals(original, storage.tokens)
        http.close()
    }

    @Test
    fun email_link_retry_replays_checkpoint_before_adopting_replacement_tokens() = runTest {
        val storage = FailingTokenStorage()
        val manager = ClientTokenManager(storage)
        val original = TokenPair("anonymous-access", "anonymous-refresh")
        manager.setTokens(original)

        val bodies = mutableListOf<String>()
        val authorizationHeaders = mutableListOf<String?>()
        val engine = MockEngine { request ->
            assertEquals("/api/auth/link/email", request.url.encodedPath)
            bodies += (request.body as TextContent).text
            authorizationHeaders += request.headers[HttpHeaders.Authorization]
            respond(
                content = """{
                    "sessionId":"permanent-session",
                    "accessToken":"permanent-access",
                    "refreshToken":"permanent-refresh"
                }""".trimIndent(),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
            )
        }
        val http = HttpClient(
            "https://api.example.test",
            manager,
            client = KtorHttpClient(engine),
        )
        val auth = AuthClient(http, manager)

        storage.failWrites = true
        assertFailsWith<TokenPersistenceException> {
            auth.linkWithEmail("user@example.test", "Exact-Pass-123!")
        }
        assertEquals(original, storage.tokens)
        assertEquals("anonymous-access", manager.getAccessToken())
        assertEquals("anonymous-refresh", manager.getRefreshToken())

        storage.failWrites = false
        val replay = auth.linkWithEmail("user@example.test", "Exact-Pass-123!")

        assertEquals("permanent-session", replay["sessionId"])
        assertEquals(
            listOf<String?>("Bearer anonymous-access", "Bearer anonymous-access"),
            authorizationHeaders,
        )
        assertEquals(2, bodies.size)
        assertEquals(bodies.first(), bodies.last())
        assertEquals("permanent-access", manager.getAccessToken())
        assertEquals("permanent-refresh", manager.getRefreshToken())
        assertEquals(TokenPair("permanent-access", "permanent-refresh"), storage.tokens)
        http.close()
    }

    @Test
    fun captcha_unavailable_has_stable_diagnostic_contract() {
        val error = CaptchaUnavailableException("renderer_terminated")
        assertEquals("captcha-unavailable", error.code)
        assertEquals("renderer_terminated", error.reason)
    }

    @Test
    fun captcha_config_fetch_failure_is_not_treated_as_disabled() = runTest {
        val engine = MockEngine {
            respondError(HttpStatusCode.ServiceUnavailable)
        }
        val http = HttpClient(
            "https://captcha-config-failure.example.test",
            ClientTokenManager(MemoryTokenStorage()),
            client = KtorHttpClient(engine),
        )

        val error = assertFailsWith<CaptchaUnavailableException> {
            fetchSiteKey(http)
        }

        assertEquals("config_fetch_failed", error.reason)
        http.close()
    }

    @Test
    fun explicit_null_captcha_config_remains_disabled() = runTest {
        val engine = MockEngine {
            respond(
                content = """{"captcha":null}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
            )
        }
        val http = HttpClient(
            "https://captcha-disabled.example.test",
            ClientTokenManager(MemoryTokenStorage()),
            client = KtorHttpClient(engine),
        )

        assertEquals(null, fetchSiteKey(http))
        http.close()
    }

    @Test
    fun missing_captcha_config_is_rejected_as_malformed() = runTest {
        val engine = MockEngine {
            respond(
                content = "{}",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
            )
        }
        val http = HttpClient(
            "https://captcha-malformed.example.test",
            ClientTokenManager(MemoryTokenStorage()),
            client = KtorHttpClient(engine),
        )

        val error = assertFailsWith<CaptchaUnavailableException> {
            fetchSiteKey(http)
        }

        assertEquals("config_invalid_response", error.reason)
        http.close()
    }

    @Test
    fun malformed_captcha_json_has_invalid_response_reason() = runTest {
        val engine = MockEngine {
            respond(
                content = "not-json",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
            )
        }
        val http = HttpClient(
            "https://captcha-invalid-json.example.test",
            ClientTokenManager(MemoryTokenStorage()),
            client = KtorHttpClient(engine),
        )

        val error = assertFailsWith<CaptchaUnavailableException> {
            fetchSiteKey(http)
        }

        assertEquals("config_invalid_response", error.reason)
        http.close()
    }

    private class FailingTokenStorage : DurableTokenStorage {
        var tokens: TokenPair? = null
        var failWrites = false

        override suspend fun getTokens(): TokenPair? = tokens

        override suspend fun saveTokens(pair: TokenPair) {
            if (failWrites) throw IllegalStateException("synthetic persistence failure")
            tokens = pair
        }

        override suspend fun clearTokens() {
            tokens = null
        }
    }
}
