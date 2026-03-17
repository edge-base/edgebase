<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CoreFieldOpsE2ETest extends TestCase
{
    private static ?AdminClient $admin = null;
    private static string $prefix;
    private static array $createdIds = [];

    public static function setUpBeforeClass(): void
    {
        $baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        $serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$prefix = 'php-core-fieldops-' . time() . '-' . substr(uniqid(), -5);
        self::$admin = new AdminClient($baseUrl, $serviceKey);
    }

    public static function tearDownAfterClass(): void
    {
        if (!self::$admin) return;
        foreach (self::$createdIds as $id) {
            try { self::$admin->db('shared')->table('posts')->delete($id); } catch (\Throwable) {}
        }
    }

    public function test_increment_from_zero(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        $r = $table->insert(['title' => self::$prefix . '-inc0', 'viewCount' => 0]);
        self::$createdIds[] = $r['id'];
        $updated = $table->update($r['id'], ['viewCount' => FieldOps::increment(5)]);
        $this->assertSame(5, $updated['viewCount'] ?? null);
    }

    public function test_increment_accumulates(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        $r = $table->insert(['title' => self::$prefix . '-inc-acc', 'viewCount' => 10]);
        self::$createdIds[] = $r['id'];
        $table->update($r['id'], ['viewCount' => FieldOps::increment(3)]);
        $updated = $table->update($r['id'], ['viewCount' => FieldOps::increment(7)]);
        $this->assertSame(20, $updated['viewCount'] ?? null);
    }

    public function test_increment_negative_decrements(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        $r = $table->insert(['title' => self::$prefix . '-inc-neg', 'viewCount' => 10]);
        self::$createdIds[] = $r['id'];
        $updated = $table->update($r['id'], ['viewCount' => FieldOps::increment(-3)]);
        $this->assertSame(7, $updated['viewCount'] ?? null);
    }

    public function test_delete_field_removes_value(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        $r = $table->insert(['title' => self::$prefix . '-delf', 'extraField' => 'hello']);
        self::$createdIds[] = $r['id'];
        $updated = $table->update($r['id'], ['extraField' => FieldOps::deleteField()]);
        $this->assertNull($updated['extraField'] ?? null);
    }
}
