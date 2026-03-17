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

class AdminClientVectorTest extends TestCase
{
    public function test_vector_returns_client(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $vec = $admin->vector('embeddings');
        $this->assertNotNull($vec);
    }

    public function test_different_indexes_are_different(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $v1 = $admin->vector('idx1');
        $v2 = $admin->vector('idx2');
        $this->assertNotSame($v1, $v2);
    }
}
