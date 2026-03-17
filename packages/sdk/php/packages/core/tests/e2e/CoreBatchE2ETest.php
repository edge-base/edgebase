<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CoreBatchE2ETest extends TestCase
{
    private static ?AdminClient $admin = null;
    private static string $prefix;
    private static array $createdIds = [];

    public static function setUpBeforeClass(): void
    {
        $baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        $serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$prefix = 'php-core-batch-' . time() . '-' . substr(uniqid(), -5);
        self::$admin = new AdminClient($baseUrl, $serviceKey);
    }

    public static function tearDownAfterClass(): void
    {
        if (!self::$admin) return;
        foreach (self::$createdIds as $id) {
            try { self::$admin->db('shared')->table('posts')->delete($id); } catch (\Throwable) {}
        }
    }

    public function test_insert_many_returns_array(): void
    {
        $items = [
            ['title' => self::$prefix . '-bm-1'],
            ['title' => self::$prefix . '-bm-2'],
            ['title' => self::$prefix . '-bm-3'],
        ];
        $result = self::$admin->db('shared')->table('posts')->insertMany($items);
        $this->assertIsArray($result);
        $this->assertCount(3, $result);
        foreach ($result as $r) {
            self::$createdIds[] = $r['id'];
        }
    }

    public function test_insert_many_each_has_id(): void
    {
        $items = [
            ['title' => self::$prefix . '-bm-id-1'],
            ['title' => self::$prefix . '-bm-id-2'],
        ];
        $result = self::$admin->db('shared')->table('posts')->insertMany($items);
        foreach ($result as $r) {
            $this->assertArrayHasKey('id', $r);
            $this->assertNotEmpty($r['id']);
            self::$createdIds[] = $r['id'];
        }
    }

    public function test_update_many_with_filter(): void
    {
        $unique = self::$prefix . '-bm-upd-' . uniqid();
        $table = self::$admin->db('shared')->table('posts');
        $items = [
            ['title' => $unique, 'viewCount' => 0],
            ['title' => $unique, 'viewCount' => 0],
        ];
        $created = $table->insertMany($items);
        foreach ($created as $r) {
            self::$createdIds[] = $r['id'];
        }
        $result = $table->where('title', '==', $unique)->updateMany(['viewCount' => 99]);
        $this->assertGreaterThanOrEqual(2, $result->totalProcessed);
        $this->assertGreaterThanOrEqual(2, $result->totalSucceeded);
    }

    public function test_delete_many_with_filter(): void
    {
        $unique = self::$prefix . '-bm-del-' . uniqid();
        $table = self::$admin->db('shared')->table('posts');
        $items = [
            ['title' => $unique],
            ['title' => $unique],
        ];
        $created = $table->insertMany($items);
        $ids = array_map(fn($r) => $r['id'], $created);
        $result = $table->where('title', '==', $unique)->deleteMany();
        $this->assertGreaterThanOrEqual(2, $result->totalProcessed);
        // Verify records are gone
        foreach ($ids as $id) {
            try {
                $table->getOne($id);
                $this->fail('Expected EdgeBaseException for deleted record ' . $id);
            } catch (EdgeBaseException) {
                $this->assertTrue(true);
            }
        }
    }

    public function test_insert_many_empty_array(): void
    {
        $result = self::$admin->db('shared')->table('posts')->insertMany([]);
        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }
}
