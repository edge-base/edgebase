<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CoreErrorHandlingE2ETest extends TestCase
{
    private static ?AdminClient $admin = null;

    public static function setUpBeforeClass(): void
    {
        $baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        $serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$admin = new AdminClient($baseUrl, $serviceKey);
    }

    public function test_get_nonexistent_record_throws(): void
    {
        $this->expectException(EdgeBaseException::class);
        self::$admin->db('shared')->table('posts')->getOne('nonexistent-php-core-' . uniqid());
    }

    public function test_update_nonexistent_record_throws(): void
    {
        $this->expectException(EdgeBaseException::class);
        self::$admin->db('shared')->table('posts')->update('nonexistent-php-upd-' . uniqid(), ['title' => 'X']);
    }

    public function test_invalid_service_key_throws(): void
    {
        $baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        $bad = new AdminClient($baseUrl, 'invalid-service-key');
        $this->expectException(EdgeBaseException::class);
        $bad->db('shared')->table('posts')->insert(['title' => 'should-fail']);
    }

    public function test_exception_has_status_code(): void
    {
        try {
            self::$admin->db('shared')->table('posts')->getOne('nonexistent-php-status-' . uniqid());
            $this->fail('Expected EdgeBaseException');
        } catch (EdgeBaseException $e) {
            $this->assertGreaterThanOrEqual(400, $e->getStatusCode());
        }
    }

    public function test_exception_has_message(): void
    {
        try {
            self::$admin->db('shared')->table('posts')->getOne('nonexistent-php-msg-' . uniqid());
            $this->fail('Expected EdgeBaseException');
        } catch (EdgeBaseException $e) {
            $this->assertNotEmpty($e->getMessage());
        }
    }

    public function test_exception_is_runtime_exception(): void
    {
        try {
            self::$admin->db('shared')->table('posts')->getOne('nonexistent-php-rt-' . uniqid());
            $this->fail('Expected EdgeBaseException');
        } catch (EdgeBaseException $e) {
            $this->assertInstanceOf(\RuntimeException::class, $e);
        }
    }
}
