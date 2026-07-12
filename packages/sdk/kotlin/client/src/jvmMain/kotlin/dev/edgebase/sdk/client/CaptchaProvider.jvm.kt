// EdgeBase Kotlin SDK — JVM captcha provider (No-op).
//
// JVM is server-side; captcha verification happens at the server level,
// so client-side token acquisition is not applicable.
//: Auto-captcha across all platforms.

package dev.edgebase.sdk.client

internal actual val usesDirectCaptchaSiteKey: Boolean = false

actual suspend fun acquireCaptchaToken(baseUrl: String, siteKey: String, action: String): String? = null
