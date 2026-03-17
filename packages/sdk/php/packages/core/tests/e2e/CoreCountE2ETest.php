<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CoreCountE2ETest extends TestCase
{
    private static ?AdminClient $admin = null;
    private static string $prefix;
    private static array $createdIds = [];

    public static function setUpBeforeClass(): void
    {
        $baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        $serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$prefix = 'php-core-count-' . time() . '-' . substr(uniqid(), -5);
        self::$admin = new AdminClient($baseUrl, $serviceKey);

        $table = self::$admin->db('shared')->table('posts');
        for ($i = 0; $i < 3; $i++) {
            $r = $table->insert(['title' => self::$prefix . "-cnt-{$i}"]);
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

    public function test_count_returns_int(): void
    {
        $count = self::$admin->db('shared')->table('posts')->count();
        $this->assertIsInt($count);
    }

    public function test_count_is_non_negative(): void
    {
        $count = self::$admin->db('shared')->table('posts')->count();
        $this->assertGreaterThanOrEqual(0, $count);
    }

    public function test_count_with_filter(): void
    {
        $count = self::$admin->db('shared')->table('posts')
            ->where('title', '==', self::$prefix . '-cnt-0')
            ->count();
        $this->assertSame(1, $count);
    }

    public function test_count_with_no_match_returns_zero(): void
    {
        $count = self::$admin->db('shared')->table('posts')
            ->where('title', '==', 'nonexistent-php-count-' . uniqid())
            ->count();
        $this->assertSame(0, $count);
    }
}
