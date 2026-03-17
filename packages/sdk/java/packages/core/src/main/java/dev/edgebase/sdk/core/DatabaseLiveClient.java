package dev.edgebase.sdk.core;

import java.util.function.Consumer;

/**
 * Minimal interface for database-live subscriptions.
 * Full implementation lives in :client module.
 */
public interface DatabaseLiveClient {
    /** Subscribe to table changes. Returns a Subscription object. */
    Subscription subscribe(String tableName, Consumer<DbChange> handler);

    void unsubscribe(String id);

    /** Subscription handle. */
    interface Subscription {
        void cancel();

        /** Alias for cancel() — follows Java Closeable convention. */
        default void close() {
            cancel();
        }
    }
}
