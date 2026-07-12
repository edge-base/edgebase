package dev.edgebase.sdk.client

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class CaptchaChallengeJvmTest {
    @Test
    fun buildsHttpsChannelBoundChallengeUrl() {
        val channel = "0123456789abcdef0123456789abcdef"
        assertEquals(
            "https://api.example.test/api/captcha/challenge" +
                "?action=signin&channel=$channel&bridge=android",
            buildHostedCaptchaChallengeUrl(
                "https://api.example.test/",
                "signin",
                channel,
                "android"
            )
        )
    }

    @Test
    fun rejectsHttpCredentialsAndDynamicActions() {
        val channel = "0123456789abcdef0123456789abcdef"
        assertFailsWith<IllegalArgumentException> {
            buildHostedCaptchaChallengeUrl("http://api.example.test", "signin", channel, "android")
        }
        assertFailsWith<IllegalArgumentException> {
            buildHostedCaptchaChallengeUrl("https://user@api.example.test", "signin", channel, "android")
        }
        assertFailsWith<IllegalArgumentException> {
            buildHostedCaptchaChallengeUrl("https://api.example.test", "function:unsafe", channel, "android")
        }
    }

    @Test
    fun parsesOnlyVersionedMessagesForTheExpectedChannel() {
        val channel = "0123456789abcdef0123456789abcdef"
        val valid = """{"v":1,"channel":"$channel","type":"token","value":"synthetic-token"}"""
        val wrong = """{"v":1,"channel":"fedcba9876543210fedcba9876543210","type":"token","value":"synthetic-token"}"""

        assertEquals("synthetic-token", parseHostedCaptchaMessage(valid, channel)?.value)
        assertNull(parseHostedCaptchaMessage(wrong, channel))
    }
}
