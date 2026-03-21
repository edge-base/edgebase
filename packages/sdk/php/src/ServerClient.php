<?php

declare(strict_types=1);

namespace EdgeBase;

final class ServerClient
{
    public readonly AdminAuthClient $adminAuth;
    public readonly StorageClient $storage;

    /** @var array<string, mixed> */
    private array $context = [];

    private readonly \EdgeBase\Admin\AdminClient $inner;

    public function __construct(string $url, string $serviceKey = '')
    {
        $this->inner = new \EdgeBase\Admin\AdminClient($url, $serviceKey);
        $this->adminAuth = new AdminAuthClient($this->inner->adminAuth);
        $this->storage = new StorageClient($this->inner->storage);
    }

    public function table(string $name): TableRef
    {
        return new TableRef($this->inner->db('shared')->table($name));
    }

    /**
     * @param array<string, mixed> $context
     */
    public function setContext(array $context): void
    {
        $this->context = $context;
    }

    /**
     * @return array<string, mixed>
     */
    public function getContext(): array
    {
        return $this->context;
    }

    public function kv(string $namespace): KvClient
    {
        return new KvClient($this->inner->kv($namespace));
    }

    public function d1(string $database): D1Client
    {
        return new D1Client($this->inner->d1($database));
    }

    public function vector(string $index): VectorizeClient
    {
        return new VectorizeClient($this->inner->vector($index));
    }

    /**
     * @param array<int, mixed> $params
     * @return array{rows: array<int, array<string, mixed>>}
     */
    public function sql(string $table, string $query, array $params = []): array
    {
        unset($table);
        return ['rows' => $this->inner->sql('shared', null, $query, $params)];
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function broadcast(string $channel, string $event, array $payload = []): void
    {
        $this->inner->broadcast($channel, $event, $payload);
    }

    public function destroy(): void
    {
        $this->inner->destroy();
    }
}
