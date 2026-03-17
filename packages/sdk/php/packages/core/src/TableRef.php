<?php

declare(strict_types=1);

namespace EdgeBase\Core;

use EdgeBase\Core\Generated\GeneratedDbApi;
use EdgeBase\Core\Generated\GeneratedAdminApi;

/**
 * TableRef — immutable query builder + CRUD + batch for a EdgeBase table.
 *
 * All builder methods return a NEW instance (immutable).
 * All HTTP calls delegate to Generated Core (GeneratedDbApi).
 * No hardcoded API paths — the core is the single source of truth.
 *
 * Usage:
 *   $result = $client->table('posts')
 *       ->where('status', '==', 'published')
 *       ->orderBy('createdAt', 'desc')
 *       ->limit(20)
 *       ->getList();
 *
 *   foreach ($result->items as $post) { ... }
 */
class TableRef
{
    /** @var array<int, array{field: string, op: string, value: mixed}> */
    private array $filters = [];

    /** @var array<int, array{field: string, op: string, value: mixed}> */
    private array $orFilters = [];

    /** @var string[] e.g. ["field:asc", "field2:desc"] */
    private array $sorts = [];

    private ?int $limitValue = null;
    private ?int $offsetValue = null;
    private ?int $pageValue = null;
    private string $searchValue = '';
    private string $afterValue = '';
    private string $beforeValue = '';
    /** @var string[] */
    private array $expandFields = [];

    public function __construct(
        private readonly GeneratedDbApi $core,
        private readonly string $name,
        private readonly string $namespace = 'shared',
        private readonly ?string $instanceId = null,
    ) {
    }

    // ─── Core dispatch helpers ───

    /** List records via the correct generated core method (single-instance vs dynamic). */
    private function coreList(array $query): mixed
    {
        if ($this->instanceId !== null) {
            return $this->core->db_list_records($this->namespace, $this->instanceId, $this->name, $query);
        }
        return $this->core->db_single_list_records($this->namespace, $this->name, $query);
    }

    /** Search records via the correct generated core method. */
    private function coreSearch(array $query): mixed
    {
        if ($this->instanceId !== null) {
            return $this->core->db_search_records($this->namespace, $this->instanceId, $this->name, $query);
        }
        return $this->core->db_single_search_records($this->namespace, $this->name, $query);
    }

    /** Get single record via the correct generated core method. */
    private function coreGet(string $id, array $query = []): mixed
    {
        if ($this->instanceId !== null) {
            return $this->core->db_get_record($this->namespace, $this->instanceId, $this->name, $id, $query);
        }
        return $this->core->db_single_get_record($this->namespace, $this->name, $id, $query);
    }

    /** Insert record via the correct generated core method. */
    private function coreInsert(mixed $body, array $query = []): mixed
    {
        if ($this->instanceId !== null) {
            return $this->core->db_insert_record($this->namespace, $this->instanceId, $this->name, $body, $query);
        }
        return $this->core->db_single_insert_record($this->namespace, $this->name, $body, $query);
    }

    /** Update record via the correct generated core method. */
    private function coreUpdate(string $id, mixed $body): mixed
    {
        if ($this->instanceId !== null) {
            return $this->core->db_update_record($this->namespace, $this->instanceId, $this->name, $id, $body);
        }
        return $this->core->db_single_update_record($this->namespace, $this->name, $id, $body);
    }

    /** Delete record via the correct generated core method. */
    private function coreDelete(string $id): mixed
    {
        if ($this->instanceId !== null) {
            return $this->core->db_delete_record($this->namespace, $this->instanceId, $this->name, $id);
        }
        return $this->core->db_single_delete_record($this->namespace, $this->name, $id);
    }

    /** Count records via the correct generated core method. */
    private function coreCount(array $query): mixed
    {
        if ($this->instanceId !== null) {
            return $this->core->db_count_records($this->namespace, $this->instanceId, $this->name, $query);
        }
        return $this->core->db_single_count_records($this->namespace, $this->name, $query);
    }

