// EdgeBase Kotlin SDK — Storage client.
//
// Full storage API: upload, download, signed URLs, copy, move, resumable.
// Mirrors Dart/Swift SDK structure.
//: java.util.Base64/URLEncoder → platform functions for KMP.

package dev.edgebase.sdk.core

import dev.edgebase.sdk.core.generated.GeneratedDbApi

// MARK: - Data types

/**
 * File information returned from storage operations.
 */
data class FileInfo(
    val key: String,
    val size: Long,
    val contentType: String?,
    val etag: String?,
    val lastModified: String? = null,
    val customMetadata: Map<String, String>? = null
) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun fromJson(json: Map<String, Any?>): FileInfo = FileInfo(
            key = json["key"] as? String ?: "",
            size = (json["size"] as? Number)?.toLong() ?: 0,
            contentType = json["contentType"] as? String,
            etag = json["etag"] as? String,
            lastModified = json["lastModified"] as? String,
            customMetadata = json["customMetadata"] as? Map<String, String>
        )
    }
}

/**
 * Signed URL result.
 */
data class SignedUrlResult(val url: String, val expiresIn: Int)

// MARK: - StorageClient

/**
 * Storage client — provides access to storage buckets.
 *
 * Usage:
 * ```kotlin
 * val bucket = client.storage.bucket("avatars")
 * bucket.upload("profile.png", imageData)
 * val url = bucket.getUrl("profile.png")
 * ```
 */
class StorageClient(
    private val client: HttpClient,
    private val core: GeneratedDbApi? = null
) {

    /**
     * Get a bucket reference.
     */
    fun bucket(name: String): StorageBucket = StorageBucket(client, name, core)
}

// MARK: - StorageBucket

/**
 * Storage bucket — operations on files within a bucket.
 * Delegates JSON-based API calls to [GeneratedDbApi] where possible.
 * Multipart uploads and raw byte downloads use [HttpClient] directly.
 */
