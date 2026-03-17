// EdgeBase Kotlin SDK — JVM captcha provider (No-op).
//
// JVM is server-side; captcha verification happens at the server level,
// so client-side token acquisition is not applicable.
//: Auto-captcha across all platforms.

package dev.edgebase.sdk.client

actual suspend fun acquireCaptchaToken(siteKey: String, action: String): String? = null
