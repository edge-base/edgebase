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
class OrBuilderTest extends TestCase
{
    public function test_empty_builder_returns_empty_filters(): void
    {
        $builder = new OrBuilder();
        $this->assertEmpty($builder->getFilters());
    }

    public function test_single_where_adds_filter(): void
    {
        $builder = new OrBuilder();
        $builder->where('status', '==', 'draft');
        $filters = $builder->getFilters();
        $this->assertCount(1, $filters);
        $this->assertSame('status', $filters[0]['field']);
        $this->assertSame('==', $filters[0]['op']);
        $this->assertSame('draft', $filters[0]['value']);
    }

    public function test_multiple_where_accumulates(): void
    {
        $builder = new OrBuilder();
        $builder->where('status', '==', 'draft')
                ->where('status', '==', 'archived');
        $this->assertCount(2, $builder->getFilters());
    }

    public function test_where_returns_self_for_chaining(): void
    {
        $builder = new OrBuilder();
        $result = $builder->where('a', '==', 1);
        $this->assertSame($builder, $result);
    }

    public function test_filter_structure_field_op_value(): void
    {
        $builder = new OrBuilder();
        $builder->where('count', '>', 10);
        $f = $builder->getFilters()[0];
        $this->assertArrayHasKey('field', $f);
        $this->assertArrayHasKey('op', $f);
        $this->assertArrayHasKey('value', $f);
    }
}
