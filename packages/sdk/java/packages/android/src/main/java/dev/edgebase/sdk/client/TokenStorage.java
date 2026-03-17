// EdgeBase Java SDK — Token storage interface.
package dev.edgebase.sdk.client;

import dev.edgebase.sdk.core.*;

/**
 * Token storage interface for platform-specific persistence.
 * Implement this for Android SharedPreferences, desktop file storage, etc.
 */
public interface TokenStorage {
    TokenPair getTokens();

    void saveTokens(TokenPair pair);

    void clearTokens();
}
