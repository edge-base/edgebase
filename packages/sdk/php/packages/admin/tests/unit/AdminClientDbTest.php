<?php

declare(strict_types=1);

namespace EdgeBase\Tests\Admin;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Admin\AdminEdgeBase;
use EdgeBase\Core\Generated\GeneratedAdminApi;
use EdgeBase\Core\HttpClient;
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

class AdminClientDbTest extends TestCase
{
    public function test_db_returns_db_ref(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $db = $admin->db('shared');
        $this->assertNotNull($db);
    }

    public function test_db_table_returns_table_ref(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $table = $admin->db('shared')->table('posts');
        $this->assertNotNull($table);
    }

    public function test_db_with_instance_id(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $db = $admin->db('workspace', 'ws-123');
        $this->assertNotNull($db);
    }

    public function test_table_where_returns_new_instance(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $t1 = $admin->db('shared')->table('posts');
        $t2 = $t1->where('status', '==', 'published');
        $this->assertNotSame($t1, $t2);
    }

    public function test_table_limit_returns_new_instance(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $t1 = $admin->db('shared')->table('posts');
        $t2 = $t1->limit(10);
        $this->assertNotSame($t1, $t2);
    }

    public function test_table_order_by_returns_new_instance(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $t1 = $admin->db('shared')->table('posts');
        $t2 = $t1->orderBy('createdAt', 'desc');
        $this->assertNotSame($t1, $t2);
    }

    public function test_table_chain_immutable(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $t = $admin->db('shared')->table('posts')
            ->where('status', '==', 'published')
            ->orderBy('createdAt', 'desc')
            ->limit(10);
        $this->assertNotNull($t);
    }

    public function test_sql_unwraps_rows_payload(): void
    {
        $admin = new AdminClient('https://dummy.edgebase.fun', 'sk-test');
        $fake = new class(new HttpClient('https://dummy.edgebase.fun', 'sk-test')) extends GeneratedAdminApi {
            public function execute_sql(mixed $body = null): mixed
            {
                return ['rows' => [['id' => 'row-1']]];
            }
        };

        $property = new \ReflectionProperty($admin, 'adminCore');
        $property->setAccessible(true);
        $property->setValue($admin, $fake);

        $result = $admin->sql('shared', null, 'SELECT 1', []);
        $this->assertSame([['id' => 'row-1']], $result);
    }
}
