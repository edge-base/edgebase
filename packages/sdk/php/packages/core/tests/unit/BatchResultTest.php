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
class BatchResultTest extends TestCase
{
    public function test_constructor_sets_fields(): void
    {
        $br = new BatchResult(10, 8, [['chunkIndex' => 0, 'error' => 'fail']]);
        $this->assertSame(10, $br->totalProcessed);
        $this->assertSame(8, $br->totalSucceeded);
        $this->assertCount(1, $br->errors);
    }

    public function test_zero_values(): void
    {
        $br = new BatchResult(0, 0, []);
        $this->assertSame(0, $br->totalProcessed);
        $this->assertSame(0, $br->totalSucceeded);
        $this->assertEmpty($br->errors);
    }

    public function test_errors_array_structure(): void
    {
        $errors = [
            ['chunkIndex' => 0, 'error' => 'timeout'],
            ['chunkIndex' => 3, 'error' => 'rate limit'],
        ];
        $br = new BatchResult(100, 96, $errors);
        $this->assertCount(2, $br->errors);
        $this->assertSame('timeout', $br->errors[0]['error']);
        $this->assertSame(3, $br->errors[1]['chunkIndex']);
    }
}
