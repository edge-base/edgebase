<?php

declare(strict_types=1);

namespace EdgeBase\Admin;

use EdgeBase\Core\HttpClient;
use EdgeBase\Core\StorageClient;
use EdgeBase\Core\DbRef;
use EdgeBase\Core\Generated\GeneratedDbApi;
use EdgeBase\Core\Generated\GeneratedAdminApi;

/**
 * AdminClient — EdgeBase PHP SDK main entry point.
 *
 * Admin-only: authenticated with a Service Key.
 * Exposes: db, adminAuth, storage, sql, broadcast, kv, d1, vector, push, functions, analytics.
 *
 * Usage:
 *   $admin = new AdminClient('https://your-project.edgebase.fun', getenv('EDGEBASE_SERVICE_KEY'));
 *
 *   // Database CRUD (#133)
 *   $result = $admin->db('shared')->table('posts')
 *       ->where('status', '==', 'published')
 *       ->orderBy('createdAt', 'desc')
 *       ->limit(20)
 *       ->get();
 *
 *   // Dynamic namespace
 *   $result = $admin->db('workspace', 'ws-456')->table('docs')->get();
 *
 *   // Admin Auth
 *   $user = $admin->adminAuth->createUser(['email' => 'a@b.com', 'password' => 'secure']);
 *
 *   // Raw SQL
 *   $rows = $admin->sql('posts', 'SELECT id, title FROM posts WHERE published = ?', [1]);
 *
 *   // Server-side Broadcast
 *   $admin->broadcast('notifications', 'alert', ['message' => 'System maintenance in 5 min']);
 *
 *   // Storage
 *   $url = $admin->storage->bucket('avatars')->getUrl('profile.png');
 */
class AdminClient
{
    public readonly AdminAuthClient $adminAuth;
    public readonly StorageClient $storage;

    private HttpClient $http;
    private GeneratedDbApi $core;
    private GeneratedAdminApi $adminCore;

    public function __construct(string $url, string $serviceKey = '')
    {
        $this->http = new HttpClient($url, $serviceKey);
        $this->core = new GeneratedDbApi($this->http);
        $this->adminCore = new GeneratedAdminApi($this->http);
        $this->adminAuth = new AdminAuthClient($this->http);
        $this->storage = new StorageClient($this->http);
    }

    // ─── Database (#133) ───

    /**
     * Get a DbRef for the named namespace and optional instance ID.
     *
     * Service Key bypasses access rules.
     *
     *   $result = $admin->db('shared')->table('posts')->get();
     *   $result = $admin->db('workspace', 'ws-456')->table('docs')->get();
     */
    public function db(string $namespace, ?string $instanceId = null): DbRef
    {
        return new DbRef($this->core, $namespace, $instanceId);
    }

    // ─── Raw SQL ───

    /**
     * Execute raw SQL on a DB table's Durable Object.
     *
     * @param string      $namespace DB namespace ('shared' | 'workspace' | ...)
     * @param string|null $id        DB instance ID for dynamic DOs. Null for static DBs.
     * @param string      $query     SQL query (use ? for bind params)
     * @param mixed[]     $params    Bind parameters
     * @return array<int, array<string, mixed>>
     *
     *   $rows = $admin->sql('shared', null,
     *       'SELECT id, title FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10',
     *       ['published']
     *   );
     */
    public function sql(string $namespace, ?string $id, string $query, array $params = []): array
    {
        if (trim($query) === '') {
            throw new \InvalidArgumentException('Invalid sql() signature: query must be a non-empty string');
        }
        $body = [
            'namespace' => $namespace,
            'sql' => $query,
            'params' => $params,
        ];
        if ($id !== null) {
            $body['id'] = $id;
        }
        $result = $this->adminCore->execute_sql($body);
        if (is_array($result) && isset($result['rows']) && is_array($result['rows'])) {
            /** @var array<int, array<string, mixed>> */
            return $result['rows'];
        }
        if (is_array($result) && isset($result['items']) && is_array($result['items'])) {
            /** @var array<int, array<string, mixed>> */
            return $result['items'];
        }
        if (is_array($result) && isset($result['results']) && is_array($result['results'])) {
            /** @var array<int, array<string, mixed>> */
            return $result['results'];
        }
        /** @var array<int, array<string, mixed>> */
        return is_array($result) ? $result : [];
    }

    // ─── Broadcast ───

    /**
     * Send a database-live broadcast from the admin.
     *
     * Service Key bypasses channel access rules (#75).
     * All clients subscribed to $channel receive $event with $payload.
     *
     * @param array<string, mixed> $payload
     *
     *   $admin->broadcast('notifications', 'alert', ['message' => 'Maintenance in 5 min']);
     */
    public function broadcast(string $channel, string $event, array $payload = []): void
    {
        $this->adminCore->database_live_broadcast([
            'channel' => $channel,
            'event' => $event,
            'payload' => (object) $payload,
        ]);
    }

    // ─── KV / D1 / Vectorize / Push / Cleanup ───

    /** Access a user-defined KV namespace. */
    public function kv(string $namespace): KvClient
    {
        return new KvClient($this->http, $namespace);
    }

    /** Access a user-defined D1 database. */
    public function d1(string $database): D1Client
    {
        return new D1Client($this->http, $database);
    }

    /** Access a user-defined Vectorize index. */
    public function vector(string $index): VectorizeClient
    {
        return new VectorizeClient($this->http, $index);
    }

    /** Push notification management. */
    public function push(): PushClient
    {
        return new PushClient($this->http);
    }

    /** Call app functions with the admin service key. */
    public function functions(): FunctionsClient
    {
        return new FunctionsClient($this->http);
    }

    /** Query analytics metrics and track custom events. */
    public function analytics(): AnalyticsClient
    {
        return new AnalyticsClient($this->core, $this->adminCore);
    }

    // ─── Cleanup ───

    /** No-op for PHP (stateless HTTP client). */
    public function destroy(): void
    {
    }
}
