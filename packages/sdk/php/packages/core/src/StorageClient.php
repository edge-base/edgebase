<?php

declare(strict_types=1);

namespace EdgeBase\Core;

/**
 * StorageClient — top-level storage entry point.
 * Returns StorageBucket for bucket-scoped operations.
 *
 * Usage:
 *   $bucket = $client->storage->bucket('avatars');
 *   $url    = $bucket->getUrl('profile.png');
 */
class StorageClient
{
    public function __construct(private HttpClient $client)
    {
    }

    public function bucket(string $name): StorageBucket
    {
        return new StorageBucket($this->client, $name);
    }
}

/**
 * StorageBucket — bucket-level file operations.
 *
 * Usage:
 *   $bucket->upload('photo.png', $data, 'image/png');
 *   $bytes  = $bucket->download('photo.png');
 *   $url    = $bucket->getUrl('photo.png');
 *   $signed = $bucket->createSignedUrl('photo.png', '1h');
 *   $files  = $bucket->list();
 *   $bucket->delete('photo.png');
 */
class StorageBucket
{
    public function __construct(
        private HttpClient $client,
        public readonly string $name,
    ) {
    }

    // ─── URL ───

    /** Returns the public URL of a file (no network call). */
    public function getUrl(string $path): string
    {
        return $this->client->buildApiUrl('/storage/' . $this->name . '/' . rawurlencode($path));
    }

    // ─── Upload ───

    /**
     * Upload a file using multipart/form-data.
     *
     * @return array<string, mixed>
     */
    public function upload(string $path, string $data, string $contentType = 'application/octet-stream'): array
    {
        /** @var array<string, mixed> */
        return $this->client->postMultipart(
            "/storage/{$this->name}/upload",
            $path,
            $path,
            $data,
            $contentType,
        );
    }

    // ─── Download ───

    /** Download file as raw bytes (string in PHP). */
    public function download(string $path): string
    {
        return $this->client->getRaw("/storage/{$this->name}/" . rawurlencode($path));
    }

    // ─── Metadata ───

    /**
     * Get file metadata.
     * @return array<string, mixed>
     */
    public function getMetadata(string $path): array
    {
        /** @var array<string, mixed> */
        return $this->client->get("/storage/{$this->name}/" . rawurlencode($path) . '/metadata');
    }

    /**
     * Update file metadata.
     * @param array<string, mixed> $metadata
     * @return array<string, mixed>
     */
    public function updateMetadata(string $path, array $metadata): array
    {
        /** @var array<string, mixed> */
        return $this->client->patch("/storage/{$this->name}/" . rawurlencode($path) . '/metadata', $metadata);
    }

    // ─── Signed URLs ───

    /**
     * Create a pre-signed URL for temporary access.
     *
     * @return array{url: string, expiresIn: string}
     */
    public function createSignedUrl(string $path, string $expiresIn = '1h'): array
    {
        /** @var array{url: string, expiresIn: string} */
        return $this->client->post("/storage/{$this->name}/signed-url", [
            'key' => $path,
            'expiresIn' => $expiresIn,
        ]);
    }

    /**
     * Create a pre-signed upload URL.
     *
     * @return array{url: string, expiresIn: string}
     */
    public function createSignedUploadUrl(string $path, int $expiresIn = 3600): array
    {
        /** @var array{url: string, expiresIn: string} */
        return $this->client->post("/storage/{$this->name}/signed-upload-url", [
            'key' => $path,
            'expiresIn' => "{$expiresIn}s",
        ]);
    }

    // ─── Management ───

    /**
     * Delete a file.
     * @return array<string, mixed>
     */
    public function delete(string $path): array
    {
        /** @var array<string, mixed> $result */
        $result = $this->client->delete("/storage/{$this->name}/" . rawurlencode($path));
        return is_array($result) ? $result : [];
    }

    /**
     * List files in the bucket.
     *
     * @return array<int, array<string, mixed>>
     */
    public function list(string $prefix = '', int $limit = 100, int $offset = 0): array
    {
        $params = ['limit' => (string) $limit, 'offset' => (string) $offset];
        if ($prefix !== '') {
            $params['prefix'] = $prefix;
        }
        /** @var array<string, mixed> $data */
        $data = $this->client->get("/storage/{$this->name}", $params);
        if (!is_array($data)) {
            return [];
        }
        // Server returns 'files' or 'items'
        $files = $data['files'] ?? $data['items'] ?? [];
        return is_array($files) ? $files : [];
    }

    // ─── Upload String ───

    /**
     * Upload a string with encoding support.
     *
     * @param string $encoding One of 'raw', 'base64', 'base64url', 'data_url'
     * @return array<string, mixed>
     */
    public function uploadString(
        string $path,
        string $data,
        string $encoding = 'raw',
        string $contentType = 'text/plain',
    ): array {
        $ct = $contentType;

        switch ($encoding) {
            case 'base64':
                $raw = base64_decode($data, true);
                if ($raw === false) {
                    throw new EdgeBaseException(400, 'Invalid base64 data');
                }
                break;
            case 'base64url':
                $b64 = strtr($data, '-_', '+/');
                $b64 .= str_repeat('=', (4 - strlen($b64) % 4) % 4);
                $raw = base64_decode($b64, true);
                if ($raw === false) {
                    throw new EdgeBaseException(400, 'Invalid base64url data');
                }
                break;
            case 'data_url':
                $comma = strpos($data, ',');
                if ($comma === false) {
                    throw new EdgeBaseException(400, 'Invalid data URL');
                }
                $header = substr($data, 0, $comma);
                $body = substr($data, $comma + 1);
                if ($ct === 'text/plain' && preg_match('/^data:([^;,]+)/', $header, $m)) {
                    $ct = $m[1];
                }
                if (str_contains($header, ';base64')) {
                    $raw = base64_decode($body, true);
                    if ($raw === false) {
                        throw new EdgeBaseException(400, 'Invalid data URL base64');
                    }
                } else {
                    $raw = rawurldecode($body);
                }
                break;
            default: // 'raw'
                $raw = $data;
                break;
        }

        return $this->upload($path, $raw, $ct);
    }

    // ─── Resumable Upload ───

    /**
     * Initiate a resumable upload. Returns the upload ID.
     */
    public function initiateResumableUpload(string $path, string $contentType = ''): string
    {
        $body = ['key' => $path];
        if ($contentType !== '') {
            $body['contentType'] = $contentType;
        }
        /** @var array<string, mixed> $data */
        $data = $this->client->post("/storage/{$this->name}/upload/resumable/init", $body);
        return (string) ($data['uploadId'] ?? '');
    }

    /**
     * Upload a chunk for a resumable upload.
     *
     * @return array<string, mixed>|null FileInfo on last chunk, null otherwise
     */
    public function resumeUpload(
        string $path,
        string $uploadId,
        string $chunk,
        int $offset,
        bool $isLastChunk = false,
    ): ?array {
        /** @var array<string, mixed>|null $result */
        $result = $this->client->postMultipart(
            "/storage/{$this->name}/upload/resumable/{$uploadId}",
            $path,
            $path,
            $chunk,
            'application/octet-stream',
        );
        return $isLastChunk && is_array($result) ? $result : null;
    }
}

