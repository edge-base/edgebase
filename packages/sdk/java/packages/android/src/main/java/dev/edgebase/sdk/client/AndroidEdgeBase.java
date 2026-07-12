package dev.edgebase.sdk.client;

import android.app.Activity;

/** Android-only factory that binds a lifecycle/UI context before client use. */
public final class AndroidEdgeBase {
    private AndroidEdgeBase() {
    }

    /**
     * Pass the current Activity when initialization happens after it is resumed
     * so an immediately interactive CAPTCHA has a valid UI host.
     * This overload uses process-memory tokens; anonymous email/phone upgrades
     * fail before network until a DurableTokenStorage is supplied.
     */
    public static ClientEdgeBase client(Activity activity, String url) {
        TurnstileProvider.initialize(activity);
        return new ClientEdgeBase(url);
    }

    /**
     * Create an Android client with app-supplied storage. Anonymous upgrades
     * require the storage to implement {@link DurableTokenStorage}.
     */
    public static ClientEdgeBase client(Activity activity, String url, TokenStorage tokenStorage) {
        TurnstileProvider.initialize(activity);
        return new ClientEdgeBase(url, tokenStorage, null);
    }
}
