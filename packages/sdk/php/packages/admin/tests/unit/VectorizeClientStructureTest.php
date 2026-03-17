<?php

declare(strict_types=1);

namespace EdgeBase\Tests\Admin;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Admin\AdminEdgeBase;
use PHPUnit\Framework\TestCase;

/**
 * PHP Admin SDK 단위 테스트
 *
 * 실행: cd packages/sdk/php/packages/admin && ./vendor/bin/phpunit tests/unit/ -v
 *
 * 원칙:
 *   - 서버 불필요 — 순수 PHP 클래스 생성/구조 검증
 *   - 실제 HTTP 호출 없음
 *   - AdminClient / AdminEdgeBase / AdminAuthClient / KvClient / D1Client /
 *     PushClient / VectorizeClient / StorageClient 임포트 및 인스턴스 검증
 */

class VectorizeClientStructureTest extends TestCase
{
    public function test_vector_has_upsert_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $vec = $admin->vector('embeddings');
        $this->assertTrue(method_exists($vec, 'upsert'));
    }

    public function test_vector_has_search_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $vec = $admin->vector('embeddings');
        $this->assertTrue(method_exists($vec, 'search'));
    }

    public function test_vector_has_delete_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $vec = $admin->vector('embeddings');
        $this->assertTrue(method_exists($vec, 'delete'));
    }

    public function test_vector_has_insert_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $vec = $admin->vector('embeddings');
        $this->assertTrue(method_exists($vec, 'insert'));
    }

    public function test_vector_has_query_by_id_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $vec = $admin->vector('embeddings');
        $this->assertTrue(method_exists($vec, 'queryById'));
    }

    public function test_vector_has_get_by_ids_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $vec = $admin->vector('embeddings');
        $this->assertTrue(method_exists($vec, 'getByIds'));
    }

    public function test_vector_has_describe_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $vec = $admin->vector('embeddings');
        $this->assertTrue(method_exists($vec, 'describe'));
    }
}
