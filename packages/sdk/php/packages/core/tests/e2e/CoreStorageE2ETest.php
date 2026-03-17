<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Admin\AdminClient;
use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use PHPUnit\Framework\TestCase;
class CoreStorageE2ETest extends TestCase
{
    private static ?AdminClient $admin = null;
    private static string $prefix;

    public static function setUpBeforeClass(): void
    {
        $baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        $serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$prefix = 'php-core-storage-' . time() . '-' . substr(uniqid(), -5);
        self::$admin = new AdminClient($baseUrl, $serviceKey);
    }

    public function test_upload_and_download(): void
    {
        $bucket = self::$admin->storage->bucket('test');
        $path = self::$prefix . '/hello.txt';
        $content = 'Hello from PHP Core E2E ' . time();
        $bucket->upload($path, $content, 'text/plain');
        $downloaded = $bucket->download($path);
        $this->assertSame($content, $downloaded);
        // cleanup
        try { $bucket->delete($path); } catch (\Throwable) {}
    }

    public function test_upload_binary_data(): void
    {
        $bucket = self::$admin->storage->bucket('test');
        $path = self::$prefix . '/binary.bin';
        $content = random_bytes(128);
        $bucket->upload($path, $content, 'application/octet-stream');
        $downloaded = $bucket->download($path);
        $this->assertSame($content, $downloaded);
        try { $bucket->delete($path); } catch (\Throwable) {}
    }

    public function test_list_files(): void
    {
        $bucket = self::$admin->storage->bucket('test');
        $path = self::$prefix . '/list-test.txt';
        $bucket->upload($path, 'list test', 'text/plain');
        $files = $bucket->list(self::$prefix . '/');
        $this->assertIsArray($files);
        try { $bucket->delete($path); } catch (\Throwable) {}
    }

    public function test_delete_file(): void
    {
        $bucket = self::$admin->storage->bucket('test');
        $path = self::$prefix . '/delete-me.txt';
        $bucket->upload($path, 'delete me', 'text/plain');
        $result = $bucket->delete($path);
        $this->assertIsArray($result);
    }

    public function test_get_url_returns_string(): void
    {
        $bucket = self::$admin->storage->bucket('test');
        $url = $bucket->getUrl('some/file.png');
        $this->assertIsString($url);
        $this->assertStringContainsString('/api/storage/test/', $url);
    }

    public function test_get_url_contains_file_path(): void
    {
        $bucket = self::$admin->storage->bucket('avatars');
        $url = $bucket->getUrl('profile.jpg');
        $this->assertStringContainsString('profile.jpg', $url);
    }

    public function test_bucket_name_property(): void
    {
        $bucket = self::$admin->storage->bucket('my-bucket');
        $this->assertSame('my-bucket', $bucket->name);
    }
}