class StorageBucket(
    private val client: HttpClient,
    val name: String,
    private val core: GeneratedDbApi? = null
) {
    // MARK: - Upload

    @Suppress("UNCHECKED_CAST")
    suspend fun upload(
        key: String,
        data: ByteArray,
        contentType: String? = null,
        customMetadata: Map<String, String>? = null
    ): FileInfo {
        val extra = mutableMapOf<String, String>()
        extra["key"] = key
        if (contentType != null) extra["contentType"] = contentType
        customMetadata?.forEach { (k, v) -> extra["meta_$k"] = v }

        val json = client.uploadMultipart(
            "/storage/$name/upload",
            key.substringAfterLast("/"),
            data,
            contentType ?: "application/octet-stream",
            extra
        ) as Map<String, Any?>
        return FileInfo.fromJson(json)
    }

    /**
     * Upload string data with encoding.
     *
     * @param encoding One of: "raw", "base64", "base64url", "data_url"
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun uploadString(
        key: String,
        content: String,
        encoding: String = "raw"
    ): FileInfo {
        val data = when (encoding) {
            "base64" -> platformBase64Decode(content)
            "base64url" -> platformBase64UrlDecode(content)
            "data_url" -> {
                val commaIdx = content.indexOf(",")
                if (commaIdx >= 0) platformBase64Decode(content.substring(commaIdx + 1))
                else content.encodeToByteArray()
            }
            else -> content.encodeToByteArray() // "raw"
        }
        return upload(key, data)
    }

    // MARK: - Download

    suspend fun download(key: String): ByteArray {
        return client.downloadRaw("/storage/$name/${platformUrlEncode(key)}")
    }

    // MARK: - Delete

    suspend fun delete(key: String) {
        if (core != null) {
            core.deleteFile(name, key)
        } else {
            client.delete("/storage/$name/${platformUrlEncode(key)}")
        }
    }

    // MARK: - List

    @Suppress("UNCHECKED_CAST")
    suspend fun list(
        prefix: String? = null,
        limit: Int? = null,
        cursor: String? = null
    ): Map<String, Any?> {
        val params = mutableMapOf<String, String>()
        prefix?.let { params["prefix"] = it }
        limit?.let { params["limit"] = it.toString() }
        cursor?.let { params["cursor"] = it }
        return client.get("/storage/$name", params) as Map<String, Any?>
    }

    // MARK: - URL

    fun getUrl(key: String): String {
        return "${client.baseUrl}/api/storage/$name/${platformUrlEncode(key)}"
    }

    // MARK: - Metadata

    @Suppress("UNCHECKED_CAST")
    suspend fun getMetadata(key: String): FileInfo {
        val json = if (core != null) {
            core.getFileMetadata(name, key) as Map<String, Any?>
        } else {
            client.get("/storage/$name/${platformUrlEncode(key)}/metadata") as Map<String, Any?>
        }
        return FileInfo.fromJson(json)
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun updateMetadata(key: String, metadata: Map<String, Any?>): FileInfo {
        val json = if (core != null) {
            core.updateFileMetadata(name, key, metadata) as Map<String, Any?>
        } else {
            client.patch("/storage/$name/${platformUrlEncode(key)}/metadata", metadata) as Map<String, Any?>
        }
        return FileInfo.fromJson(json)
    }

    // MARK: - Signed URLs

    @Suppress("UNCHECKED_CAST")
    suspend fun createSignedUrl(key: String, expiresIn: String = "1h"): SignedUrlResult {
        val body = mapOf<String, Any?>("key" to key, "expiresIn" to expiresIn)
        val json = if (core != null) {
            core.createSignedDownloadUrl(name, body) as Map<String, Any?>
        } else {
            client.post("/storage/$name/signed-url", body) as Map<String, Any?>
        }
        return SignedUrlResult(
            url = json["url"] as? String ?: "",
            expiresIn = (json["expiresIn"] as? Number)?.toInt() ?: 3600
        )
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun createSignedUrls(keys: List<String>, expiresIn: String = "1h"): List<SignedUrlResult> {
        val body = mapOf<String, Any?>("keys" to keys, "expiresIn" to expiresIn)
        val json = if (core != null) {
            core.createSignedDownloadUrls(name, body) as Map<String, Any?>
        } else {
            client.post("/storage/$name/signed-urls", body) as Map<String, Any?>
        }
        val urls = json["urls"] as? List<*> ?: emptyList<Any?>()
        return urls.mapNotNull { entry ->
            val item = entry as? Map<String, Any?> ?: return@mapNotNull null
            SignedUrlResult(
                url = item["url"] as? String ?: "",
                expiresIn = (item["expiresIn"] as? Number)?.toInt() ?: 3600
            )
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun createSignedUploadUrl(key: String, expiresIn: Int = 3600): SignedUrlResult {
        val body = mapOf<String, Any?>("key" to key, "expiresIn" to "${expiresIn}s")
        val json = if (core != null) {
            core.createSignedUploadUrl(name, body) as Map<String, Any?>
        } else {
            client.post("/storage/$name/signed-upload-url", body) as Map<String, Any?>
        }
        return SignedUrlResult(
            url = json["url"] as? String ?: "",
            expiresIn = (json["expiresIn"] as? Number)?.toInt() ?: expiresIn
        )
    }

    suspend fun exists(key: String): Boolean {
        return if (core != null) {
            core.checkFileExists(name, key)
        } else {
            client.head("/storage/$name/${platformUrlEncode(key)}")
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun getUploadParts(key: String, uploadId: String): Map<String, Any?> {
        val json = if (core != null) {
            core.getUploadParts(name, uploadId, mapOf("key" to key)) as Map<String, Any?>
        } else {
            client.get(
                "/storage/$name/uploads/$uploadId/parts",
                queryParams = mapOf("key" to key)
            ) as Map<String, Any?>
        }
        return mapOf(
            "uploadId" to (json["uploadId"] ?: uploadId),
            "key" to (json["key"] ?: key),
            "parts" to (json["parts"] ?: emptyList<Any>())
        )
    }

    // MARK: - Resumable Upload

    @Suppress("UNCHECKED_CAST")
    suspend fun initiateResumableUpload(key: String, contentType: String? = null): Map<String, Any?> {
        val body = mapOf<String, Any?>(
            "key" to key,
            "contentType" to (contentType ?: "application/octet-stream")
        )
        return if (core != null) {
            core.createMultipartUpload(name, body) as Map<String, Any?>
        } else {
            client.post("/storage/$name/multipart/create", body) as Map<String, Any?>
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun resumeUpload(
        key: String,
        uploadId: String,
        chunk: ByteArray,
        offset: Long
    ): Map<String, Any?> {
        val partNumber = ((offset / (5L * 1024L * 1024L)).toInt()) + 1
        val uploadedPart = client.postBinary(
            "/storage/$name/multipart/upload-part",
            chunk,
            "application/octet-stream",
            queryParams = mapOf(
                "uploadId" to uploadId,
                "partNumber" to partNumber.toString(),
                "key" to key
            )
        ) as Map<String, Any?>

        val etag = uploadedPart["etag"] as? String
            ?: throw EdgeBaseError(0, "Multipart upload missing etag")
        val completeBody = mapOf<String, Any?>(
            "uploadId" to uploadId,
            "key" to key,
            "parts" to listOf(
                mapOf(
                    "partNumber" to ((uploadedPart["partNumber"] as? Number)?.toInt() ?: partNumber),
                    "etag" to etag
                )
            )
        )
        return if (core != null) {
            core.completeMultipartUpload(name, completeBody) as Map<String, Any?>
        } else {
            client.post("/storage/$name/multipart/complete", completeBody) as Map<String, Any?>
        }
    }
}
