// EdgeBase Java SDK — HTTP client.
// OkHttp-based HTTP client with automatic authentication,
// 401 retry, request metadata, and multipart uploads.
package dev.edgebase.sdk.core;

import com.google.gson.Gson;
import okhttp3.*;
import okhttp3.MediaType;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;

/**
 * HTTP client for EdgeBase API communication.
 *
 * <p>
 * Features:
 * <ul>
 * <li>Automatic Bearer token injection</li>
 * <li>401 response → token refresh → automatic retry</li>
 * <li>Project metadata headers</li>
 * <li>Multipart file uploads</li>
 * <li>Public endpoints (no auth required)</li>
 * </ul>
 */
public class HttpClient {
    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");
    private static final Gson gson = new Gson();

    public final String baseUrl;
    private final TokenManager tokenManager;
    private final String serviceKey;
    private final String projectId;
    private final OkHttpClient client;
    private String locale;

    public HttpClient(String baseUrl, TokenManager tokenManager, ContextManager contextManager) {
        this(baseUrl, tokenManager, contextManager, null, null);
    }

    /**
     * Convenience constructor for service-key-only usage (e.g., E2E tests and admin
     * scripts).
     * Creates no-op TokenManager and ContextManager internally.
     */
    public HttpClient(String baseUrl, String serviceKey) {
        this(baseUrl, new TokenManager() {
            @Override
            public String getAccessToken() {
                return null;
            }

            @Override
            public String getRefreshToken() {
                return null;
            }

            @Override
            public void setTokens(String a, String r) {
            }

            @Override
            public void clearTokens() {
            }
        }, new ContextManager(), serviceKey, null);
    }

    public HttpClient(String baseUrl, TokenManager tokenManager, ContextManager contextManager,
            String serviceKey, String projectId) {
        this.baseUrl = baseUrl;
        this.tokenManager = tokenManager;
        this.serviceKey = serviceKey;
        this.projectId = projectId;
        this.client = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(120, TimeUnit.SECONDS)
                .writeTimeout(120, TimeUnit.SECONDS)
                .build();
    }

    // ─── Public API ───

    @SuppressWarnings("unchecked")
    public Object get(String path) throws EdgeBaseError {
        return get(path, null);
    }

    @SuppressWarnings("unchecked")
    public Object get(String path, Map<String, String> queryParams) throws EdgeBaseError {
        return request("GET", path, null, false, false, queryParams, 0);
    }

    public Object post(String path, Map<String, ?> body) throws EdgeBaseError {
        return request("POST", path, body, false, false, null, 0);
    }

    public Object patch(String path, Map<String, ?> body) throws EdgeBaseError {
        return request("PATCH", path, body, false, false, null, 0);
    }

    public Object put(String path, Map<String, ?> body) throws EdgeBaseError {
        return request("PUT", path, body, false, false, null, 0);
    }

    public Object getWithQuery(String path, Map<String, String> queryParams) throws EdgeBaseError {
        return request("GET", path, null, false, false, queryParams, 0);
    }

    public Object postWithQuery(String path, Map<String, ?> body, Map<String, String> queryParams) throws EdgeBaseError {
        return request("POST", path, body, false, false, queryParams, 0);
    }

    public Object putWithQuery(String path, Map<String, ?> body, Map<String, String> queryParams) throws EdgeBaseError {
        return request("PUT", path, body, false, false, queryParams, 0);
    }

    public Object delete(String path) throws EdgeBaseError {
        return request("DELETE", path, null, false, false, null, 0);
    }

    public Object delete(String path, Map<String, ?> body) throws EdgeBaseError {
        return request("DELETE", path, body, false, false, null, 0);
    }

    public void close() {
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
        Cache cache = client.cache();
        if (cache != null) {
            try {
                cache.close();
            } catch (IOException ignored) {
            }
        }
    }

