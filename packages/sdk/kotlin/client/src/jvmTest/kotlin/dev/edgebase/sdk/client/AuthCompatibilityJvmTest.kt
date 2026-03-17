package dev.edgebase.sdk.client

import kotlin.test.Test
import kotlin.test.assertNotNull

class AuthCompatibilityJvmTest {
    @Test
    fun auth_surface_exposes_canonical_helpers() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")

        val refreshToken: suspend () -> Any = { client.auth.refreshToken() }
        val linkWithEmail: suspend (String, String) -> Any = { email, password ->
            client.auth.linkWithEmail(email, password)
        }
        val linkWithOAuth: suspend (String) -> Any = { provider ->
            client.auth.linkWithOAuth(provider)
        }
        val currentUser: () -> Any? = { client.auth.currentUser() }
        val listSessions: suspend () -> Any = { client.auth.listSessions() }
        val updateProfile: suspend () -> Any = {
            client.auth.updateProfile(displayName = "Kotlin JVM", avatarUrl = "https://example.com/avatar.png")
        }
        val requestEmailVerification: suspend () -> Unit = {
            client.auth.requestEmailVerification()
        }
        val requestPasswordReset: suspend (String) -> Unit = { email ->
            client.auth.requestPasswordReset(email)
        }
        val changeEmail: suspend (String, String) -> Any = { email, password ->
            client.auth.changeEmail(email, password)
        }
        val signInWithEmailOtp: suspend (String) -> Unit = { email ->
            client.auth.signInWithEmailOtp(email)
        }
        val signInWithMagicLink: suspend (String) -> Unit = { email ->
            client.auth.signInWithMagicLink(email)
        }
        val passkeysAuthOptions: suspend () -> Any = {
            client.auth.passkeysAuthOptions()
        }
        val enrollTotp: suspend () -> Any = {
            client.auth.mfa.enrollTotp()
        }

        assertNotNull(refreshToken)
        assertNotNull(linkWithEmail)
        assertNotNull(linkWithOAuth)
        assertNotNull(currentUser)
        assertNotNull(listSessions)
        assertNotNull(updateProfile)
        assertNotNull(requestEmailVerification)
        assertNotNull(requestPasswordReset)
        assertNotNull(changeEmail)
        assertNotNull(signInWithEmailOtp)
        assertNotNull(signInWithMagicLink)
        assertNotNull(passkeysAuthOptions)
        assertNotNull(enrollTotp)
    }
}
