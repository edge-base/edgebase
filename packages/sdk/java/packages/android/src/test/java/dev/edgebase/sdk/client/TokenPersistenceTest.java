package dev.edgebase.sdk.client;

import dev.edgebase.sdk.core.ContextManager;
import dev.edgebase.sdk.core.HttpClient;
import dev.edgebase.sdk.core.generated.GeneratedDbApi;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import org.junit.jupiter.api.Test;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TokenPersistenceTest {
    @Test
    void replacementTokensArePersistedBeforeTheyAreExposed() {
        FailingStorage storage = new FailingStorage();
        TokenManager manager = new TokenManager(storage);
        TokenPair original = new TokenPair("original-access", "original-refresh");
        manager.setTokens(original);

        storage.failWrites = true;
        TokenPersistenceException error = assertThrows(
            TokenPersistenceException.class,
            () -> manager.setTokens(new TokenPair("replacement-access", "replacement-refresh"))
        );

        assertEquals("save", error.getOperation());
        assertEquals("original-access", manager.getAccessToken());
        assertEquals("original-refresh", manager.getRefreshToken());
        assertEquals(original, storage.tokens);
    }

    @Test
    void emailLinkRetryReplaysCheckpointBeforeAdoptingReplacementTokens() throws Exception {
        FailingStorage storage = new FailingStorage();
        TokenManager manager = new TokenManager(storage);
        TokenPair original = new TokenPair("anonymous-access", "anonymous-refresh");
        manager.setTokens(original);

        List<String> bodies = new ArrayList<>();
        List<String> authorizationHeaders = new ArrayList<>();
        OkHttpClient transport = new OkHttpClient.Builder()
            .addInterceptor(chain -> {
                assertEquals("/api/auth/link/email", chain.request().url().encodedPath());
                Buffer body = new Buffer();
                chain.request().body().writeTo(body);
                bodies.add(body.readUtf8());
                authorizationHeaders.add(chain.request().header("Authorization"));
                return new Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("synthetic checkpoint replay")
                    .body(ResponseBody.create(
                        "{\"sessionId\":\"permanent-session\"," +
                            "\"accessToken\":\"permanent-access\"," +
                            "\"refreshToken\":\"permanent-refresh\"}",
                        MediaType.parse("application/json")))
                    .build();
            })
            .build();
        dev.edgebase.sdk.core.TokenManager coreTokens = new dev.edgebase.sdk.core.TokenManager() {
            @Override public String getAccessToken() { return manager.getAccessToken(); }
            @Override public String getRefreshToken() { return manager.getRefreshToken(); }
            @Override public void setTokens(String access, String refresh) {
                manager.setTokens(new TokenPair(access, refresh));
            }
            @Override public void clearTokens() { manager.clearTokens(); }
        };
        HttpClient http = new HttpClient(
            "https://api.example.test",
            coreTokens,
            new ContextManager(),
            null,
            null,
            transport);
        AuthClient auth = new AuthClient(http, manager, new GeneratedDbApi(http));

        storage.failWrites = true;
        assertThrows(
            TokenPersistenceException.class,
            () -> auth.linkWithEmail("user@example.test", "Exact-Pass-123!")
        );
        assertEquals(original, storage.tokens);
        assertEquals("anonymous-access", manager.getAccessToken());
        assertEquals("anonymous-refresh", manager.getRefreshToken());

        storage.failWrites = false;
        var replay = auth.linkWithEmail("user@example.test", "Exact-Pass-123!");

        assertEquals("permanent-session", replay.get("sessionId"));
        assertEquals(List.of("Bearer anonymous-access", "Bearer anonymous-access"), authorizationHeaders);
        assertEquals(2, bodies.size());
        assertEquals(bodies.get(0), bodies.get(1));
        assertEquals("permanent-access", manager.getAccessToken());
        assertEquals("permanent-refresh", manager.getRefreshToken());
        assertEquals("permanent-access", storage.tokens.getAccessToken());
        assertEquals("permanent-refresh", storage.tokens.getRefreshToken());
        http.close();
    }

    @Test
    void captchaUnavailableHasStableDiagnosticContract() {
        CaptchaUnavailableException error =
            new CaptchaUnavailableException("renderer_terminated");
        assertEquals("captcha-unavailable", error.getCode());
        assertEquals("renderer_terminated", error.getReason());
    }

    @Test
    void captchaConfigFetchFailureIsNotTreatedAsDisabled() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/config", exchange -> {
            byte[] body = "synthetic outage".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(503, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            CaptchaUnavailableException error = assertThrows(
                CaptchaUnavailableException.class,
                () -> TurnstileProvider.fetchSiteKey(baseUrl)
            );
            assertEquals("config_fetch_failed", error.getReason());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void explicitNullCaptchaConfigRemainsDisabled() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/config", exchange -> {
            byte[] body = "{\"captcha\":null}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            assertEquals(null, TurnstileProvider.fetchSiteKey(baseUrl));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void missingCaptchaConfigIsRejectedAsMalformed() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/config", exchange -> {
            byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            CaptchaUnavailableException error = assertThrows(
                CaptchaUnavailableException.class,
                () -> TurnstileProvider.fetchSiteKey(baseUrl)
            );
            assertEquals("config_invalid_response", error.getReason());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void malformedCaptchaJsonHasInvalidResponseReason() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/config", exchange -> {
            byte[] body = "not-json".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            CaptchaUnavailableException error = assertThrows(
                CaptchaUnavailableException.class,
                () -> TurnstileProvider.fetchSiteKey(baseUrl)
            );
            assertEquals("config_invalid_response", error.getReason());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void accountUpgradeFailsClosedWithoutDurableStorage() {
        TokenManager manager = new TokenManager(new MemoryTokenStorage());
        IllegalStateException error = assertThrows(
            IllegalStateException.class,
            manager::requireDurableStorageForAccountUpgrade
        );
        assertEquals(true, error.getMessage().contains("DurableTokenStorage"));
    }

    @Test
    void incompleteStoredPairIsNeverExposed() {
        DurableTokenStorage storage = new DurableTokenStorage() {
            @Override public TokenPair getTokens() {
                return new TokenPair("", "refresh-only");
            }
            @Override public void saveTokens(TokenPair pair) {}
            @Override public void clearTokens() {}
        };

        InvalidTokenPairException error = assertThrows(
            InvalidTokenPairException.class,
            () -> new TokenManager(storage)
        );
        assertEquals("restore", error.getOperation());
    }

    @Test
    void authenticatedHttpNeverSwallowsRefreshPersistenceFailure() {
        FailingStorage storage = new FailingStorage();
        TokenManager manager = new TokenManager(storage);
        manager.setTokens(new TokenPair(
            "header.eyJleHAiOjB9.signature",
            "anonymous-refresh"));
        manager.setRefreshCallback(refresh ->
            new TokenPair("replacement-access", "replacement-refresh"));
        storage.failWrites = true;
        AtomicInteger networkRequests = new AtomicInteger();
        OkHttpClient transport = new OkHttpClient.Builder()
            .addInterceptor(chain -> {
                networkRequests.incrementAndGet();
                throw new AssertionError("network must not run after persistence failure");
            })
            .build();
        dev.edgebase.sdk.core.TokenManager coreTokens = new dev.edgebase.sdk.core.TokenManager() {
            @Override public String getAccessToken() { return manager.getAccessToken(); }
            @Override public String getRefreshToken() { return manager.getRefreshToken(); }
            @Override public void setTokens(String access, String refresh) {
                manager.setTokens(new TokenPair(access, refresh));
            }
            @Override public void clearTokens() { manager.clearTokens(); }
        };
        HttpClient http = new HttpClient(
            "https://api.example.test",
            coreTokens,
            new ContextManager(),
            null,
            null,
            transport);

        TokenPersistenceException error = assertThrows(
            TokenPersistenceException.class,
            () -> http.get("/protected")
        );

        assertEquals("save", error.getOperation());
        assertEquals(0, networkRequests.get());
        http.close();
    }

    private static final class FailingStorage implements DurableTokenStorage {
        private TokenPair tokens;
        private boolean failWrites;

        @Override
        public TokenPair getTokens() {
            return tokens;
        }

        @Override
        public void saveTokens(TokenPair pair) {
            if (failWrites) throw new IllegalStateException("synthetic persistence failure");
            tokens = pair;
        }

        @Override
        public void clearTokens() {
            tokens = null;
        }
    }
}
