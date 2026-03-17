// EdgeBase Java SDK — Storage bucket operations.
package dev.edgebase.sdk.core;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Storage bucket — operations on files within a bucket.
 */
public class StorageBucket {
    private final HttpClient client;
    private final String name;

    private static String encodePathParam(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    StorageBucket(HttpClient client, String name) {
        this.client = client;
        this.name = name;
    }

    public String getName() {
        return name;
    }

    // ─── Upload ───

    @SuppressWarnings("unchecked")
    public FileInfo upload(String key, byte[] data) {
        return upload(key, data, null, null);
    }

    @SuppressWarnings("unchecked")
    public FileInfo upload(String key, byte[] data, String contentType) {
        return upload(key, data, contentType, null);
    }

    @SuppressWarnings("unchecked")
    public FileInfo upload(String key, byte[] data, String contentType,
            Map<String, String> customMetadata) {
        Map<String, String> extra = new LinkedHashMap<>();
        extra.put("key", key);
        if (contentType != null)
            extra.put("contentType", contentType);
        if (customMetadata != null) {
            for (Map.Entry<String, String> entry : customMetadata.entrySet()) {
                extra.put("meta_" + entry.getKey(), entry.getValue());
            }
        }

        String fileName = key.contains("/") ? key.substring(key.lastIndexOf('/') + 1) : key;
        Map<String, Object> json = (Map<String, Object>) client.uploadMultipart(
                "/storage/" + name + "/upload",
                fileName,
                data,
                contentType != null ? contentType : "application/octet-stream",
                extra);
        return FileInfo.fromJson(json);
    }

    /**
     * Upload string data with encoding.
     *
     * @param encoding One of: "raw", "base64", "base64url", "data_url"
     */
    public FileInfo uploadString(String key, String content) {
        return uploadString(key, content, "raw");
    }

    @SuppressWarnings("unchecked")
    public FileInfo uploadString(String key, String content, String encoding) {
        byte[] data;
        switch (encoding) {
            case "base64":
                data = Base64.getDecoder().decode(content);
                break;
            case "base64url":
                data = Base64.getUrlDecoder().decode(content);
                break;
            case "data_url":
                int commaIdx = content.indexOf(",");
                if (commaIdx >= 0) {
                    data = Base64.getDecoder().decode(content.substring(commaIdx + 1));
                } else {
                    data = content.getBytes(StandardCharsets.UTF_8);
                }
                break;
            default: // "raw"
                data = content.getBytes(StandardCharsets.UTF_8);
                break;
        }
        return upload(key, data);
    }

    // ─── Download ───

    public byte[] download(String key) {
        return client.downloadRaw("/storage/" + name + "/" +
                encodePathParam(key));
    }

    // ─── Delete ───

    public void delete(String key) {
        client.delete("/storage/" + name + "/" +
                encodePathParam(key));
    }

    // ─── List ───

    @SuppressWarnings("unchecked")
    public Map<String, Object> list() {
        return list(null, null, null);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> list(String prefix) {
        return list(prefix, null, null);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> list(String prefix, Integer limit, String cursor) {
        Map<String, String> params = new LinkedHashMap<>();
        if (prefix != null)
            params.put("prefix", prefix);
        if (limit != null)
            params.put("limit", limit.toString());
        if (cursor != null)
            params.put("cursor", cursor);
        return (Map<String, Object>) client.get("/storage/" + name,
                params.isEmpty() ? null : params);
    }

    // ─── URL ───

    public String getUrl(String key) {
        return client.getApiBaseUrl() + "/storage/" + name + "/" +
                encodePathParam(key);
    }

    // ─── Metadata ───

    @SuppressWarnings("unchecked")
    public FileInfo getMetadata(String key) {
        Map<String, Object> json = (Map<String, Object>) client.get(
                "/storage/" + name + "/" + encodePathParam(key) + "/metadata");
        return FileInfo.fromJson(json);
    }

    @SuppressWarnings("unchecked")
    public FileInfo updateMetadata(String key, Map<String, Object> metadata) {
        Map<String, Object> json = (Map<String, Object>) client.patch(
                "/storage/" + name + "/" + encodePathParam(key) + "/metadata",
                metadata);
        return FileInfo.fromJson(json);
    }

    // ─── Signed URLs ───

    @SuppressWarnings("unchecked")
    public SignedUrlResult createSignedUrl(String key) {
        return createSignedUrl(key, "1h");
    }

    @SuppressWarnings("unchecked")
    public SignedUrlResult createSignedUrl(String key, String expiresIn) {
        Map<String, Object> json = (Map<String, Object>) client.post(
                "/storage/" + name + "/signed-url",
                Map.of("key", key, "expiresIn", expiresIn));
        return new SignedUrlResult(
                (String) json.getOrDefault("url", ""),
                json.get("expiresIn") instanceof Number ? ((Number) json.get("expiresIn")).intValue() : 3600);
    }

    public List<SignedUrlResult> createSignedUrls(List<String> keys) {
        return createSignedUrls(keys, "1h");
    }

    @SuppressWarnings("unchecked")
    public List<SignedUrlResult> createSignedUrls(List<String> keys, String expiresIn) {
        Map<String, Object> json = (Map<String, Object>) client.post(
                "/storage/" + name + "/signed-urls",
                Map.of("keys", keys, "expiresIn", expiresIn));
        List<SignedUrlResult> results = new ArrayList<>();
        Object urls = json.get("urls");
        if (urls instanceof List<?>) {
            for (Object entry : (List<?>) urls) {
                if (!(entry instanceof Map<?, ?> map))
                    continue;
                Object url = map.get("url");
                Object rawExpires = map.get("expiresIn");
                results.add(new SignedUrlResult(
                        url instanceof String ? (String) url : "",
                        rawExpires instanceof Number ? ((Number) rawExpires).intValue() : 3600));
            }
        }
        return results;
    }

    @SuppressWarnings("unchecked")
    public SignedUrlResult createSignedUploadUrl(String key) {
        return createSignedUploadUrl(key, 3600);
    }

    @SuppressWarnings("unchecked")
    public SignedUrlResult createSignedUploadUrl(String key, int expiresIn) {
        Map<String, Object> json = (Map<String, Object>) client.post(
                "/storage/" + name + "/signed-upload-url",
                Map.of("key", key, "expiresIn", expiresIn + "s"));
        return new SignedUrlResult(
                (String) json.getOrDefault("url", ""),
                json.get("expiresIn") instanceof Number ? ((Number) json.get("expiresIn")).intValue() : expiresIn);
    }

    public boolean exists(String key) {
        return client.head("/storage/" + name + "/" + encodePathParam(key));
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getUploadParts(String key, String uploadId) {
        Map<String, Object> json = (Map<String, Object>) client.get(
                "/storage/" + name + "/uploads/" + uploadId + "/parts",
                Map.of("key", key));
        Map<String, Object> normalized = new LinkedHashMap<>();
        normalized.put("uploadId", json.getOrDefault("uploadId", uploadId));
        normalized.put("key", json.getOrDefault("key", key));
        normalized.put("parts", json.getOrDefault("parts", Collections.emptyList()));
        return normalized;
    }

    // ─── Resumable Upload ───

    @SuppressWarnings("unchecked")
    public Map<String, Object> initiateResumableUpload(String key) {
        return initiateResumableUpload(key, null);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> initiateResumableUpload(String key, String contentType) {
        return (Map<String, Object>) client.post("/storage/" + name + "/multipart/create",
                Map.of("key", key, "contentType", contentType != null ? contentType : "application/octet-stream"));
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> resumeUpload(String key, String uploadId, byte[] chunk, long offset) {
        int partNumber = (int) (offset / (5L * 1024L * 1024L)) + 1;
        Map<String, Object> uploadedPart = (Map<String, Object>) client.postBytes(
                "/storage/" + name + "/multipart/upload-part",
                chunk,
                "application/octet-stream",
                Map.of(
                        "uploadId", uploadId,
                        "partNumber", String.valueOf(partNumber),
                        "key", key));

        String etag = uploadedPart.get("etag") instanceof String ? (String) uploadedPart.get("etag") : null;
        if (etag == null || etag.isEmpty()) {
            throw new EdgeBaseError(0, "Multipart upload missing etag");
        }

        return (Map<String, Object>) client.post(
                "/storage/" + name + "/multipart/complete",
                Map.of(
                        "uploadId", uploadId,
                        "key", key,
                        "parts", List.of(Map.of(
                                "partNumber", uploadedPart.get("partNumber") instanceof Number
                                        ? ((Number) uploadedPart.get("partNumber")).intValue()
                                        : partNumber,
                                "etag", etag))));
    }
}
