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

class AdminClientKvTest extends TestCase
{
    public function test_kv_returns_kv_client(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $kv = $admin->kv('cache');
        $this->assertNotNull($kv);
    }

    public function test_different_namespaces_are_different_instances(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $kv1 = $admin->kv('ns1');
        $kv2 = $admin->kv('ns2');
        $this->assertNotSame($kv1, $kv2);
    }
}
