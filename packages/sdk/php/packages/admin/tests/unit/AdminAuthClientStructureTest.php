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

class AdminAuthClientStructureTest extends TestCase
{
    public function test_get_user_method_exists(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertTrue(method_exists($admin->adminAuth, 'getUser'));
    }

    public function test_list_users_method_exists(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertTrue(method_exists($admin->adminAuth, 'listUsers'));
    }

    public function test_create_user_method_exists(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertTrue(method_exists($admin->adminAuth, 'createUser'));
    }

    public function test_update_user_method_exists(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertTrue(method_exists($admin->adminAuth, 'updateUser'));
    }

    public function test_delete_user_method_exists(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertTrue(method_exists($admin->adminAuth, 'deleteUser'));
    }

    public function test_set_custom_claims_method_exists(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertTrue(method_exists($admin->adminAuth, 'setCustomClaims'));
    }

    public function test_revoke_all_sessions_method_exists(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertTrue(method_exists($admin->adminAuth, 'revokeAllSessions'));
    }
}
