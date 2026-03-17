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

        public FunctionCallOptions() {
            this("POST", Collections.emptyMap(), null);
        }

        public FunctionCallOptions(String method, Map<String, ?> body, Map<String, String> query) {
            this.method = method != null ? method : "POST";
            this.body = body != null ? body : Collections.emptyMap();
            this.query = query;
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

        switch (method) {
            case "GET":
                return httpClient.get(normalizedPath, query);
            case "PUT":
                return httpClient.put(normalizedPath, body);
            case "PATCH":
                return httpClient.patch(normalizedPath, body);
            case "DELETE":
                return httpClient.delete(normalizedPath);
            case "POST":
            default:
                return httpClient.post(normalizedPath, body);
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