    /** Batch insert via the correct generated core method. */
    private function coreBatch(mixed $body, array $query = []): mixed
    {
        if ($this->instanceId !== null) {
            return $this->core->db_batch_records($this->namespace, $this->instanceId, $this->name, $body, $query);
        }
        return $this->core->db_single_batch_records($this->namespace, $this->name, $body, $query);
    }

    /** Batch by filter via the correct generated core method. */
    private function coreBatchByFilter(mixed $body, array $query = []): mixed
    {
        if ($this->instanceId !== null) {
            return $this->core->db_batch_by_filter($this->namespace, $this->instanceId, $this->name, $body, $query);
        }
        return $this->core->db_single_batch_by_filter($this->namespace, $this->name, $body, $query);
    }

    // ─── Clone helper ───

    private function clone(): self
    {
        $c = new self($this->core, $this->name, $this->namespace, $this->instanceId);
        $c->filters = $this->filters;
        $c->orFilters = $this->orFilters;
        $c->sorts = $this->sorts;
        $c->limitValue = $this->limitValue;
        $c->offsetValue = $this->offsetValue;
        $c->pageValue = $this->pageValue;
        $c->searchValue = $this->searchValue;
        $c->afterValue = $this->afterValue;
        $c->beforeValue = $this->beforeValue;
        $c->expandFields = $this->expandFields;
        return $c;
    }

    // ─── Query Builder ───

    public function where(string $field, string $op, mixed $value): self
    {
        $c = $this->clone();
        $c->filters[] = ['field' => $field, 'op' => $op, 'value' => $value];
        return $c;
    }

    /** Add OR conditions. */
    public function or(callable $builderFn): self
    {
        $builder = new OrBuilder();
        $builderFn($builder);
        $c = $this->clone();
        $c->orFilters = array_merge($c->orFilters, $builder->getFilters());
        return $c;
    }

    /** Multiple calls accumulate. */
    public function orderBy(string $field, string $direction = 'asc'): self
    {
        $c = $this->clone();
        $c->sorts[] = "{$field}:{$direction}";
        return $c;
    }

    public function limit(int $n): self
    {
        $c = $this->clone();
        $c->limitValue = $n;
        return $c;
    }

    public function offset(int $n): self
    {
        $c = $this->clone();
        $c->offsetValue = $n;
        return $c;
    }

    /** Page-based pagination (1-based). */
    public function page(int $n): self
    {
        $c = $this->clone();
        $c->pageValue = $n;
        return $c;
    }


    /** Full-text search. */
    public function search(string $q): self
    {
        $c = $this->clone();
        $c->searchValue = $q;
        return $c;
    }

    /** Cursor-based forward pagination. Mutually exclusive with offset/page. */
    public function after(string $cursor): self
    {
        $c = $this->clone();
        $c->afterValue = $cursor;
        $c->beforeValue = '';
        return $c;
    }

    /** Cursor-based backward pagination. Mutually exclusive with offset/page. */
    public function before(string $cursor): self
    {
        $c = $this->clone();
        $c->beforeValue = $cursor;
        $c->afterValue = '';
        return $c;
    }

    /**
     * Expand relational fields (join) by field name.
     * Returns a new TableRef instance (immutable).
     */
    public function expand(string ...$fields): self
    {
        $c = $this->clone();
        $c->expandFields = array_unique(array_merge($c->expandFields, $fields));
        return $c;
    }

    // ─── CRUD ───

    /** Execute query and return ListResult. */
    public function getList(): ListResult
    {
        $params = $this->buildQueryParams();
        if ($this->searchValue !== '') {
            $params['search'] = $this->searchValue;
            /** @var array<string, mixed> $data */
            $data = $this->coreSearch($params);
        } else {
            /** @var array<string, mixed> $data */
            $data = $this->coreList($params);
        }
        return ListResult::fromArray(is_array($data) ? $data : []);
    }

