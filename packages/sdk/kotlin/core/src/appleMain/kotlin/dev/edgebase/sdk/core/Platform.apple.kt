// EdgeBase Kotlin SDK — Apple platform actual implementations (iOS + macOS).
//
//: KMP 전환. Uses Foundation framework (shared across iOS/macOS).

@file:OptIn(
    kotlinx.cinterop.ExperimentalForeignApi::class,
    kotlinx.cinterop.BetaInteropApi::class
)

package dev.edgebase.sdk.core

import io.ktor.client.HttpClient as KtorHttpClient
import io.ktor.client.engine.darwin.Darwin
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.Foundation.*
import platform.posix.memcpy

actual fun platformUrlEncode(value: String): String {
    // NSCharacterSet.URLQueryAllowedCharacterSet minus reserved chars
    val allowed = NSMutableCharacterSet.alphanumericCharacterSet().apply {
        addCharactersInString("-._~")
    }
    return NSString.create(string = value)
        .stringByAddingPercentEncodingWithAllowedCharacters(allowed as NSCharacterSet) ?: value
}

actual fun platformBase64Decode(input: String): ByteArray {
    val data = NSData.create(
        base64EncodedString = input,
        options = 0u
    ) ?: return ByteArray(0)
    return data.toByteArray()
}

actual fun platformBase64UrlDecode(input: String): ByteArray {
    // Convert URL-safe base64 to standard base64
    var standard = input.replace('-', '+').replace('_', '/')
    // Add padding
    when (standard.length % 4) {
        2 -> standard += "=="
        3 -> standard += "="
    }
    return platformBase64Decode(standard)
}

actual fun currentTimeMillis(): Long =
    (NSDate().timeIntervalSince1970 * 1000).toLong()

actual fun platformUuid(): String = NSUUID().UUIDString()

actual fun createPlatformHttpClient(): KtorHttpClient = KtorHttpClient(Darwin) {
    engine {
        configureRequest {
            setTimeoutInterval(30.0)
        }
    }
}

// Helper: NSData → ByteArray
private fun NSData.toByteArray(): ByteArray {
    val size = this.length.toInt()
    if (size == 0) return ByteArray(0)
    val bytes = ByteArray(size)
    bytes.usePinned { pinned ->
        memcpy(pinned.addressOf(0), this.bytes, this.length)
    }
    return bytes
}
