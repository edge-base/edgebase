// EdgeBase Java SDK — Storage client.
// Full storage API: upload, download, signed URLs, metadata, resumable.
package dev.edgebase.sdk.core;

/**
 * Storage client — provides access to storage buckets.
 *
 * <p>
 * Usage:
 * 
 * <pre>{@code
 * StorageBucket bucket = client.storage().bucket("avatars");
 * bucket.upload("profile.png", imageData, "image/png");
 * String url = bucket.getUrl("profile.png");
 * }</pre>
 */
public class StorageClient {
    private final HttpClient client;

    public StorageClient(HttpClient client) {
        this.client = client;
    }

    /**
     * Get a bucket reference.
     */
    public StorageBucket bucket(String name) {
        return new StorageBucket(client, name);
    }
}

// ─── StorageBucket ───
// Defined in separate file for Java convention