    /** Alias for getList() to match SDK parity across runtimes. */
    public function get(): ListResult
    {
        return $this->getList();
    }

    /**
     * Fetch a single document by ID.
     * @return array<string, mixed>
     */
    public function getOne(string $id): array
    {
        /** @var array<string, mixed> */
        return $this->coreGet($id);
    }

    /**
     * Get the first record matching the current query conditions.
     * Returns null if no records match.
     * @return array<string, mixed>|null
     */
    public function getFirst(): ?array
    {
        $result = $this->limit(1)->getList();
        return !empty($result->items) ? $result->items[0] : null;
    }

    /**
     * Execute admin SQL scoped to this table's database namespace.
     *
     * @param mixed[] $params
     * @return array<int, array<string, mixed>>
     */
    public function sql(string $query, array $params = []): array
    {
        $body = [
            'namespace' => $this->namespace,
            'sql' => $query,
            'params' => $params,
        ];
        if ($this->instanceId !== null) {
            $body['id'] = $this->instanceId;
        }
        $adminCore = new GeneratedAdminApi($this->core->http_client());
        $result = $adminCore->execute_sql($body);
        if (is_array($result) && isset($result['items']) && is_array($result['items'])) {
            /** @var array<int, array<string, mixed>> $items */
            $items = $result['items'];
            return $items;
        }
        return [];
    }

    /**
     * Insert a new document.
     * @param array<string, mixed> $record
     * @return array<string, mixed>
     */
    public function insert(array $record): array
    {
        /** @var array<string, mixed> */
        return $this->coreInsert($record);
    }

