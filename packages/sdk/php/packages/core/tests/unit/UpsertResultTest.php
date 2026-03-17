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
class UpsertResultTest extends TestCase
{
    public function test_constructor_sets_record(): void
    {
        $ur = new UpsertResult(['id' => 'u-1', 'title' => 'Test'], true);
        $this->assertSame(['id' => 'u-1', 'title' => 'Test'], $ur->record);
    }

    public function test_inserted_flag_true(): void
    {
        $ur = new UpsertResult(['id' => 'u-1'], true);
        $this->assertTrue($ur->inserted);
    }

    public function test_inserted_flag_false(): void
    {
        $ur = new UpsertResult(['id' => 'u-1'], false);
        $this->assertFalse($ur->inserted);
    }

    public function test_array_access_delegates_to_record(): void
    {
        $ur = new UpsertResult(['id' => 'u-1', 'title' => 'Hello'], true);
        $this->assertSame('u-1', $ur['id']);
        $this->assertSame('Hello', $ur['title']);
    }

    public function test_array_access_missing_key_returns_null(): void
    {
        $ur = new UpsertResult(['id' => 'u-1'], true);
        $this->assertNull($ur['nonexistent']);
    }

    public function test_offset_exists(): void
    {
        $ur = new UpsertResult(['id' => 'u-1'], true);
        $this->assertTrue(isset($ur['id']));
        $this->assertFalse(isset($ur['missing']));
    }

    public function test_offset_set_is_noop(): void
    {
        $ur = new UpsertResult(['id' => 'u-1'], true);
        $ur['id'] = 'u-2'; // should be no-op
        $this->assertSame('u-1', $ur['id']);
    }
}
