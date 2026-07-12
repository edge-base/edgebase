// EdgeBase Java SDK — Main entry point.
package dev.edgebase.sdk.client;

import dev.edgebase.sdk.core.*;

/**
 * EdgeBase SDK main entry point.
 *
 * <p>
 * Provides typed factories for client-side and admin-side SDK instances.
 *
 * <p>
 * Usage:
 * 
 * <pre>{@code
 * // Client (desktop JVM)
 * ClientEdgeBase client = EdgeBase.client("https://my-app.edgebase.fun");
 * client.auth().signUp("user@test.com", "pass123");
 *
 * // Client (Android; pass the current Activity)
 * ClientEdgeBase androidClient = AndroidEdgeBase.client(activity, "https://my-app.edgebase.fun");
 *
 * // Admin (Spring / Ktor / backend)
 * AdminEdgeBase admin = EdgeBase.admin(
 *         "https://my-app.edgebase.fun",
 *         System.getenv("EDGEBASE_SERVICE_KEY"));
 * admin.adminAuth().createUser(Map.of("email", "admin@test.com", "password", "pass"));
 * }</pre>
 */
public final class EdgeBase {
    private EdgeBase() {
    }

    /**
     * Create a desktop JVM client. Android apps must use
     * {@link AndroidEdgeBase#client(android.app.Activity, String)}.
     */
    public static ClientEdgeBase client(String url) {
        return new ClientEdgeBase(url);
    }

    /**
     * Create a desktop JVM client with custom token storage. Android apps must
     * use {@link AndroidEdgeBase#client(android.app.Activity, String, TokenStorage)}.
     */
    public static ClientEdgeBase client(String url, TokenStorage tokenStorage) {
        return new ClientEdgeBase(url, tokenStorage, null);
    }

    /**
     * Create a desktop JVM client with custom options.
     */
    public static ClientEdgeBase client(String url, TokenStorage tokenStorage, String projectId) {
        return new ClientEdgeBase(url, tokenStorage, projectId);
    }

    /**
     * Create an admin-side SDK instance (Spring / Ktor / backend) —.
     */
    public static AdminEdgeBase admin(String url, String serviceKey) {
        return new AdminEdgeBase(url, serviceKey, null);
    }

    /**
     * Create an admin-side SDK instance with project ID —.
     */
    public static AdminEdgeBase admin(String url, String serviceKey, String projectId) {
        return new AdminEdgeBase(url, serviceKey, projectId);
    }

}
