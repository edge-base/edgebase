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

class PushClientStructureTest extends TestCase
{
    public function test_push_has_send_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $push = $admin->push();
        $this->assertTrue(method_exists($push, 'send'));
    }

    public function test_push_has_send_many_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $push = $admin->push();
        $this->assertTrue(method_exists($push, 'sendMany'));
    }

    public function test_push_has_send_to_token_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $push = $admin->push();
        $this->assertTrue(method_exists($push, 'sendToToken'));
    }

    public function test_push_has_get_tokens_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $push = $admin->push();
        $this->assertTrue(method_exists($push, 'getTokens'));
    }

    public function test_push_has_get_logs_method(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $push = $admin->push();
        $this->assertTrue(method_exists($push, 'getLogs'));
    }
}
