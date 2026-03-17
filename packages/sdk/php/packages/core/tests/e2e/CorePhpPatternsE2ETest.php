<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CorePhpPatternsE2ETest extends TestCase
{
    private static ?AdminClient $admin = null;
    private static string $prefix;
    private static array $createdIds = [];

    public static function setUpBeforeClass(): void
    {
        $baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        $serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$prefix = 'php-core-patterns-' . time() . '-' . substr(uniqid(), -5);
        self::$admin = new AdminClient($baseUrl, $serviceKey);
    }

    public static function tearDownAfterClass(): void
    {
        if (!self::$admin) return;
        foreach (self::$createdIds as $id) {
            try { self::$admin->db('shared')->table('posts')->delete($id); } catch (\Throwable) {}
        }
    }

    public function test_array_map_on_list_result(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        for ($i = 0; $i < 3; $i++) {
            $r = $table->insert(['title' => self::$prefix . "-map-{$i}"]);
            self::$createdIds[] = $r['id'];
        }
        $result = $table->where('title', '>=', self::$prefix . '-map-')
            ->where('title', '<=', self::$prefix . '-map-~')
            ->limit(10)->getList();
        $titles = array_map(fn($item) => $item['title'], $result->items);
        $this->assertIsArray($titles);
        foreach ($titles as $t) {
            $this->assertStringStartsWith(self::$prefix . '-map-', $t);
        }
    }

    public function test_json_encode_list_result_items(): void
    {
        $result = self::$admin->db('shared')->table('posts')->limit(2)->getList();
        $json = json_encode($result->items, JSON_THROW_ON_ERROR);
        $this->assertIsString($json);
        $decoded = json_decode($json, true);
        $this->assertIsArray($decoded);
    }

    public function test_array_filter_on_items(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        $items = [
            ['title' => self::$prefix . '-filt', 'viewCount' => 5],
            ['title' => self::$prefix . '-filt', 'viewCount' => 15],
        ];
        $created = $table->insertMany($items);
        foreach ($created as $r) { self::$createdIds[] = $r['id']; }
        $result = $table->where('title', '==', self::$prefix . '-filt')->limit(10)->getList();
        $highViews = array_filter($result->items, fn($item) => ($item['viewCount'] ?? 0) > 10);
        $this->assertIsArray($highViews);
    }

    public function test_associative_array_in_insert(): void
    {
        $data = [
            'title' => self::$prefix . '-assoc',
            'nested' => ['key1' => 'value1', 'key2' => 42],
        ];
        $r = self::$admin->db('shared')->table('posts')->insert($data);
        self::$createdIds[] = $r['id'];
        $fetched = self::$admin->db('shared')->table('posts')->getOne($r['id']);
        $this->assertSame('value1', $fetched['nested']['key1'] ?? null);
        $this->assertSame(42, $fetched['nested']['key2'] ?? null);
    }

    public function test_unicode_title(): void
    {
        $title = self::$prefix . '-' . '한국어-テスト-Emoji';
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => $title]);
        self::$createdIds[] = $r['id'];
        $fetched = self::$admin->db('shared')->table('posts')->getOne($r['id']);
        $this->assertSame($title, $fetched['title']);
    }

    public function test_large_batch_insert(): void
    {
        $items = [];
        for ($i = 0; $i < 20; $i++) {
            $items[] = ['title' => self::$prefix . "-large-{$i}"];
        }
        $result = self::$admin->db('shared')->table('posts')->insertMany($items);
        $this->assertCount(20, $result);
        foreach ($result as $r) {
            self::$createdIds[] = $r['id'];
        }
    }
}
