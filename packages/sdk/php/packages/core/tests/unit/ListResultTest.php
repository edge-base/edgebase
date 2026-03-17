<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use EdgeBase\Core\BatchResult;
use EdgeBase\Core\OrBuilder;
use EdgeBase\Core\HttpClient;
use EdgeBase\Core\DbRef;
use EdgeBase\Core\StorageClient;
use EdgeBase\Core\StorageBucket;
use PHPUnit\Framework\TestCase;
class ListResultTest extends TestCase
{
    public function test_from_array_empty(): void
    {
        $lr = ListResult::fromArray([]);
        $this->assertEmpty($lr->items);
        $this->assertNull($lr->total);
        $this->assertNull($lr->cursor);
    }

    public function test_from_array_with_items(): void
    {
        $lr = ListResult::fromArray([
            'items' => [['id' => '1', 'title' => 'A']],
            'total' => 1,
        ]);
        $this->assertCount(1, $lr->items);
        $this->assertSame(1, $lr->total);
    }

    public function test_from_array_with_pagination_fields(): void
    {
        $lr = ListResult::fromArray([
            'items' => [],
            'total' => 100,
            'page' => 2,
            'perPage' => 20,
            'hasMore' => true,
            'cursor' => 'abc123',
        ]);
        $this->assertSame(2, $lr->page);
        $this->assertSame(20, $lr->perPage);
        $this->assertTrue($lr->hasMore);
        $this->assertSame('abc123', $lr->cursor);
    }

    public function test_array_access_items(): void
    {
        $lr = ListResult::fromArray(['items' => [['id' => '1']]]);
        $this->assertSame($lr->items, $lr['items']);
    }

    public function test_array_access_total(): void
    {
        $lr = ListResult::fromArray(['items' => [], 'total' => 42]);
        $this->assertSame(42, $lr['total']);
    }

    public function test_offset_exists(): void
    {
        $lr = ListResult::fromArray(['items' => []]);
        $this->assertTrue(isset($lr['items']));
        $this->assertTrue(isset($lr['total']));
    }

    public function test_offset_set_is_noop(): void
    {
        $lr = ListResult::fromArray(['items' => [], 'total' => 5]);
        $lr['total'] = 999; // should be no-op
        $this->assertSame(5, $lr->total);
    }

    public function test_offset_unset_is_noop(): void
    {
        $lr = ListResult::fromArray(['items' => [['id' => '1']], 'total' => 1]);
        unset($lr['items']); // should be no-op
        $this->assertCount(1, $lr->items);
    }
}
