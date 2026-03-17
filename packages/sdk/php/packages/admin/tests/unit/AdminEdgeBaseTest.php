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

class AdminEdgeBaseTest extends TestCase
{
    public function test_admin_edge_base_extends_admin_client(): void
    {
        $admin = new AdminEdgeBase('https://dummy.edgebase.fun', 'sk-test');
        $this->assertInstanceOf(AdminClient::class, $admin);
    }

    public function test_admin_edge_base_has_admin_auth(): void
    {
        $admin = new AdminEdgeBase('https://dummy.edgebase.fun', 'sk-test');
        $this->assertNotNull($admin->adminAuth);
    }

    public function test_admin_edge_base_has_storage(): void
    {
        $admin = new AdminEdgeBase('https://dummy.edgebase.fun', 'sk-test');
        $this->assertNotNull($admin->storage);
    }
}