    /** HEAD request — returns true if resource exists (2xx). */
    public boolean head(String path) throws EdgeBaseError {
        try {
            String url = buildUrl(path, null);
            Request.Builder requestBuilder = new Request.Builder().url(url).head();

            if (serviceKey != null) {
                requestBuilder.addHeader("X-EdgeBase-Service-Key", serviceKey);
            } else {
                try {
                    String token = tokenManager.getAccessToken();
                    if (token != null)
                        requestBuilder.addHeader("Authorization", "Bearer " + token);
                } catch (Exception ignored) {
                    // Token refresh failed — proceed as unauthenticated
                }
            }
            addRequestMetadataHeaders(requestBuilder);

            try (Response response = client.newCall(requestBuilder.build()).execute()) {
                return response.isSuccessful();
            }
        } catch (IOException e) {
            throw new EdgeBaseError(0, "HEAD request failed: " + e.getMessage());
        }
    }

    /**
     * POST to public endpoint (no authentication).
     */
    public Object postPublic(String path) throws EdgeBaseError {
        return request("POST", path, Collections.emptyMap(), true, false, null, 0);
    }

    public Object postPublic(String path, Map<String, ?> body) throws EdgeBaseError {
        return request("POST", path, body, true, false, null, 0);
    }

    /**
     * POST raw bytes with optional query params.
     */
    @SuppressWarnings("unchecked")
    public Object postBytes(String path, byte[] data, String contentType, Map<String, String> queryParams) throws EdgeBaseError {
        try {
            String url = buildUrl(path, queryParams);
            RequestBody body = RequestBody.create(data, MediaType.parse(contentType));
            Request.Builder requestBuilder = new Request.Builder().url(url).post(body);

            if (serviceKey != null) {
                requestBuilder.addHeader("X-EdgeBase-Service-Key", serviceKey);
            } else {
                try {
                    String token = tokenManager.getAccessToken();
                    if (token != null)
                        requestBuilder.addHeader("Authorization", "Bearer " + token);
                } catch (Exception ignored) {
                    // Token refresh failed — proceed as unauthenticated
                }
            }
            addRequestMetadataHeaders(requestBuilder);

            try (Response response = client.newCall(requestBuilder.build()).execute()) {
                return parseResponse(response);
            }
        } catch (EdgeBaseError e) {
            throw e;
        } catch (IOException e) {
            throw new EdgeBaseError(0, "Binary POST failed: " + e.getMessage());
        }
    }

    /**
     * Upload file data via multipart POST.
     */
    @SuppressWarnings("unchecked")
    public Object uploadMultipart(String path, String fileName, byte[] data,
            String contentType, Map<String, String> extraFields) throws EdgeBaseError {
        try {
            MultipartBody.Builder multipartBuilder = new MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart("file", fileName,
                            RequestBody.create(data, MediaType.parse(contentType)));

            if (extraFields != null) {
                for (Map.Entry<String, String> entry : extraFields.entrySet()) {
                    multipartBuilder.addFormDataPart(entry.getKey(), entry.getValue());
                }
            }

            String url = buildUrl(path, null);
            Request.Builder requestBuilder = new Request.Builder().url(url).post(multipartBuilder.build());

            if (serviceKey != null) {
                requestBuilder.addHeader("X-EdgeBase-Service-Key", serviceKey);
            } else {
                try {
                    String token = tokenManager.getAccessToken();
                    if (token != null)
                        requestBuilder.addHeader("Authorization", "Bearer " + token);
                } catch (Exception ignored) {
                    // Token refresh failed — proceed as unauthenticated
                }
            }
            addRequestMetadataHeaders(requestBuilder);

            try (Response response = client.newCall(requestBuilder.build()).execute()) {
                return parseResponse(response);
            }
        } catch (EdgeBaseError e) {
            throw e;
        } catch (IOException e) {
            throw new EdgeBaseError(0, "Upload failed: " + e.getMessage());
        }
    }

    /**
     * Download raw bytes.
     */
    public byte[] downloadRaw(String path) throws EdgeBaseError {
        try {
            String url = buildUrl(path, null);
            Request.Builder requestBuilder = new Request.Builder().url(url).get();

            try {
                String token = tokenManager.getAccessToken();
                if (token != null)
                    requestBuilder.addHeader("Authorization", "Bearer " + token);
            } catch (Exception ignored) {
                // Token refresh failed — proceed as unauthenticated
            }
            addRequestMetadataHeaders(requestBuilder);

            try (Response response = client.newCall(requestBuilder.build()).execute()) {
                if (!response.isSuccessful()) {
                    throw new EdgeBaseError(response.code(), "Download failed: " + response.message());
                }
                ResponseBody body = response.body();
                return body != null ? body.bytes() : new byte[0];
            }
        } catch (EdgeBaseError e) {
            throw e;
        } catch (IOException e) {
            throw new EdgeBaseError(0, "Download failed: " + e.getMessage());
        }
    }

