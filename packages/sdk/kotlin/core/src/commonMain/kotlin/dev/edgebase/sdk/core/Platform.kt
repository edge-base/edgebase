// EdgeBase Kotlin SDK — Platform abstractions (expect declarations).
//
//: KMP 전환 — JVM 전용 API를 플랫폼별 actual로 분리.

package dev.edgebase.sdk.core

import io.ktor.client.HttpClient as KtorHttpClient

/** URL-encode a string (RFC 3986). */
expect fun platformUrlEncode(value: String): String

/** Decode standard Base64 to bytes. */
expect fun platformBase64Decode(input: String): ByteArray

/** Decode URL-safe Base64 to bytes (handles missing padding). */
expect fun platformBase64UrlDecode(input: String): ByteArray

/** Current time in milliseconds since Unix epoch. */
expect fun currentTimeMillis(): Long

/** Generate a random UUID v4 string. */
expect fun platformUuid(): String

/** Create a platform-specific Ktor HttpClient engine. */
expect fun createPlatformHttpClient(): KtorHttpClient
