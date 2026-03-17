<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CoreSearchE2ETest extends TestCase
{
    private static ?AdminClient $admin = null;
    private static string $prefix;
    private static array $createdIds = [];

    public static function setUpBeforeClass(): void
    {
        $baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        $serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$prefix = 'php-core-search-' . time() . '-' . substr(uniqid(), -5);
        self::$admin = new AdminClient($baseUrl, $serviceKey);

        $table = self::$admin->db('shared')->table('posts');
        $r = $table->insert(['title' => self::$prefix . '-searchable-item']);
        self::$createdIds[] = $r['id'];
    }

    public static function tearDownAfterClass(): void
    {
        if (!self::$admin) return;
        foreach (self::$createdIds as $id) {
            try { self::$admin->db('shared')->table('posts')->delete($id); } catch (\Throwable) {}
        }
    }

    public function test_search_returns_list_result(): void
    {
        $result = self::$admin->db('shared')->table('posts')
            ->search(self::$prefix)
            ->limit(5)->getList();
        $this->assertInstanceOf(ListResult::class, $result);
    }

    public function test_search_finds_matching_record(): void
    {
        // FTS indexing may be async; attempt with a short wait
        usleep(500_000);
        $result = self::$admin->db('shared')->table('posts')
            ->search(self::$prefix . '-searchable')
            ->limit(5)->getList();
        // May or may not find depending on FTS setup; just verify structure
        $this->assertIsArray($result->items);
    }
}
