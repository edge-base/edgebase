@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package dev.edgebase.sdk.client

import platform.UIKit.UIApplication
import platform.UIKit.UIViewAutoresizingFlexibleHeight
import platform.UIKit.UIViewAutoresizingFlexibleWidth
import platform.UIKit.UIWindow
import platform.UIKit.UIWindowScene
import platform.WebKit.WKWebView

internal actual fun attachCaptchaOverlay(webView: WKWebView): Boolean {
    val scenes = UIApplication.sharedApplication.connectedScenes
    for (scene in scenes) {
        val windowScene = scene as? UIWindowScene ?: continue
        val windows = windowScene.windows
        for (window in windows) {
            val uiWindow = window as? UIWindow ?: continue
            if (uiWindow.isKeyWindow()) {
                webView.setFrame(uiWindow.bounds)
                webView.setAutoresizingMask(
                    UIViewAutoresizingFlexibleWidth or UIViewAutoresizingFlexibleHeight
                )
                uiWindow.addSubview(webView)
                return true
            }
        }
    }

    return false
}
