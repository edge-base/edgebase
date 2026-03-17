// EdgeBase Java SDK — Token pair (access + refresh token holder).
package dev.edgebase.sdk.client;

/**
 * Immutable holder for access/refresh token pair.
 *
 * <p>
 * Used by {@link TokenManager} to store token state and by
 * {@link TokenStorage} for persistence.
 */
public class TokenPair {
    private final String accessToken;
    private final String refreshToken;

    public TokenPair(String accessToken, String refreshToken) {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
    }

    public String getAccessToken() {
        return accessToken;
    }

    public String getRefreshToken() {
        return refreshToken;
    }
}
