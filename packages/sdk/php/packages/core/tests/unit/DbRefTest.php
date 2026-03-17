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
class DbRefTest extends TestCase
{
    private function makeCore(): GeneratedDbApi
    {
        $http = new HttpClient('https://dummy.edgebase.fun', 'sk-test');
        return new GeneratedDbApi($http);
    }

    public function test_table_returns_table_ref(): void
    {
        $db = new DbRef($this->makeCore(), 'shared');
        $table = $db->table('posts');
        $this->assertInstanceOf(\EdgeBase\Core\TableRef::class, $table);
    }

    public function test_table_returns_new_instance_each_call(): void
    {
        $db = new DbRef($this->makeCore(), 'shared');
        $t1 = $db->table('posts');
        $t2 = $db->table('posts');
        $this->assertNotSame($t1, $t2);
    }

    public function test_different_tables_return_different_refs(): void
    {
        $db = new DbRef($this->makeCore(), 'shared');
        $t1 = $db->table('posts');
        $t2 = $db->table('comments');
        $this->assertNotSame($t1, $t2);
    }

    public function test_with_instance_id(): void
    {
        $db = new DbRef($this->makeCore(), 'workspace', 'ws-123');
        $table = $db->table('docs');
        $this->assertInstanceOf(\EdgeBase\Core\TableRef::class, $table);
    }
}
