<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CoreUpsertE2ETest extends TestCase
{
    private static ?AdminClient $admin = null;
    private static string $prefix;
    private static array $createdIds = [];

    public static function setUpBeforeClass(): void
    {
        $baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        $serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$prefix = 'php-core-upsert-' . time() . '-' . substr(uniqid(), -5);
        self::$admin = new AdminClient($baseUrl, $serviceKey);
    }

    public static function tearDownAfterClass(): void
    {
        if (!self::$admin) return;
        foreach (self::$createdIds as $id) {
            try { self::$admin->db('shared')->table('posts')->delete($id); } catch (\Throwable) {}
        }
    }

    public function test_upsert_new_record(): void
    {
        $result = self::$admin->db('shared')->table('posts')
            ->upsert(['title' => self::$prefix . '-ups-new']);
        $this->assertInstanceOf(UpsertResult::class, $result);
        $this->assertNotEmpty($result['id']);
        self::$createdIds[] = $result['id'];
    }

    public function test_upsert_result_array_access(): void
    {
        $result = self::$admin->db('shared')->table('posts')
            ->upsert(['title' => self::$prefix . '-ups-arr']);
        $this->assertNotNull($result['id']);
        $this->assertSame($result->record['id'], $result['id']);
        self::$createdIds[] = $result['id'];
    }

    public function test_upsert_many_returns_array(): void
    {
        $items = [
            ['title' => self::$prefix . '-ups-many-1'],
            ['title' => self::$prefix . '-ups-many-2'],
        ];
        $result = self::$admin->db('shared')->table('posts')->upsertMany($items);
        $this->assertIsArray($result);
        $this->assertCount(2, $result);
        foreach ($result as $r) {
            self::$createdIds[] = $r['id'];
        }
    }
}
