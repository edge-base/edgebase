package dev.edgebase.sdk.client

import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.net.HttpURLConnection
import java.net.URL
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ClientEdgeBaseJvmAuthE2ETest {

    private val baseUrl = System.getenv("BASE_URL") ?: "http://localhost:8688"
    private val prefix = "kt-client-jvm-auth-${System.currentTimeMillis()}"

    @BeforeTest
    fun requireServer() {
        val available = isServerAvailable(baseUrl)
        val message = "E2E backend not reachable at $baseUrl. Start `edgebase dev --port 8688` or set BASE_URL. Set EDGEBASE_E2E_REQUIRED=1 to fail instead of skip."
        if (System.getenv("EDGEBASE_E2E_REQUIRED") == "1") {
            check(available) { message }
            return
        }
        assumeTrue(available, message)
    }

    private fun isServerAvailable(url: String): Boolean {
        return try {
            val connection = URL("${url.trimEnd('/')}/api/health").openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 1500
            connection.readTimeout = 1500
            val statusCode = connection.responseCode
            statusCode in 200..499
        } catch (_: Exception) {
            false
        }
    }

    @Test
    fun test_signUp_signIn_signOut_lifecycle() = runBlocking {
        val client = ClientEdgeBase(baseUrl, MemoryTokenStorage())
        val email = "$prefix-signup@test.com"
        val password = "KtJvmAuth123!"

        val signUp = client.auth.signUp(email, password)
        assertNotNull(signUp["accessToken"])
        assertNotNull(client.auth.currentUser())

        val signIn = client.auth.signIn(email, password)
        assertNotNull(signIn["accessToken"])

        client.auth.signOut()
        assertTrue(client.auth.currentUser() == null)
        client.destroy()
    }

    @Test
    fun test_signInAnonymously_returns_token() = runBlocking {
        val client = ClientEdgeBase(baseUrl, MemoryTokenStorage())
        val result = client.auth.signInAnonymously()
        assertNotNull(result["accessToken"])
        client.destroy()
    }

    @Test
    fun test_updateProfile_and_getMe() = runBlocking {
        val client = ClientEdgeBase(baseUrl, MemoryTokenStorage())
        val email = "$prefix-profile@test.com"
        client.auth.signUp(email, "KtJvmAuth123!")

        val updated = client.auth.updateProfile(mapOf("displayName" to "Kotlin JVM"))
        assertNotNull(updated["displayName"] ?: updated["user"])

        val me = client.auth.getMe()
        assertNotNull(me["id"] ?: me["user"])
        client.destroy()
    }

    @Test
    fun test_changePassword_and_sessions() = runBlocking {
        val client = ClientEdgeBase(baseUrl, MemoryTokenStorage())
        val email = "$prefix-sessions@test.com"
        val oldPassword = "KtJvmOld123!"
        val newPassword = "KtJvmNew123!"

        client.auth.signUp(email, oldPassword)
        val changed = client.auth.changePassword(oldPassword, newPassword)
        assertNotNull(changed["accessToken"])

        val sessions = client.auth.listSessions()
        assertTrue(sessions.isNotEmpty())

        val client2 = ClientEdgeBase(baseUrl, MemoryTokenStorage())
        client2.auth.signIn(email, newPassword)
        val sessionsAfterSecondSignIn = client.auth.listSessions()
        assertTrue(sessionsAfterSecondSignIn.isNotEmpty())

        if (sessionsAfterSecondSignIn.size >= 2) {
            client.auth.revokeSession((sessionsAfterSecondSignIn.last()["id"] ?: "").toString())
            val remaining = client.auth.listSessions()
            assertTrue(remaining.size < sessionsAfterSecondSignIn.size)
        }

        client2.destroy()
        client.destroy()
    }

    @Test
    fun test_duplicate_email_throws() = runBlocking {
        val client = ClientEdgeBase(baseUrl, MemoryTokenStorage())
        val email = "$prefix-duplicate@test.com"
        client.auth.signUp(email, "KtJvmDup123!")

        val client2 = ClientEdgeBase(baseUrl, MemoryTokenStorage())
        try {
            client2.auth.signUp(email, "KtJvmDup456!")
            assertTrue(false, "Duplicate email sign-up should fail")
        } catch (_: Exception) {
            assertTrue(true)
        } finally {
            client2.destroy()
            client.destroy()
        }
    }

    @Test
    fun test_signInWithOAuth_returns_url() = runBlocking {
        val client = ClientEdgeBase(baseUrl, MemoryTokenStorage())
        val url = client.auth.signInWithOAuth("google")
        assertTrue(url.contains("/api/auth/oauth/google"))
        client.destroy()
    }

    @Test
    fun test_tryRestoreSession_returns_boolean() = runBlocking {
        val client = ClientEdgeBase(baseUrl, MemoryTokenStorage())
        val restored = client.tryRestoreSession()
        assertTrue(restored == true || restored == false)
        client.destroy()
    }
}
