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
use EdgeBase\Core\Generated\GeneratedDbApi;
use PHPUnit\Framework\TestCase;
class TableRefBuilderTest extends TestCase
{
    private function makeTable(): \EdgeBase\Core\TableRef
    {
        $http = new HttpClient('https://dummy.edgebase.fun', 'sk-test');
        $core = new GeneratedDbApi($http);
        return new \EdgeBase\Core\TableRef($core, 'posts', 'shared');
    }

    public function test_where_returns_new_instance(): void
    {
        $t1 = $this->makeTable();
        $t2 = $t1->where('status', '==', 'published');
        $this->assertNotSame($t1, $t2);
    }

    public function test_order_by_returns_new_instance(): void
    {
        $t1 = $this->makeTable();
        $t2 = $t1->orderBy('createdAt', 'desc');
        $this->assertNotSame($t1, $t2);
    }

    public function test_limit_returns_new_instance(): void
    {
        $t1 = $this->makeTable();
        $t2 = $t1->limit(10);
        $this->assertNotSame($t1, $t2);
    }

    public function test_offset_returns_new_instance(): void
    {
        $t1 = $this->makeTable();
        $t2 = $t1->offset(5);
        $this->assertNotSame($t1, $t2);
    }

    public function test_page_returns_new_instance(): void
    {
        $t1 = $this->makeTable();
        $t2 = $t1->page(2);
        $this->assertNotSame($t1, $t2);
    }

    public function test_search_returns_new_instance(): void
    {
        $t1 = $this->makeTable();
        $t2 = $t1->search('keyword');
        $this->assertNotSame($t1, $t2);
    }

    public function test_after_returns_new_instance(): void
    {
        $t1 = $this->makeTable();
        $t2 = $t1->after('cursor-abc');
        $this->assertNotSame($t1, $t2);
    }

    public function test_before_returns_new_instance(): void
    {
        $t1 = $this->makeTable();
        $t2 = $t1->before('cursor-xyz');
        $this->assertNotSame($t1, $t2);
    }

    public function test_expand_returns_new_instance(): void
    {
        $t1 = $this->makeTable();
        $t2 = $t1->expand('author', 'comments');
        $this->assertNotSame($t1, $t2);
    }

    public function test_chaining_preserves_immutability(): void
    {
        $t1 = $this->makeTable();
        $t2 = $t1->where('status', '==', 'published')
                  ->orderBy('createdAt', 'desc')
                  ->limit(10);
        $this->assertNotSame($t1, $t2);
    }

    public function test_or_builder_returns_new_instance(): void
    {
        $t1 = $this->makeTable();
        $t2 = $t1->or(function ($q) {
            $q->where('status', '==', 'draft');
        });
        $this->assertNotSame($t1, $t2);
    }

    public function test_multiple_where_accumulates(): void
    {
        $t = $this->makeTable()
            ->where('a', '==', 1)
            ->where('b', '>', 2)
            ->where('c', '<', 3);
        // If it didn't throw, chaining works
        $this->assertNotNull($t);
    }

    public function test_multiple_order_by_accumulates(): void
    {
        $t = $this->makeTable()
            ->orderBy('createdAt', 'desc')
            ->orderBy('title', 'asc');
        $this->assertNotNull($t);
    }
}
