<?php

declare(strict_types=1);

namespace EdgeBase\Core;

/**
 * HttpClient — curl-based HTTP client for the EdgeBase PHP SDK.
 *
 * Handles:
 * - URL building (path → baseUrl + /api prefix logic)
 * - Service Key header injection (X-EdgeBase-Service-Key)
 * - Legacy context state for compatibility (not serialized into HTTP headers)
 * - JSON request/response encoding
 * - Multipart file uploads
 * - Raw byte downloads
 * - Error parsing (EdgeBaseException on 4xx/5xx)
 *
 * — PHP is server-only, so no token refresh logic.
 */
class HttpClient
{
    private ?array $ctx = null;
    private int $timeoutMs;

    public function __construct(
        private string $baseUrl,
        private string $serviceKey = '',
    ) {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->timeoutMs = self::resolveTimeoutMs();
    }

    // ─── Context ───

    public function setContext(?array $ctx): void
    {
        $this->ctx = $ctx;
    }

    public function getContext(): ?array
    {
        return $this->ctx;
    }

    // ─── HTTP verbs ───

    /** @return mixed */
    public function get(string $path, array $queryParams = []): mixed
    {
        return $this->request('GET', $path, queryParams: $queryParams);
    }

    /** @return mixed */
    public function post(string $path, mixed $body = null): mixed
    {
        return $this->request('POST', $path, body: $body);
    }

    /** POST with both body and query parameters. */
    public function postWithQuery(string $path, mixed $body = null, array $queryParams = []): mixed
    {
        return $this->request('POST', $path, queryParams: $queryParams, body: $body);
    }

    /** @return mixed */
    public function patch(string $path, mixed $body = null): mixed
    {
        return $this->request('PATCH', $path, body: $body);
    }

    /** @return mixed */
    public function put(string $path, mixed $body = null): mixed
    {
        return $this->request('PUT', $path, body: $body);
    }

    /** PUT with both body and query parameters. */
    public function putWithQuery(string $path, mixed $body = null, array $queryParams = []): mixed
    {
        return $this->request('PUT', $path, queryParams: $queryParams, body: $body);
    }

    /** @return mixed */
    public function delete(string $path): mixed
    {
        return $this->request('DELETE', $path);
    }

    /** HEAD request — returns true if resource exists (2xx). */
    public function head(string $path): bool
    {
        $fullUrl = $this->buildURL($path);
        $ch = curl_init($fullUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_NOBODY => true,
            CURLOPT_HTTPHEADER => $this->authHeaders(false),
        ] + $this->curlTimeoutOptions());

        curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

