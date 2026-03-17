package dev.edgebase.sdk.core;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class HttpClientJsonContractTest {

    @Test
    void successful_plain_text_response_throws_parse_failure() throws Exception {
        withServer(200, "text/plain", "plain-text", (baseUrl) -> {
            HttpClient client = new HttpClient(baseUrl, noopTokenManager(), new ContextManager());

            IllegalStateException error = assertThrows(IllegalStateException.class, () -> client.get("/plain-text"));
            assertEquals("Invalid JSON response body", error.getMessage());
        });
    }

    @Test
    void successful_malformed_json_response_throws_parse_failure() throws Exception {
        withServer(200, "application/json", "{\"broken\":", (baseUrl) -> {
            HttpClient client = new HttpClient(baseUrl, noopTokenManager(), new ContextManager());

            IllegalStateException error = assertThrows(IllegalStateException.class, () -> client.get("/broken-json"));
            assertEquals("Invalid JSON response body", error.getMessage());
        });
    }

    private static TokenManager noopTokenManager() {
        return new TokenManager() {
            @Override
            public String getAccessToken() {
                return null;
            }

            @Override
            public String getRefreshToken() {
                return null;
            }

            @Override
            public void setTokens(String access, String refresh) {
            }

            @Override
            public void clearTokens() {
            }
        };
    }

    private interface ThrowingConsumer<T> {
        void accept(T value) throws Exception;
    }

    private static void withServer(int status, String contentType, String body, ThrowingConsumer<String> consumer) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.setExecutor(Executors.newSingleThreadExecutor());
        server.createContext("/", (exchange) -> writeResponse(exchange, status, contentType, body));
        server.start();
        try {
            consumer.accept("http://127.0.0.1:" + server.getAddress().getPort());
        } finally {
            server.stop(0);
        }
    }

    private static void writeResponse(HttpExchange exchange, int status, String contentType, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }
}
