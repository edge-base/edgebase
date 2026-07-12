package dev.edgebase.sdk.client

import android.app.Activity
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class AndroidActivityTrackerTest {
    @Test
    fun sdk_initialization_after_resume_captures_first_interactive_activity() = runTest {
        val activity = Robolectric.buildActivity(Activity::class.java)
            .setup()
            .resume()
            .get()

        val client = AndroidEdgeBase.client(
            activity = activity,
            url = "https://api.example.test",
            tokenStorage = MemoryTokenStorage()
        )

        assertSame(activity, AndroidActivityTracker.getCurrentActivity())
        client.destroy()
    }

    @Test
    fun direct_android_constructor_fails_fast_without_activity_contract() {
        val previous = System.getProperty("edgebase.test.allowMissingAndroidActivity")
        System.clearProperty("edgebase.test.allowMissingAndroidActivity")
        AndroidActivityTracker.clearForTest()
        try {
            val error = assertThrows(IllegalStateException::class.java) {
                ClientEdgeBase(
                    "https://api.example.test",
                    tokenStorage = MemoryTokenStorage()
                )
            }
            org.junit.Assert.assertTrue(error.message!!.contains("AndroidEdgeBase.client"))
        } finally {
            if (previous == null) {
                System.clearProperty("edgebase.test.allowMissingAndroidActivity")
            } else {
                System.setProperty("edgebase.test.allowMissingAndroidActivity", previous)
            }
        }
    }
}
