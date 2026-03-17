// EdgeBase Java SDK — Signed URL result.
package dev.edgebase.sdk.core;

/**
 * Signed URL result.
 */
public class SignedUrlResult {
    private final String url;
    private final int expiresIn;

    public SignedUrlResult(String url, int expiresIn) {
        this.url = url;
        this.expiresIn = expiresIn;
    }

    public String getUrl() {
        return url;
    }

    public int getExpiresIn() {
        return expiresIn;
    }
}
