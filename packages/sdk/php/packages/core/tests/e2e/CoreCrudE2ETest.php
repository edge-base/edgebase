<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CoreCrudE2ETest extends TestCase
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
        self::$prefix = 'php-core-crud-' . time() . '-' . substr(uniqid(), -5);
        self::$admin = new AdminClient(self::$baseUrl, self::$serviceKey);
    }

    public static function tearDownAfterClass(): void
    {
        if (!self::$admin) return;
        foreach (self::$createdIds as $id) {
            try { self::$admin->db('shared')->table('posts')->delete($id); } catch (\Throwable) {}
        }
    }

    public function test_insert_returns_record_with_id(): void
    {
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => self::$prefix . '-c1']);
        $this->assertArrayHasKey('id', $r);
        $this->assertNotEmpty($r['id']);
        self::$createdIds[] = $r['id'];
    }

    public function test_insert_stores_correct_title(): void
    {
        $title = self::$prefix . '-c2';
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => $title]);
        $this->assertSame($title, $r['title'] ?? null);
        self::$createdIds[] = $r['id'];
    }

    public function test_insert_returns_created_at(): void
    {
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => self::$prefix . '-c3']);
        $this->assertArrayHasKey('createdAt', $r);
        self::$createdIds[] = $r['id'];
    }

    public function test_get_one_fetches_correct_record(): void
    {
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => self::$prefix . '-get1']);
        self::$createdIds[] = $r['id'];
        $fetched = self::$admin->db('shared')->table('posts')->getOne($r['id']);
        $this->assertSame($r['id'], $fetched['id']);
        $this->assertSame(self::$prefix . '-get1', $fetched['title']);
    }

    public function test_update_modifies_field(): void
    {
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => self::$prefix . '-upd-orig']);
        self::$createdIds[] = $r['id'];
        $updated = self::$admin->db('shared')->table('posts')->update($r['id'], ['title' => self::$prefix . '-upd-new']);
        $this->assertSame(self::$prefix . '-upd-new', $updated['title'] ?? null);
    }

    public function test_update_preserves_other_fields(): void
    {
        $r = self::$admin->db('shared')->table('posts')->insert([
            'title' => self::$prefix . '-upd-preserve',
            'viewCount' => 42,
        ]);
        self::$createdIds[] = $r['id'];
        $updated = self::$admin->db('shared')->table('posts')->update($r['id'], ['title' => self::$prefix . '-upd-p2']);
        $this->assertSame(42, $updated['viewCount'] ?? null);
    }

    public function test_delete_removes_record(): void
    {
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => self::$prefix . '-del1']);
        self::$admin->db('shared')->table('posts')->delete($r['id']);
        $this->expectException(EdgeBaseException::class);
        self::$admin->db('shared')->table('posts')->getOne($r['id']);
    }

    public function test_insert_get_update_delete_chain(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        $r = $table->insert(['title' => self::$prefix . '-chain', 'viewCount' => 0]);
        $id = $r['id'];
        $got = $table->getOne($id);
        $this->assertSame($id, $got['id']);
        $upd = $table->update($id, ['viewCount' => 10]);
        $this->assertSame(10, $upd['viewCount'] ?? null);
        $table->delete($id);
        $this->expectException(EdgeBaseException::class);
        $table->getOne($id);
    }
}
