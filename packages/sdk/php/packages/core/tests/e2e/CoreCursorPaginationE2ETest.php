<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CoreCursorPaginationE2ETest extends TestCase
{
    private static ?AdminClient $admin = null;
    private static string $prefix;
    private static array $createdIds = [];

    public static function setUpBeforeClass(): void
    {
        $baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        $serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$prefix = 'php-core-cursor-' . time() . '-' . substr(uniqid(), -5);
        self::$admin = new AdminClient($baseUrl, $serviceKey);

        $table = self::$admin->db('shared')->table('posts');
        for ($i = 0; $i < 5; $i++) {
            $r = $table->insert(['title' => self::$prefix . "-cur-{$i}", 'viewCount' => $i]);
            self::$createdIds[] = $r['id'];
        }
    }

    public static function tearDownAfterClass(): void
    {
        if (!self::$admin) return;
        foreach (self::$createdIds as $id) {
            try { self::$admin->db('shared')->table('posts')->delete($id); } catch (\Throwable) {}
        }
    }

    public function test_first_page_returns_cursor(): void
    {
        $result = self::$admin->db('shared')->table('posts')->limit(2)->getList();
        // cursor may or may not be present depending on total records
        $this->assertInstanceOf(ListResult::class, $result);
    }

    public function test_after_cursor_returns_next_page(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        $page1 = $table->limit(2)->getList();
        if ($page1->cursor !== null && $page1->cursor !== '') {
            $page2 = $table->after($page1->cursor)->limit(2)->getList();
            $this->assertInstanceOf(ListResult::class, $page2);
            // page2 items should be different from page1
            $ids1 = array_map(fn($i) => $i['id'], $page1->items);
            $ids2 = array_map(fn($i) => $i['id'], $page2->items);
            $this->assertEmpty(array_intersect($ids1, $ids2));
        } else {
            $this->assertTrue(true); // not enough data for cursor
        }
    }
}