    /**
     * Get the full API base URL (baseUrl + API prefix).
     * Useful for constructing redirect URLs (e.g., OAuth) without hardcoding the /api/ prefix.
     */
    public String getApiBaseUrl() {
        return baseUrl + buildApiPrefix();
    }

    public void setLocale(String locale) {
        this.locale = locale;
    }

    public String getLocale() {
        return locale;
    }

    /**
     * Get underlying OkHttpClient for WebSocket connections.
     */
    public OkHttpClient getOkHttpClient() {
        return client;
    }

    /**
     * Returns a view of this client with a DB path prefix inserted before every API
     * path.
     * Used by {@link DbRef} to scope all table operations to a specific
     * namespace/instance.
     *
     * @param dbPath prefix, e.g. "/db/shared" or "/db/tenant-abc/instance-1"
     */
    public HttpClient withDbPath(String dbPath) {
        // Embed the db path into the baseUrl string so buildUrl appends
        // /api<dbPath>/<tablePath>
        // We reuse the same auth and request metadata machinery.
        return new HttpClient(this.baseUrl + "/api" + dbPath, this.tokenManager,
                new ContextManager(), this.serviceKey, this.projectId) {
            @Override
            protected String buildApiPrefix() {
                return ""; // already embedded in baseUrl
            }
        };
    }

    // ─── Internal ───

