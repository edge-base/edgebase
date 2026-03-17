@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package dev.edgebase.sdk.client

import platform.AppKit.NSApplication
import platform.WebKit.WKWebView

internal actual fun attachCaptchaOverlay(webView: WKWebView): Boolean {
    val keyWindow = NSApplication.sharedApplication.keyWindow ?: return false
    val contentView = keyWindow.contentView ?: return false
    webView.setFrame(contentView.bounds)
    contentView.addSubview(webView)
    return true
}
