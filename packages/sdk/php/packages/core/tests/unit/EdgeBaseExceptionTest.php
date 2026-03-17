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
class EdgeBaseExceptionTest extends TestCase
{
    public function test_constructor_sets_message(): void
    {
        $ex = new EdgeBaseException('Record not found', 404);
        $this->assertSame('Record not found', $ex->getMessage());
    }

    public function test_get_status_code(): void
    {
        $ex = new EdgeBaseException('Not found', 404);
        $this->assertSame(404, $ex->getStatusCode());
    }

    public function test_default_status_code_is_zero(): void
    {
        $ex = new EdgeBaseException('error');
        $this->assertSame(0, $ex->getStatusCode());
    }

    public function test_extends_runtime_exception(): void
    {
        $ex = new EdgeBaseException('test', 500);
        $this->assertInstanceOf(\RuntimeException::class, $ex);
    }

    public function test_with_previous_exception(): void
    {
        $prev = new \InvalidArgumentException('inner');
        $ex = new EdgeBaseException('outer', 400, $prev);
        $this->assertSame($prev, $ex->getPrevious());
    }

    public function test_is_throwable(): void
    {
        $ex = new EdgeBaseException('test', 403);
        $this->assertInstanceOf(\Throwable::class, $ex);
    }

    public function test_status_code_401(): void
    {
        $ex = new EdgeBaseException('Unauthorized', 401);
        $this->assertSame(401, $ex->getStatusCode());
    }

    public function test_status_code_500(): void
    {
        $ex = new EdgeBaseException('Server Error', 500);
        $this->assertSame(500, $ex->getStatusCode());
    }

    public function test_message_preserved_exactly(): void
    {
        $msg = 'こんにちは — 한국어 Error Message';
        $ex = new EdgeBaseException($msg);
        $this->assertSame($msg, $ex->getMessage());
    }

    public function test_empty_message(): void
    {
        $ex = new EdgeBaseException('');
        $this->assertSame('', $ex->getMessage());
    }
}