    @SuppressWarnings("unchecked")
    private Object request(String method, String path, Map<String, ?> body,
            boolean isPublic, boolean isRetry, Map<String, String> queryParams, int rateLimitAttempt) throws EdgeBaseError {
        try {
            String url = buildUrl(path, queryParams);
            RequestBody requestBody = null;
            if (body != null) {
                requestBody = RequestBody.create(gson.toJson(body), JSON_MEDIA_TYPE);
            }

            Request.Builder requestBuilder = new Request.Builder().url(url);
            switch (method) {
                case "GET":
                    requestBuilder.get();
                    break;
                case "POST":
                    requestBuilder.post(requestBody != null ? requestBody : RequestBody.create("{}", JSON_MEDIA_TYPE));
                    break;
                case "PATCH":
                    requestBuilder.patch(requestBody != null ? requestBody : RequestBody.create("{}", JSON_MEDIA_TYPE));
                    break;
                case "PUT":
                    requestBuilder.put(requestBody != null ? requestBody : RequestBody.create("{}", JSON_MEDIA_TYPE));
                    break;
                case "DELETE":
                    if (requestBody != null) {
                        requestBuilder.delete(requestBody);
                    } else {
                        requestBuilder.delete(RequestBody.create("{}", JSON_MEDIA_TYPE));
                    }
                    break;
            }

            // Add auth headers (skip for public endpoints)
            if (!isPublic) {
                if (serviceKey != null) {
                    requestBuilder.addHeader("X-EdgeBase-Service-Key", serviceKey);
                } else {
                    try {
                        String token = tokenManager.getAccessToken();
                        if (token != null)
                            requestBuilder.addHeader("Authorization", "Bearer " + token);
                    } catch (Exception ignored) {
                        // Token refresh failed — proceed as unauthenticated
                    }
                }
            }

            addRequestMetadataHeaders(requestBuilder);

            // Transport retry: independent loop (max 2 retries) around the network call
            Response response = null;
            for (int transportAttempt = 0; transportAttempt <= 2; transportAttempt++) {
                try {
                    response = client.newCall(requestBuilder.build()).execute();
                    break;
                } catch (IOException e) {
                    if (transportAttempt < 2) {
                        try { Thread.sleep(50L * (transportAttempt + 1)); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                        // Rebuild request for retry (OkHttp request can only be executed once)
                        requestBuilder = requestBuilder.build().newBuilder();
                        continue;
                    }
                    throw new EdgeBaseError(0, "Request failed: " + e.getMessage());
                }
            }

            try {
                // 429 retry with Retry-After
                if (response.code() == 429 && rateLimitAttempt < 3) {
                    long delay = parseRetryAfterDelay(response.header("Retry-After"), rateLimitAttempt);
                    response.close();
                    Thread.sleep(delay);
                    return request(method, path, body, isPublic, isRetry, queryParams, rateLimitAttempt + 1);
                }

                // Handle 401 — retry once after token refresh
                if (response.code() == 401 && !isRetry && !isPublic) {
                    response.close();
                    String refreshToken = tokenManager.getRefreshToken();
                    if (refreshToken != null) {
                        try {
                            tokenManager.getAccessToken(); // triggers refresh internally
                        } catch (Exception ignored) {
                        }
                    }
                    return request(method, path, body, isPublic, true, queryParams, rateLimitAttempt);
                }
                return parseResponse(response);
            } finally {
                response.close();
            }
        } catch (EdgeBaseError e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new EdgeBaseError(0, "Request interrupted");
        }
    }

    private static long parseRetryAfterDelay(String retryAfter, int attempt) {
        long baseDelayMs = 1000L * (1L << attempt);
        if (retryAfter != null) {
            try {
                long seconds = Long.parseLong(retryAfter);
                if (seconds > 0) baseDelayMs = seconds * 1000;
            } catch (NumberFormatException ignored) {}
        }
        long jitter = (long) (baseDelayMs * 0.25 * Math.random());
        return Math.min(baseDelayMs + jitter, 10000);
    }

    protected String buildApiPrefix() {
        return "/api";
    }

    private String buildUrl(String path, Map<String, String> queryParams) {
        StringBuilder sb = new StringBuilder(baseUrl).append(buildApiPrefix()).append(path);
        if (queryParams != null && !queryParams.isEmpty()) {
            sb.append("?");
            boolean first = true;
            for (Map.Entry<String, String> entry : queryParams.entrySet()) {
                if (!first)
                    sb.append("&");
                sb.append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8))
                        .append("=")
                        .append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
                first = false;
            }
        }
        return sb.toString();
    }

    private void addRequestMetadataHeaders(Request.Builder builder) {
        if (projectId != null) {
            builder.addHeader("X-EdgeBase-Project-Id", projectId);
        }
        if (locale != null && !locale.isEmpty()) {
            builder.addHeader("Accept-Language", locale);
        }
    }

    @SuppressWarnings("unchecked")
    private Object parseResponse(Response response) throws EdgeBaseError {
        String bodyStr;
        try {
            ResponseBody body = response.body();
            bodyStr = body != null ? body.string() : "";
        } catch (IOException e) {
            bodyStr = "";
        }

        if (!response.isSuccessful()) {
            try {
                Map<String, Object> parsed = gson.fromJson(bodyStr, Map.class);
                if (parsed != null) {
                    throw EdgeBaseError.fromJson(parsed, response.code());
                }
            } catch (EdgeBaseError e) {
                throw e;
            } catch (Exception ignored) {
            }
            throw new EdgeBaseError(response.code(), bodyStr.isEmpty() ? response.message() : bodyStr);
        }

        if (bodyStr.isEmpty())
            return null;

        String contentType = response.header("Content-Type");
        if (!isLikelyJsonResponse(bodyStr, contentType)) {
            throw new IllegalStateException("Invalid JSON response body");
        }

        try {
            return gson.fromJson(bodyStr, Object.class);
        } catch (Exception e) {
            throw new IllegalStateException("Invalid JSON response body", e);
        }
    }

    private boolean isLikelyJsonResponse(String bodyStr, String contentType) {
        if (contentType != null) {
            String normalized = contentType.toLowerCase(Locale.ROOT);
            if (normalized.contains("/json") || normalized.contains("+json")) {
                return true;
            }
        }

        String trimmed = bodyStr.trim();
        if (trimmed.isEmpty()) {
            return false;
        }
        if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("\"") || trimmed.startsWith("-")) {
            return true;
        }
        if (Character.isDigit(trimmed.charAt(0))) {
            return true;
        }
        return trimmed.startsWith("true") || trimmed.startsWith("false") || trimmed.startsWith("null");
    }
}
