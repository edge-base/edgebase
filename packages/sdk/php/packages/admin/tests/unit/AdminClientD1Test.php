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

class AdminClientD1Test extends TestCase
{
    public function test_d1_returns_d1_client(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $d1 = $admin->d1('analytics');
        $this->assertNotNull($d1);
    }

    public function test_different_databases_are_different(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $d1a = $admin->d1('db1');
        $d1b = $admin->d1('db2');
        $this->assertNotSame($d1a, $d1b);
    }
}
