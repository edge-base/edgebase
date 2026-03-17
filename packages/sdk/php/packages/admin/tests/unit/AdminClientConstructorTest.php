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

class AdminClientConstructorTest extends TestCase
{
    public function test_instantiation_succeeds(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertInstanceOf(AdminClient::class, $admin);
    }

    public function test_adminAuth_property_exists(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertNotNull($admin->adminAuth);
    }

    public function test_storage_property_exists(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertNotNull($admin->storage);
    }

    public function test_functions_method_exists(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertTrue(method_exists($admin, 'functions'));
        $this->assertNotNull($admin->functions());
    }

    public function test_analytics_method_exists(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertTrue(method_exists($admin, 'analytics'));
        $this->assertNotNull($admin->analytics());
    }

    public function test_destroy_is_callable(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        // No-op but must not throw
        $this->assertNull($admin->destroy());
    }

    public function test_empty_service_key_is_allowed(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', '');
        $this->assertInstanceOf(AdminClient::class, $admin);
    }

    public function test_trailing_slash_url(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun/', 'sk-test');
        $this->assertInstanceOf(AdminClient::class, $admin);
    }
}