    /**
     * Update a document by ID.
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function update(string $id, array $data): array
    {
        /** @var array<string, mixed> */
        return $this->coreUpdate($id, $data);
    }

    /**
     * Delete a document by ID.
     * @return array<string, mixed>
     */
    public function delete(string $id): array
    {
        /** @var array<string, mixed> $result */
        $result = $this->coreDelete($id);
        return is_array($result) ? $result : [];
    }

    public function doc(string $id): DocRef
    {
        return new DocRef($this, $id);
    }

    /**
     * Upsert a record.
     * @param array<string, mixed> $record
     */
    public function upsert(array $record, string $conflictTarget = ''): UpsertResult
    {
        $query = ['upsert' => 'true'];
        if ($conflictTarget !== '') {
            $query['conflictTarget'] = $conflictTarget;
        }
        /** @var array<string, mixed> $data */
        $data = $this->coreInsert($record, $query);
        $inserted = isset($data['action']) && $data['action'] === 'inserted';
        return new UpsertResult(is_array($data) ? $data : [], $inserted);
    }

    /** Count records matching filters. */
    public function count(): int
    {
        $params = $this->buildQueryParams();
        /** @var array<string, mixed> $data */
        $data = $this->coreCount($params);
        return isset($data['total']) ? (int) $data['total'] : 0;
    }

    // ─── Batch ───

    /**
     * Insert multiple records in chunks of 500.
     *
     * @param array<int, array<string, mixed>> $records
     * @return array<int, array<string, mixed>>
     */
    public function insertMany(array $records): array
    {
        $chunkSize = 500;
        $all = [];
        foreach (array_chunk($records, $chunkSize) as $chunk) {
            /** @var array<string, mixed> $data */
            $data = $this->coreBatch(['inserts' => $chunk]);
            if (isset($data['inserted']) && is_array($data['inserted'])) {
                $all = array_merge($all, $data['inserted']);
            }
        }
        return $all;
    }

    /**
     * Upsert multiple records in chunks of 500.
     *
     * @param array<int, array<string, mixed>> $records
     * @return array<int, array<string, mixed>>
     */
    public function upsertMany(array $records, string $conflictTarget = ''): array
    {
        $chunkSize = 500;
        $query = ['upsert' => 'true'];
        if ($conflictTarget !== '') {
            $query['conflictTarget'] = $conflictTarget;
        }
        $all = [];
        foreach (array_chunk($records, $chunkSize) as $chunk) {
            /** @var array<string, mixed> $data */
            $data = $this->coreBatch(['inserts' => $chunk], $query);
            if (isset($data['inserted']) && is_array($data['inserted'])) {
                $all = array_merge($all, $data['inserted']);
            }
        }
        return $all;
    }

    /**
     * Update records matching query builder filters in batches.
     * @param array<string, mixed> $update
     */
    public function updateMany(array $update): BatchResult
    {
        if (empty($this->filters)) {
            throw new \InvalidArgumentException('updateMany() requires at least one where() filter');
        }
        return $this->batchByFilter('update', $update);
    }

    /** Delete records matching query builder filters in batches. */
    public function deleteMany(): BatchResult
    {
        if (empty($this->filters)) {
            throw new \InvalidArgumentException('deleteMany() requires at least one where() filter');
        }
        return $this->batchByFilter('delete', null);
    }

    // ─── Internal ───

    private function batchByFilter(string $action, ?array $update): BatchResult
    {
        $maxIter = 100;
        $filterJson = array_map(
            fn($f) => [$f['field'], $f['op'], $f['value']],
            $this->filters,
        );
        $totalProcessed = 0;
        $totalSucceeded = 0;
        $errors = [];

        for ($i = 0; $i < $maxIter; $i++) {
            $body = ['action' => $action, 'filter' => $filterJson, 'limit' => 500];
            if (!empty($this->orFilters)) {
                $orFilterJson = array_map(
                    fn($f) => [$f['field'], $f['op'], $f['value']],
                    $this->orFilters,
                );
                $body['orFilter'] = $orFilterJson;
            }
            if ($action === 'update' && $update !== null) {
                $body['update'] = $update;
            }
            try {
                /** @var array<string, mixed> $data */
                $data = $this->coreBatchByFilter($body);
                $processed = (int) ($data['processed'] ?? 0);
                $succeeded = (int) ($data['succeeded'] ?? 0);
                $totalProcessed += $processed;
                $totalSucceeded += $succeeded;
                if ($processed === 0) {
                    break;
                }
                // For 'update', don't loop — updated records still match the filter,
                // so re-querying would process the same rows again (infinite loop).
                // Only 'delete' benefits from looping since deleted rows disappear.
                if ($action === 'update') {
                    break;
                }
            } catch (EdgeBaseException $e) {
                $errors[] = ['chunkIndex' => $i, 'error' => $e->getMessage()];
                break;
            }
        }

        return new BatchResult($totalProcessed, $totalSucceeded, $errors);
    }

    /** @return array<string, string> */
    private function buildQueryParams(): array
    {
        $hasCursor = $this->afterValue !== '' || $this->beforeValue !== '';
        $hasOffset = $this->offsetValue !== null || $this->pageValue !== null;
        if ($hasCursor && $hasOffset) {
            throw new \InvalidArgumentException(
                'Cannot use page()/offset() with after()/before() — choose offset or cursor pagination'
            );
        }
        $params = [];
        if (!empty($this->filters)) {
            $filterJson = array_map(
                fn($f) => [$f['field'], $f['op'], $f['value']],
                $this->filters,
            );
            $params['filter'] = json_encode($filterJson, JSON_THROW_ON_ERROR);
        }
        if (!empty($this->orFilters)) {
            $orFilterJson = array_map(
                fn($f) => [$f['field'], $f['op'], $f['value']],
                $this->orFilters,
            );
            $params['orFilter'] = json_encode($orFilterJson, JSON_THROW_ON_ERROR);
        }
        if (!empty($this->sorts)) {
            $params['sort'] = implode(',', $this->sorts);
        }
        if ($this->limitValue !== null) {
            $params['limit'] = (string) $this->limitValue;
        }
        if ($this->pageValue !== null) {
            $params['page'] = (string) $this->pageValue;
        }
        if ($this->offsetValue !== null) {
            $params['offset'] = (string) $this->offsetValue;
        }
        if ($this->afterValue !== '') {
            $params['after'] = $this->afterValue;
        }
        if ($this->beforeValue !== '') {
            $params['before'] = $this->beforeValue;
        }
        if (!empty($this->expandFields)) {
            $params['expand'] = implode(',', $this->expandFields);
        }
        return $params;
    }
}


