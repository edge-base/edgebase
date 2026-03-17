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

class KvClientStructureTest extends TestCase
{
    public function test_kv_has_get_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $kv = $admin->kv('test');
        $this->assertTrue(method_exists($kv, 'get'));
    }

    public function test_kv_has_set_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $kv = $admin->kv('test');
        $this->assertTrue(method_exists($kv, 'set'));
    }

    public function test_kv_has_delete_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $kv = $admin->kv('test');
        $this->assertTrue(method_exists($kv, 'delete'));
    }

    public function test_kv_has_list_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $kv = $admin->kv('test');
        $this->assertTrue(method_exists($kv, 'list'));
    }
}
