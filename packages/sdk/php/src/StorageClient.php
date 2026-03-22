<?php

declare(strict_types=1);

namespace EdgeBase;

final class StorageClient
{
    public function __construct(private readonly \EdgeBase\Core\StorageClient $inner)
    {
    }

    public function bucket(string $name): StorageBucket
    {
        return new StorageBucket($this->inner->bucket($name));
    }
}

final class StorageBucket
{
    public function __construct(private readonly \EdgeBase\Core\StorageBucket $inner)
    {
    }

    public function getUrl(string $path): string
    {
        return $this->inner->getUrl($path);
    }

    public function upload(string $path, string $data, string $contentType = 'application/octet-stream'): array
    {
        return $this->inner->upload($path, $data, $contentType);
    }

    public function download(string $path): string
    {
        return $this->inner->download($path);
    }

    public function getMetadata(string $path): array
    {
        return $this->inner->getMetadata($path);
    }

    public function updateMetadata(string $path, array $metadata): array
    {
        return $this->inner->updateMetadata($path, $metadata);
    }

    public function createSignedUrl(string $path, string $expiresIn = '1h'): array
    {
        return $this->inner->createSignedUrl($path, $expiresIn);
    }

    public function createSignedUploadUrl(string $path, int $expiresIn = 3600): array
    {
        return $this->inner->createSignedUploadUrl($path, $expiresIn);
    }

    public function delete(string $path): array
    {
        return $this->inner->delete($path);
    }

    public function list(string $prefix = '', int $limit = 100, int $offset = 0): array
    {
        return $this->inner->list($prefix, $limit, $offset);
    }

    public function initiateResumableUpload(string $path, string $contentType = ''): string
    {
        return $this->inner->initiateResumableUpload($path, $contentType);
    }

    public function resumeUpload(
        string $path,
        string $uploadId,
        string $chunk,
        array|int $offsetOrOptions = 0,
        bool $isLastChunk = false,
    ): ?array {
        if (is_array($offsetOrOptions)) {
            $offset = (int) ($offsetOrOptions['offset'] ?? 0);
            $isLastChunk = (bool) ($offsetOrOptions['isLastChunk'] ?? false);
        } else {
            $offset = $offsetOrOptions;
        }

        return $this->inner->resumeUpload($path, $uploadId, $chunk, (int) $offset, $isLastChunk);
    }
}
