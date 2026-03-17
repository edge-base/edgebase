@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

// EdgeBase Kotlin SDK — Headless permission request Fragment.
//
// Invisible Fragment that requests Android runtime permissions and delivers the
// result via a callback. Added to the current Activity, requests permission,
// receives the result, then removes itself. Same pattern used by Google Play
// Services and ActivityResultContracts internally.

package dev.edgebase.sdk.client

import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity

/**
 * Headless Fragment for requesting POST_NOTIFICATIONS permission on Android 13+.
 * Self-removes after result is delivered.
 */
internal class PermissionFragment : Fragment() {
    private var callback: ((Boolean) -> Unit)? = null

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(
                arrayOf("android.permission.POST_NOTIFICATIONS"),
                REQUEST_CODE
            )
        } else {
            callback?.invoke(true)
            removeSelf()
        }
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        if (requestCode == REQUEST_CODE) {
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            callback?.invoke(granted)
            removeSelf()
        }
    }

    @Suppress("DEPRECATION")
    private fun removeSelf() {
        try {
            parentFragmentManager.beginTransaction()
                .remove(this)
                .commitAllowingStateLoss()
        } catch (_: Exception) { /* already detached */ }
    }

    companion object {
        private const val REQUEST_CODE = 19126 // EdgeBase push permission
        private const val TAG = "edgebase_push_permission"

        /**
         * Request POST_NOTIFICATIONS permission using a headless Fragment.
         * Attaches an invisible Fragment to the given Activity, receives the
         * permission result, then removes itself.
         *
         * @param activity The current foreground Activity (must be FragmentActivity).
         * @param callback Called with `true` if granted, `false` if denied.
         */
        fun request(activity: FragmentActivity, callback: (Boolean) -> Unit) {
            val fragment = PermissionFragment()
            fragment.callback = callback
            activity.supportFragmentManager.beginTransaction()
                .add(fragment, TAG)
                .commitAllowingStateLoss()
        }
    }
}
