<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CoreDynamicNamespaceE2ETest extends TestCase
{
    private static ?AdminClient $admin = null;

    public static function setUpBeforeClass(): void
    {
        $baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        $serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$admin = new AdminClient($baseUrl, $serviceKey);
    }

    public function test_db_shared_namespace_works(): void
    {
        $result = self::$admin->db('shared')->table('posts')->limit(1)->getList();
        $this->assertInstanceOf(ListResult::class, $result);
    }

    public function test_db_returns_db_ref(): void
    {
        $db = self::$admin->db('shared');
        $this->assertNotNull($db);
    }

    public function test_table_returns_table_ref(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        $this->assertNotNull($table);
    }
}
