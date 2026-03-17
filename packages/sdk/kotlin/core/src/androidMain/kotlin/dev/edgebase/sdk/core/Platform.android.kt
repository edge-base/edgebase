// EdgeBase Kotlin SDK — Android platform actual implementations.
//
//: KMP 전환.

package dev.edgebase.sdk.core

import io.ktor.client.HttpClient as KtorHttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import java.net.URLEncoder
import java.util.Base64
import java.util.UUID

actual fun platformUrlEncode(value: String): String =
    URLEncoder.encode(value, "UTF-8").replace("+", "%20")

actual fun platformBase64Decode(input: String): ByteArray =
    Base64.getDecoder().decode(input)

actual fun platformBase64UrlDecode(input: String): ByteArray {
    // Add padding if needed
    val padded = when (input.length % 4) {
        2 -> "$input=="
        3 -> "$input="
        else -> input
    }
    return Base64.getUrlDecoder().decode(padded)
}

actual fun currentTimeMillis(): Long = System.currentTimeMillis()

actual fun platformUuid(): String = UUID.randomUUID().toString()

actual fun createPlatformHttpClient(): KtorHttpClient = KtorHttpClient(OkHttp) {
    install(HttpTimeout) {
        requestTimeoutMillis = 30_000
        connectTimeoutMillis = 30_000
        socketTimeoutMillis = 30_000
    }
    engine {
        config {
            connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
            readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
            writeTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        }
    }
}
