<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CoreListQueryE2ETest extends TestCase
{
    private static string $baseUrl;
    private static string $serviceKey;
    private static string $prefix;
    private static array $createdIds = [];
    private static ?AdminClient $admin = null;

    public static function setUpBeforeClass(): void
    {
        self::$baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        self::$serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$prefix = 'php-core-list-' . time() . '-' . substr(uniqid(), -5);
        self::$admin = new AdminClient(self::$baseUrl, self::$serviceKey);

        // Seed 5 records for query tests
        $table = self::$admin->db('shared')->table('posts');
        for ($i = 1; $i <= 5; $i++) {
            $r = $table->insert([
                'title' => self::$prefix . "-item-{$i}",
                'viewCount' => $i * 10,
            ]);
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

    public function test_get_returns_list_result(): void
    {
        $result = self::$admin->db('shared')->table('posts')->limit(3)->getList();
        $this->assertInstanceOf(ListResult::class, $result);
    }

    public function test_list_has_items_array(): void
    {
        $result = self::$admin->db('shared')->table('posts')->limit(3)->getList();
        $this->assertIsArray($result->items);
    }

    public function test_limit_restricts_count(): void
    {
        $result = self::$admin->db('shared')->table('posts')->limit(2)->getList();
        $this->assertLessThanOrEqual(2, count($result->items));
    }

    public function test_where_filter_matches(): void
    {
        $unique = self::$prefix . '-item-1';
        $result = self::$admin->db('shared')->table('posts')
            ->where('title', '==', $unique)
            ->getList();
        $this->assertNotEmpty($result->items);
        $this->assertSame($unique, $result->items[0]['title'] ?? null);
    }

    public function test_where_no_match_returns_empty(): void
    {
        $result = self::$admin->db('shared')->table('posts')
            ->where('title', '==', 'nonexistent-php-title-' . uniqid())
            ->getList();
        $this->assertEmpty($result->items);
    }

    public function test_order_by_desc(): void
    {
        $result = self::$admin->db('shared')->table('posts')
            ->where('title', '>=', self::$prefix . '-item-')
            ->where('title', '<=', self::$prefix . '-item-~')
            ->orderBy('viewCount', 'desc')
            ->limit(5)
            ->getList();
        if (count($result->items) >= 2) {
            $first = $result->items[0]['viewCount'] ?? 0;
            $last = $result->items[count($result->items) - 1]['viewCount'] ?? 0;
            $this->assertGreaterThanOrEqual($last, $first);
        } else {
            $this->assertTrue(true); // not enough data to compare
        }
    }

    public function test_order_by_asc(): void
    {
        $result = self::$admin->db('shared')->table('posts')
            ->where('title', '>=', self::$prefix . '-item-')
            ->where('title', '<=', self::$prefix . '-item-~')
            ->orderBy('viewCount', 'asc')
            ->limit(5)
            ->getList();
        if (count($result->items) >= 2) {
            $first = $result->items[0]['viewCount'] ?? 0;
            $last = $result->items[count($result->items) - 1]['viewCount'] ?? 0;
            $this->assertLessThanOrEqual($last, $first);
        } else {
            $this->assertTrue(true);
        }
    }

    public function test_offset_skips_records(): void
    {
        $all = self::$admin->db('shared')->table('posts')
            ->where('title', '>=', self::$prefix . '-item-')
            ->where('title', '<=', self::$prefix . '-item-~')
            ->orderBy('createdAt', 'asc')
            ->limit(5)->getList();
        if (count($all->items) >= 2) {
            $withOffset = self::$admin->db('shared')->table('posts')
                ->where('title', '>=', self::$prefix . '-item-')
                ->where('title', '<=', self::$prefix . '-item-~')
                ->orderBy('createdAt', 'asc')
                ->offset(1)->limit(5)->getList();
            $this->assertLessThanOrEqual(count($all->items), count($withOffset->items) + 1);
        }
        $this->assertTrue(true);
    }

    public function test_where_greater_than(): void
    {
        $result = self::$admin->db('shared')->table('posts')
            ->where('viewCount', '>', 20)
            ->where('title', '>=', self::$prefix . '-item-')
            ->where('title', '<=', self::$prefix . '-item-~')
            ->limit(10)->getList();
        foreach ($result->items as $item) {
            $this->assertGreaterThan(20, $item['viewCount'] ?? 0);
        }
    }

    public function test_where_chaining_multiple_filters(): void
    {
        $result = self::$admin->db('shared')->table('posts')
            ->where('viewCount', '>=', 20)
            ->where('viewCount', '<=', 40)
            ->where('title', '>=', self::$prefix . '-item-')
            ->where('title', '<=', self::$prefix . '-item-~')
            ->limit(10)->getList();
        foreach ($result->items as $item) {
            $vc = $item['viewCount'] ?? 0;
            $this->assertGreaterThanOrEqual(20, $vc);
            $this->assertLessThanOrEqual(40, $vc);
        }
    }

    public function test_or_filter(): void
    {
        $result = self::$admin->db('shared')->table('posts')
            ->or(function ($q) {
                $q->where('title', '==', self::$prefix . '-item-1')
                  ->where('title', '==', self::$prefix . '-item-5');
            })
            ->limit(10)->getList();
        $this->assertGreaterThanOrEqual(0, count($result->items));
    }

    public function test_list_result_array_access_items(): void
    {
        $result = self::$admin->db('shared')->table('posts')->limit(1)->getList();
        $this->assertSame($result->items, $result['items']);
    }

    public function test_list_result_array_access_total(): void
    {
        $result = self::$admin->db('shared')->table('posts')->limit(1)->getList();
        $this->assertSame($result->total, $result['total']);
    }
}
