<?php

declare(strict_types=1);

namespace EdgeBase\Admin;

use EdgeBase\Core\HttpClient;
use EdgeBase\Core\Generated\GeneratedAdminApi;

/**
 * KvClient — KV namespace access for server-side use.
 *
 *   $kv = $admin->kv('cache');
 *   $kv->set('key', 'value', 300);
 *   $val = $kv->get('key');
 */
class KvClient
{
    private GeneratedAdminApi $adminCore;
    private string $namespace;

    public function __construct(HttpClient $http, string $namespace)
    {
        $this->adminCore = new GeneratedAdminApi($http);
        $this->namespace = $namespace;
    }

    /** Get a value by key. Returns null if not found. */
    public function get(string $key): ?string
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->kv_operation($this->namespace, [
            'action' => 'get',
            'key' => $key,
        ]);
        return is_array($res) ? ($res['value'] ?? null) : null;
    }

    /** Set a key-value pair with optional TTL in seconds. */
    public function set(string $key, string $value, ?int $ttl = null): void
    {
        $body = ['action' => 'set', 'key' => $key, 'value' => $value];
        if ($ttl !== null) {
            $body['ttl'] = $ttl;
        }
        $this->adminCore->kv_operation($this->namespace, $body);
    }

    /** Delete a key. */
    public function delete(string $key): void
    {
        $this->adminCore->kv_operation($this->namespace, [
            'action' => 'delete',
            'key' => $key,
        ]);
    }

    /**
     * List keys with optional prefix, limit, and cursor.
     * @return array<string, mixed>
     */
    public function list(?string $prefix = null, ?int $limit = null, ?string $cursor = null): array
    {
        $body = ['action' => 'list'];
        if ($prefix !== null)
            $body['prefix'] = $prefix;
        if ($limit !== null)
            $body['limit'] = $limit;
        if ($cursor !== null)
            $body['cursor'] = $cursor;
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->kv_operation($this->namespace, $body);
        return is_array($res) ? $res : [];
    }
}