// ─── Result types ───

/** Unified query result. */
class ListResult implements \ArrayAccess
{
    /**
     * @param array<int, array<string, mixed>> $items
     */
    public function __construct(
        public readonly array $items = [],
        public readonly ?int $total = null,
        public readonly ?int $page = null,
        public readonly ?int $perPage = null,
        public readonly ?bool $hasMore = null,
        public readonly ?string $cursor = null,
    ) {
    }

    /** @param array<string, mixed> $data */
    public static function fromArray(array $data): self
    {
        /** @var array<int, array<string, mixed>> $items */
        $items = isset($data['items']) && is_array($data['items']) ? $data['items'] : [];
        return new self(
            items: $items,
            total: isset($data['total']) ? (int) $data['total'] : null,
            page: isset($data['page']) ? (int) $data['page'] : null,
            perPage: isset($data['perPage']) ? (int) $data['perPage'] : null,
            hasMore: isset($data['hasMore']) ? (bool) $data['hasMore'] : null,
            cursor: isset($data['cursor']) ? (string) $data['cursor'] : null,
        );
    }

    // ArrayAccess — allows $result['items'], $result['total'], etc.
    public function offsetExists(mixed $offset): bool
    {
        return property_exists($this, (string) $offset);
    }

    public function offsetGet(mixed $offset): mixed
    {
        return $this->{(string) $offset} ?? null;
    }

    public function offsetSet(mixed $offset, mixed $value): void
    {
        // readonly — no-op
    }

    public function offsetUnset(mixed $offset): void
    {
        // readonly — no-op
    }
}

/** Result of an upsert operation. */
class UpsertResult implements \ArrayAccess
{
    /**
     * @param array<string, mixed> $record
     */
    public function __construct(
        public readonly array $record,
        public readonly bool $inserted,
    ) {
    }

    // ArrayAccess — delegates to record so $r['id'] works
    public function offsetExists(mixed $offset): bool
    {
        return isset($this->record[(string) $offset]);
    }

    public function offsetGet(mixed $offset): mixed
    {
        return $this->record[(string) $offset] ?? null;
    }

    public function offsetSet(mixed $offset, mixed $value): void
    {
        // readonly — no-op
    }

    public function offsetUnset(mixed $offset): void
    {
        // readonly — no-op
    }
}

/** Result of a batch operation. */
class BatchResult
{
    /**
     * @param array<int, array<string, mixed>> $errors
     */
    public function __construct(
        public readonly int $totalProcessed,
        public readonly int $totalSucceeded,
        public readonly array $errors,
    ) {
    }
}

class DocRef
{
    public function __construct(
        private readonly TableRef $table,
        private readonly string $id,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function get(): array
    {
        return $this->table->getOne($this->id);
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function update(array $data): array
    {
        return $this->table->update($this->id, $data);
    }

    /**
     * @return array<string, mixed>
     */
    public function delete(): array
    {
        return $this->table->delete($this->id);
    }
}

/** Builder for OR conditions. */
class OrBuilder
{
    private array $filters = [];

    public function where(string $field, string $op, mixed $value): self
    {
        $this->filters[] = ['field' => $field, 'op' => $op, 'value' => $value];
        return $this;
    }

    public function getFilters(): array
    {
        return $this->filters;
    }
}
