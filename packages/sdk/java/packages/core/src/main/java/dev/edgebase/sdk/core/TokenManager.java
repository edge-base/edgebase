package dev.edgebase.sdk.core;

/** Minimal interface for token management.
 *  Full implementation lives in :client module. */
public interface TokenManager {
    String getAccessToken();
    String getRefreshToken();
    void setTokens(String access, String refresh);
    void clearTokens();
}
