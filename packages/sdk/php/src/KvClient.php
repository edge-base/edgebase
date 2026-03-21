<?php

declare(strict_types=1);

namespace EdgeBase;

final class KvClient
{
    public function __construct(private readonly \EdgeBase\Admin\KvClient $inner)
    {
    }

    public function get(string $key): ?string
    {
        return $this->inner->get($key);
    }

    public function set(string $key, string $value, ?int $ttl = null): void
    {
        $this->inner->set($key, $value, $ttl);
    }

    public function delete(string $key): void
    {
        $this->inner->delete($key);
    }

    public function list(?string $prefix = null, ?int $limit = null, ?string $cursor = null): array
    {
        return $this->inner->list($prefix, $limit, $cursor);
    }
}
