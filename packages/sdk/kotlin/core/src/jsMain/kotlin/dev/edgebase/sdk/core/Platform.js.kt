// EdgeBase Kotlin SDK — JS (Browser) platform actual implementations.
//
//: KMP 전환. Uses browser APIs via external declarations.

package dev.edgebase.sdk.core

import io.ktor.client.HttpClient as KtorHttpClient
import io.ktor.client.engine.js.Js

// External JS function declarations — safe for Kotlin/JS IR backend.
private external fun encodeURIComponent(value: String): String
private external fun atob(encoded: String): String

actual fun platformUrlEncode(value: String): String =
    encodeURIComponent(value)

actual fun platformBase64Decode(input: String): ByteArray {
    val decoded = atob(input)
    return ByteArray(decoded.length) { decoded[it].code.toByte() }
}

actual fun platformBase64UrlDecode(input: String): ByteArray {
    // Convert URL-safe base64 to standard base64
    var standard = input.replace('-', '+').replace('_', '/')
    when (standard.length % 4) {
        2 -> standard += "=="
        3 -> standard += "="
    }
    return platformBase64Decode(standard)
}

actual fun currentTimeMillis(): Long =
    js("Date.now()").unsafeCast<Double>().toLong()

actual fun platformUuid(): String {
    // Use crypto.randomUUID() if available, fallback to manual generation
    return try {
        js("globalThis.crypto.randomUUID()").unsafeCast<String>()
    } catch (_: Throwable) {
        // Fallback: generate UUID v4 manually
        val hexChars = "0123456789abcdef"
        buildString(36) {
            for (i in 0 until 36) {
                when (i) {
                    8, 13, 18, 23 -> append('-')
                    14 -> append('4')
                    19 -> append(hexChars[(js("Math.random()").unsafeCast<Double>() * 4).toInt() + 8])
                    else -> append(hexChars[(js("Math.random()").unsafeCast<Double>() * 16).toInt()])
                }
            }
        }
    }
}

actual fun createPlatformHttpClient(): KtorHttpClient = KtorHttpClient(Js)
