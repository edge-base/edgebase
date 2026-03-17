// EdgeBase Java SDK — legacy isolateBy context manager.
//: auth.id is silently filtered — server extracts from JWT only.
package dev.edgebase.sdk.core;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Context manager for legacy isolateBy compatibility state.
 * HTTP DB routing uses explicit namespace and instance ID path segments.
 *
 * <p>
 * The {@code auth.id} key is silently filtered from context because the server
 * derives it from JWT claims only.
 */
public class ContextManager {
    private final Object lock = new Object();
    private Map<String, Object> context = Collections.emptyMap();

    public void setContext(Map<String, Object> ctx) {
        synchronized (lock) {
            Map<String, Object> filtered = new HashMap<>(ctx);
            filtered.remove("auth.id");
            context = Collections.unmodifiableMap(filtered);
        }
    }

    public Map<String, Object> getContext() {
        synchronized (lock) {
            return context;
        }
    }

    public void clearContext() {
        synchronized (lock) {
            context = Collections.emptyMap();
        }
    }
}
