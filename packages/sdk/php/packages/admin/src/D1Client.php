<?php

declare(strict_types=1);

namespace EdgeBase\Admin;

use EdgeBase\Core\HttpClient;
use EdgeBase\Core\Generated\GeneratedAdminApi;

/**
 * D1Client — D1 database access for server-side use.
 *
 *   $rows = $admin->d1('analytics')->exec('SELECT * FROM events WHERE type = ?', ['click']);
 */
class D1Client
{
    private GeneratedAdminApi $adminCore;
    private string $database;

    public function __construct(HttpClient $http, string $database)
    {
        $this->adminCore = new GeneratedAdminApi($http);
        $this->database = $database;
    }

    /**
     * Execute a SQL query. Use ? placeholders for bind parameters.
     * All SQL is allowed (DDL included).
     *
     * @param mixed[] $params Bind parameters
     * @return array<int, array<string, mixed>>
     */
    public function exec(string $query, array $params = []): array
    {
        $body = ['query' => $query];
        if (!empty($params)) {
            $body['params'] = $params;
        }
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->execute_d1_query($this->database, $body);
        if (is_array($res) && isset($res['results']) && is_array($res['results'])) {
            return $res['results'];
        }
        return [];
    }

    /**
     * Alias for exec() to match SDK parity across runtimes.
     *
     * @param mixed[] $params
     * @return array<int, array<string, mixed>>
     */
    public function query(string $query, array $params = []): array
    {
        return $this->exec($query, $params);
    }
}
