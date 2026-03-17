// EdgeBase Kotlin SDK — JVM (Desktop) platform actual implementations.
//
//: KMP 전환. Desktop apps (Compose Desktop, etc.).

package dev.edgebase.sdk.core

import io.ktor.client.HttpClient as KtorHttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import java.net.URLEncoder
import java.util.Base64
import java.util.UUID

actual fun platformUrlEncode(value: String): String =
    URLEncoder.encode(value, "UTF-8").replace("+", "%20")

actual fun platformBase64Decode(input: String): ByteArray =
    Base64.getDecoder().decode(input)

actual fun platformBase64UrlDecode(input: String): ByteArray {
    val padded = when (input.length % 4) {
        2 -> "$input=="
        3 -> "$input="
        else -> input
    }
    return Base64.getUrlDecoder().decode(padded)
}

actual fun currentTimeMillis(): Long = System.currentTimeMillis()

actual fun platformUuid(): String = UUID.randomUUID().toString()

actual fun createPlatformHttpClient(): KtorHttpClient = KtorHttpClient(CIO) {
    install(HttpTimeout) {
        requestTimeoutMillis = 120_000
        connectTimeoutMillis = 30_000
        socketTimeoutMillis = 120_000
    }
    engine {
        requestTimeout = 120_000
    }
}
