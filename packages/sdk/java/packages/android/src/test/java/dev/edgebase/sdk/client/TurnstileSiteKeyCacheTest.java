package dev.edgebase.sdk.client;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TurnstileSiteKeyCacheTest {
    @Test
    void positiveSiteKeyCacheExpiresAtFiveMinutes() {
        long ttl = TurnstileProvider.SITE_KEY_CACHE_TTL_NANOS;

        assertTrue(TurnstileProvider.isSiteKeyCacheFresh(0, ttl - 1));
        assertFalse(TurnstileProvider.isSiteKeyCacheFresh(0, ttl));
    }
}
