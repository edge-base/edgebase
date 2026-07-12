package dev.edgebase.sdk.client

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.milliseconds

class CaptchaSiteKeyCacheJvmTest {
    @Test
    fun positive_site_key_cache_expires_at_five_minutes() {
        assertTrue(
            isCaptchaSiteKeyCacheFresh(captchaSiteKeyCacheTtl - 1.milliseconds)
        )
        assertFalse(isCaptchaSiteKeyCacheFresh(captchaSiteKeyCacheTtl))
    }
}
