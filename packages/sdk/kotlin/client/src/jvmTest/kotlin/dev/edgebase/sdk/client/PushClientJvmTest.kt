package dev.edgebase.sdk.client

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class PushClientJvmTest {
    @Test
    fun register_without_token_provider_throws_clear_error_when_permission_is_granted() = runBlocking {
        val push = PushClient(
            client = dev.edgebase.sdk.core.HttpClient("https://dummy.edgebase.fun", NoOpTokenManager()),
            platform = PlatformPush(),
        )
        push.setPermissionProvider(
            getPermissionStatus = { "granted" },
            requestPermission = { "granted" },
        )

        val error = assertFailsWith<IllegalStateException> {
            push.register()
        }

        assertEquals(
            "FCM token provider not set. Call setTokenProvider() first.",
            error.message,
        )
    }
}
