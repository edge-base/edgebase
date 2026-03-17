// EdgeBase Java SDK — File information from storage operations.
package dev.edgebase.sdk.core;

import java.util.Map;

/**
 * File information returned from storage operations.
 */
public class FileInfo {
    private final String key;
    private final long size;
    private final String contentType;
    private final String etag;
    private final String lastModified;
    private final Map<String, String> customMetadata;

    public FileInfo(String key, long size, String contentType, String etag,
            String lastModified, Map<String, String> customMetadata) {
        this.key = key;
        this.size = size;
        this.contentType = contentType;
        this.etag = etag;
        this.lastModified = lastModified;
        this.customMetadata = customMetadata;
    }

    public String getKey() {
        return key;
    }

    public long getSize() {
        return size;
    }

    public String getContentType() {
        return contentType;
    }

    public String getEtag() {
        return etag;
    }

    public String getLastModified() {
        return lastModified;
    }

    public Map<String, String> getCustomMetadata() {
        return customMetadata;
    }

    @SuppressWarnings("unchecked")
    public static FileInfo fromJson(Map<String, Object> json) {
        return new FileInfo(
                (String) json.getOrDefault("key", ""),
                json.get("size") instanceof Number ? ((Number) json.get("size")).longValue() : 0L,
                (String) json.get("contentType"),
                (String) json.get("etag"),
                (String) json.get("lastModified"),
                (Map<String, String>) json.get("customMetadata"));
    }
}
