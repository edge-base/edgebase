<?php

declare(strict_types=1);

namespace EdgeBase\Admin;

use EdgeBase\Core\HttpClient;
use EdgeBase\Core\Generated\GeneratedAdminApi;

/**
 * VectorizeClient — Vectorize index access for server-side use.
 * Note: Vectorize is Edge-only. In local/Docker, the server returns stub responses.
 *
 *   $admin->vector('embeddings')->upsert([['id' => 'doc-1', 'values' => [0.1, 0.2]]]);
 *   $results = $admin->vector('embeddings')->search([0.1, 0.2], 10);
 */
class VectorizeClient
{
    private GeneratedAdminApi $adminCore;
    private string $index;

    public function __construct(HttpClient $http, string $index)
    {
        $this->adminCore = new GeneratedAdminApi($http);
        $this->index = $index;
    }

    /**
     * Insert or update vectors.
     * Returns mutation result with ok, count, mutationId.
     * @param array<int, array<string, mixed>> $vectors
     * @return array<string, mixed>
     */
    public function upsert(array $vectors): array
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->vectorize_operation($this->index, [
            'action' => 'upsert',
            'vectors' => $vectors,
        ]);
        return is_array($res) ? $res : [];
    }

    /**
     * Insert vectors (errors on duplicate ID — server returns 409).
     * Returns mutation result with ok, count, mutationId.
     * @param array<int, array<string, mixed>> $vectors
     * @return array<string, mixed>
     */
    public function insert(array $vectors): array
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->vectorize_operation($this->index, [
            'action' => 'insert',
            'vectors' => $vectors,
        ]);
        return is_array($res) ? $res : [];
    }

    /**
     * Search for similar vectors.
     *
     * @param float[] $vector
     * @param array<string, mixed>|null $filter
     * @param string|null $namespace
     * @param bool|null $returnValues
     * @param string|null $returnMetadata 'all', 'indexed', or 'none'
     * @return array<int, array<string, mixed>>
     */
    public function search(
        array $vector,
        int $topK = 10,
        ?array $filter = null,
        ?string $namespace = null,
        ?bool $returnValues = null,
        ?string $returnMetadata = null,
    ): array {
        $body = [
            'action' => 'search',
            'vector' => $vector,
            'topK' => $topK,
        ];
        if ($filter !== null) {
            $body['filter'] = $filter;
        }
        if ($namespace !== null) {
            $body['namespace'] = $namespace;
        }
        if ($returnValues !== null) {
            $body['returnValues'] = $returnValues;
        }
        if ($returnMetadata !== null) {
            $body['returnMetadata'] = $returnMetadata;
        }
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->vectorize_operation($this->index, $body);
        if (is_array($res) && isset($res['matches']) && is_array($res['matches'])) {
            return $res['matches'];
        }
        return [];
    }

    /**
     * Search by an existing vector's ID (Vectorize v2 only).
     *
     * @param array<string, mixed>|null $filter
     * @param string|null $namespace
     * @param bool|null $returnValues
     * @param string|null $returnMetadata 'all', 'indexed', or 'none'
     * @return array<int, array<string, mixed>>
     */
    public function queryById(
        string $vectorId,
        int $topK = 10,
        ?array $filter = null,
        ?string $namespace = null,
        ?bool $returnValues = null,
        ?string $returnMetadata = null,
    ): array {
        $body = [
            'action' => 'queryById',
            'vectorId' => $vectorId,
            'topK' => $topK,
        ];
        if ($filter !== null) {
            $body['filter'] = $filter;
        }
        if ($namespace !== null) {
            $body['namespace'] = $namespace;
        }
        if ($returnValues !== null) {
            $body['returnValues'] = $returnValues;
        }
        if ($returnMetadata !== null) {
            $body['returnMetadata'] = $returnMetadata;
        }
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->vectorize_operation($this->index, $body);
        if (is_array($res) && isset($res['matches']) && is_array($res['matches'])) {
            return $res['matches'];
        }
        return [];
    }

    /**
     * Retrieve vectors by their IDs.
     * @param string[] $ids
     * @return array<int, array<string, mixed>>
     */
    public function getByIds(array $ids): array
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->vectorize_operation($this->index, [
            'action' => 'getByIds',
            'ids' => $ids,
        ]);
        if (is_array($res) && isset($res['vectors']) && is_array($res['vectors'])) {
            return $res['vectors'];
        }
        return [];
    }

    /**
     * Delete vectors by IDs.
     * Returns mutation result with ok, count, mutationId.
     * @param string[] $ids
     * @return array<string, mixed>
     */
    public function delete(array $ids): array
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->vectorize_operation($this->index, [
            'action' => 'delete',
            'ids' => $ids,
        ]);
        return is_array($res) ? $res : [];
    }

    /**
     * Get index info (vector count, dimensions, metric).
     * @return array<string, mixed>
     */
    public function describe(): array
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->vectorize_operation($this->index, [
            'action' => 'describe',
        ]);
        return is_array($res) ? $res : [];
    }
}
