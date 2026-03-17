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
class FieldOpsTest extends TestCase
{
    public function test_increment_returns_correct_op(): void
    {
        $result = FieldOps::increment(5);
        $this->assertSame('increment', $result['$op']);
        $this->assertSame(5, $result['value']);
    }

    public function test_increment_default_value_is_one(): void
    {
        $result = FieldOps::increment();
        $this->assertSame(1, $result['value']);
    }

    public function test_increment_negative_value(): void
    {
        $result = FieldOps::increment(-10);
        $this->assertSame(-10, $result['value']);
    }

    public function test_increment_float_value(): void
    {
        $result = FieldOps::increment(3.14);
        $this->assertEqualsWithDelta(3.14, $result['value'], 0.001);
    }

    public function test_increment_zero(): void
    {
        $result = FieldOps::increment(0);
        $this->assertSame(0, $result['value']);
    }

    public function test_delete_field_returns_correct_op(): void
    {
        $result = FieldOps::deleteField();
        $this->assertSame('deleteField', $result['$op']);
    }

    public function test_delete_field_has_no_value_key(): void
    {
        $result = FieldOps::deleteField();
        $this->assertArrayNotHasKey('value', $result);
    }

    public function test_delete_field_has_only_op_key(): void
    {
        $result = FieldOps::deleteField();
        $this->assertCount(1, $result);
        $this->assertArrayHasKey('$op', $result);
    }

    public function test_increment_is_array(): void
    {
        $this->assertIsArray(FieldOps::increment(1));
    }

    public function test_delete_field_is_array(): void
    {
        $this->assertIsArray(FieldOps::deleteField());
    }
}
