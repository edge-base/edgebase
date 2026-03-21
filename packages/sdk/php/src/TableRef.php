<?php

declare(strict_types=1);

namespace EdgeBase;

final class TableRef
{
    public function __construct(private readonly \EdgeBase\Core\TableRef $inner)
    {
    }

    public function where(string $field, string $op, mixed $value): self
    {
        return new self($this->inner->where($field, $op, $value));
    }

    public function orderBy(string $field, string $direction = 'asc'): self
    {
        return new self($this->inner->orderBy($field, $direction));
    }

    public function limit(int $value): self
    {
        return new self($this->inner->limit($value));
    }

    public function offset(int $value): self
    {
        return new self($this->inner->offset($value));
    }

    public function page(int $value): self
    {
        return new self($this->inner->page($value));
    }

    public function after(string $cursor): self
    {
        return new self($this->inner->after($cursor));
    }

    public function before(string $cursor): self
    {
        return new self($this->inner->before($cursor));
    }

    public function search(string $query): self
    {
        return new self($this->inner->search($query));
    }

    public function get(): \EdgeBase\Core\ListResult
    {
        return $this->inner->getList();
    }

    public function getList(): \EdgeBase\Core\ListResult
    {
        return $this->inner->getList();
    }

    public function getOne(string $id): array
    {
        return $this->inner->getOne($id);
    }

    public function insert(array $record): array
    {
        return $this->inner->insert($record);
    }

    public function update(string $id, array $data): array
    {
        return $this->inner->update($id, $data);
    }

    public function delete(string $id): array
    {
        return $this->inner->delete($id);
    }

    public function count(): int
    {
        return $this->inner->count();
    }

    public function insertMany(array $records): array
    {
        return $this->inner->insertMany($records);
    }

    public function updateMany(array $update): \EdgeBase\Core\BatchResult
    {
        return $this->inner->updateMany($update);
    }

    public function deleteMany(): \EdgeBase\Core\BatchResult
    {
        return $this->inner->deleteMany();
    }

    public function upsert(array $record, string $conflictTarget = ''): \EdgeBase\Core\UpsertResult
    {
        return $this->inner->upsert($record, $conflictTarget);
    }
}