        return $status >= 200 && $status < 300;
    }

    /**
     * POST multipart/form-data (for file uploads).
     *
     * @param array<string, string> $extraFields
     * @return mixed
     */
    public function postMultipart(
        string $path,
        string $fileKey,
        string $fileName,
        string $data,
        string $contentType,
        array $extraFields = [],
    ): mixed {
        $fullUrl = $this->buildURL($path);

        $boundary = '----JBBoundary' . bin2hex(random_bytes(8));
        $body = '';
        // File part
        $body .= "--{$boundary}\r\n";
        $body .= "Content-Disposition: form-data; name=\"file\"; filename=\"{$fileName}\"\r\n";
        $body .= "Content-Type: {$contentType}\r\n\r\n";
        $body .= $data . "\r\n";
        // Key field
        $body .= "--{$boundary}\r\n";
        $body .= "Content-Disposition: form-data; name=\"key\"\r\n\r\n";
        $body .= $fileKey . "\r\n";
        // Extra fields
        foreach ($extraFields as $k => $v) {
            $body .= "--{$boundary}\r\n";
            $body .= "Content-Disposition: form-data; name=\"{$k}\"\r\n\r\n";
            $body .= $v . "\r\n";
        }
        $body .= "--{$boundary}--\r\n";

        $headers = $this->authHeaders(false);
        $headers[] = "Content-Type: multipart/form-data; boundary={$boundary}";

        $ch = curl_init($fullUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
        ] + $this->curlTimeoutOptions());

        return $this->executeCurl($ch, $path);
    }

    /**
     * GET raw bytes (for file downloads).
     */
    public function getRaw(string $path): string
    {
        $fullUrl = $this->buildURL($path);
        $ch = curl_init($fullUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $this->authHeaders(false),
        ] + $this->curlTimeoutOptions());

        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        // curl_close() deprecated in PHP 8.5 (CurlHandle freed by GC)

        if ($raw === false) {
            throw new EdgeBaseException("curl error: getRaw {$path}");
        }
        if ($status >= 400) {
            throw new EdgeBaseException("HTTP {$status}: download failed", $status);
        }
        return (string) $raw;
    }

    // ─── Public URL helper ───

    /**
     * Build an absolute public URL (used by StorageBucket::getUrl).
     * Unlike buildURL(), this does NOT add an /api prefix — path is used as-is.
     */
    public function buildPublicUrl(string $path): string
    {
        return $this->baseUrl . $path;
    }

    /**
     * Build an absolute API URL (public). Same as buildURL but exposed
     * for cases like StorageBucket::getUrl() that construct public-facing URLs.
     */
    public function buildApiUrl(string $path): string
    {
        return $this->buildURL($path);
    }

    // ─── Internal ───

    /**
     * Build an absolute URL from a relative path.
     *  - Path already starting with "/api/" → baseUrl + path
     *  - Otherwise → baseUrl + "/api" + path
     */
    private function buildURL(string $path): string
    {
        if (str_starts_with($path, '/api/')) {
            return $this->baseUrl . $path;
        }
        return $this->baseUrl . '/api' . $path;
    }

    /** @return mixed */
    private function request(
        string $method,
        string $path,
        array $queryParams = [],
        mixed $body = null,
    ): mixed {
        $fullUrl = $this->buildURL($path);
        if (!empty($queryParams)) {
            $fullUrl .= '?' . http_build_query($queryParams);
        }

        $jsonBody = null;
        if ($body !== null) {
            $jsonBody = json_encode($body, JSON_THROW_ON_ERROR);
        } elseif (in_array($method, ['POST', 'PATCH', 'PUT'], true)) {
            $jsonBody = '{}';
        }

        $attempts = in_array($method, ['GET', 'DELETE'], true) ? 3 : 1;
        $lastError = null;

        for ($attempt = 0; $attempt < $attempts; $attempt++) {
            $ch = curl_init($fullUrl);
            $opts = [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CUSTOMREQUEST => $method,
                CURLOPT_HTTPHEADER => $this->authHeaders(true),
            ] + $this->curlTimeoutOptions();
            if ($jsonBody !== null) {
                $opts[CURLOPT_POSTFIELDS] = $jsonBody;
            }
            curl_setopt_array($ch, $opts);

            try {
                return $this->executeCurl($ch, $path);
            } catch (EdgeBaseException $error) {
                $lastError = $error;
                if ($attempt + 1 >= $attempts || !$this->isTransientTransportError($error)) {
                    throw $error;
                }
                usleep(250_000 * ($attempt + 1));
            }
        }

        throw $lastError ?? new EdgeBaseException("curl error on {$path}: exhausted retries");
    }

    /** @return mixed */
    private function executeCurl(\CurlHandle $ch, string $path): mixed
    {
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        // curl_close() deprecated in PHP 8.5 (CurlHandle freed by GC)

        if ($raw === false) {
            $error = curl_error($ch);
            $code = curl_errno($ch);
            $message = $error !== '' ? $error : 'Unknown curl error';
            throw new EdgeBaseException("curl error on {$path} ({$code}): {$message}");
        }

        $raw = (string) $raw;

        if ($status >= 400) {
            $decoded = null;
            if ($raw !== '') {
                try {
                    $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    $decoded = null;
                }
            }
            $message = (is_array($decoded) && isset($decoded['message']))
                ? (string) $decoded['message']
                : "HTTP {$status}";
            throw new EdgeBaseException("EdgeBase: {$path} → {$status}: {$message}", $status);
        }
        if ($raw === '') {
            return null;
        }
        try {
            return json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new EdgeBaseException('Expected a JSON response but received malformed JSON.', $status);
        }
    }

    /**
     * @param bool $includeContentType Whether to add Content-Type: application/json
     * @return string[]
     */
    private function authHeaders(bool $includeContentType): array
    {
        $headers = [];
        if ($includeContentType) {
            $headers[] = 'Content-Type: application/json';
        }
        $headers[] = 'Connection: close';
        if ($this->serviceKey !== '') {
            $headers[] = 'X-EdgeBase-Service-Key: ' . $this->serviceKey;
            // Authorization: Bearer — admin endpoint auth (server auth.ts uses this)
            $headers[] = 'Authorization: Bearer ' . $this->serviceKey;
        }
        return $headers;
    }

    /**
     * @return array<int, bool|int>
     */
    private function curlTimeoutOptions(): array
    {
        $options = [
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        ];
        if ($this->timeoutMs <= 0) {
            return $options;
        }
        return $options + [
            CURLOPT_CONNECTTIMEOUT_MS => $this->timeoutMs,
            CURLOPT_TIMEOUT_MS => $this->timeoutMs,
        ];
    }

    private static function resolveTimeoutMs(): int
    {
        $raw = trim((string) getenv('EDGEBASE_HTTP_TIMEOUT_MS'));
        if ($raw === '' || !ctype_digit($raw)) {
            return 0;
        }
        $timeoutMs = (int) $raw;
        return $timeoutMs > 0 ? $timeoutMs : 0;
    }

    private function isTransientTransportError(EdgeBaseException $error): bool
    {
        $message = strtolower($error->getMessage());
        if (!str_contains($message, 'curl error')) {
            return false;
        }

        foreach ([
            'tls connect error',
            'unexpected eof',
            'read timeout',
            'timed out',
            'connection reset',
            'ssl',
        ] as $needle) {
            if (str_contains($message, $needle)) {
                return true;
            }
        }

        return false;
    }
}
