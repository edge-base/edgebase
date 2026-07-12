package dev.edgebase.sdk.client;

import dev.edgebase.sdk.core.EdgeBaseError;
import dev.edgebase.sdk.core.HttpClient;

import java.util.Collections;
import java.util.Map;

public class FunctionsClient {
    public static class FunctionCallOptions {
        public final String method;
        public final Map<String, ?> body;
        public final Map<String, String> query;
        public final String captchaToken;

        public FunctionCallOptions() {
            this("POST", Collections.emptyMap(), null, null);
        }

        public FunctionCallOptions(String method, Map<String, ?> body, Map<String, String> query) {
            this(method, body, query, null);
        }

        public FunctionCallOptions(String method, Map<String, ?> body, Map<String, String> query,
                String captchaToken) {
            this.method = method != null ? method : "POST";
            this.body = body != null ? body : Collections.emptyMap();
            this.query = query;
            this.captchaToken = captchaToken;
        }
    }

    private final HttpClient httpClient;

    public FunctionsClient(HttpClient httpClient) {
        this.httpClient = httpClient;
    }

    public Object call(String path) throws EdgeBaseError {
        return call(path, new FunctionCallOptions());
    }

    public Object call(String path, FunctionCallOptions options) throws EdgeBaseError {
        String normalizedPath = "/functions/" + path;
        String method = options != null ? options.method.toUpperCase() : "POST";
        Map<String, ?> body = options != null && options.body != null ? options.body : Collections.emptyMap();
        Map<String, String> query = options != null ? options.query : null;
        String captchaToken = options != null ? options.captchaToken : null;
        if (captchaToken != null && (captchaToken.isEmpty() || captchaToken.length() > 2048)) {
            throw new IllegalArgumentException("captchaToken must be non-empty and at most 2048 characters");
        }

        switch (method) {
            case "GET":
                return httpClient.get(normalizedPath, query, captchaToken);
            case "PUT":
                return httpClient.put(normalizedPath, body, captchaToken);
            case "PATCH":
                return httpClient.patch(normalizedPath, body, captchaToken);
            case "DELETE":
                return captchaToken == null
                        ? httpClient.delete(normalizedPath)
                        : httpClient.deleteWithCaptchaToken(normalizedPath, captchaToken);
            case "POST":
            default:
                return httpClient.post(normalizedPath, body, captchaToken);
        }
    }

    public Object get(String path) throws EdgeBaseError {
        return get(path, null);
    }

    public Object get(String path, Map<String, String> query) throws EdgeBaseError {
        return call(path, new FunctionCallOptions("GET", null, query));
    }

    public Object post(String path) throws EdgeBaseError {
        return post(path, Collections.emptyMap());
    }

    public Object post(String path, Map<String, ?> body) throws EdgeBaseError {
        return call(path, new FunctionCallOptions("POST", body, null));
    }

    public Object put(String path, Map<String, ?> body) throws EdgeBaseError {
        return call(path, new FunctionCallOptions("PUT", body, null));
    }

    public Object patch(String path, Map<String, ?> body) throws EdgeBaseError {
        return call(path, new FunctionCallOptions("PATCH", body, null));
    }

    public Object delete(String path) throws EdgeBaseError {
        return call(path, new FunctionCallOptions("DELETE", null, null));
    }
}
