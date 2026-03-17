<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\FieldOps;
use EdgeBase\Core\ListResult;
use EdgeBase\Core\UpsertResult;
use EdgeBase\Core\BatchResult;
use EdgeBase\Core\OrBuilder;
use EdgeBase\Core\HttpClient;
use EdgeBase\Core\DbRef;
use EdgeBase\Core\StorageClient;
use EdgeBase\Core\StorageBucket;
use PHPUnit\Framework\TestCase;
class StorageUrlTest extends TestCase
{
    public function test_storage_client_returns_bucket(): void
    {
        $http = new HttpClient('https://example.edgebase.fun', 'sk-test');
        $storage = new StorageClient($http);
        $bucket = $storage->bucket('avatars');
        $this->assertInstanceOf(StorageBucket::class, $bucket);
    }

    public function test_bucket_name_property(): void
    {
        $http = new HttpClient('https://example.edgebase.fun', 'sk-test');
        $storage = new StorageClient($http);
        $bucket = $storage->bucket('my-bucket');
        $this->assertSame('my-bucket', $bucket->name);
    }

    public function test_get_url_returns_full_url(): void
    {
        $http = new HttpClient('https://example.edgebase.fun', 'sk-test');
        $bucket = new StorageBucket($http, 'avatars');
        $url = $bucket->getUrl('profile.png');
        $this->assertSame('https://example.edgebase.fun/api/storage/avatars/profile.png', $url);
    }

    public function test_get_url_encodes_special_chars(): void
    {
        $http = new HttpClient('https://example.edgebase.fun', 'sk-test');
        $bucket = new StorageBucket($http, 'files');
        $url = $bucket->getUrl('my file (1).txt');
        $this->assertStringContainsString('my%20file%20%281%29.txt', $url);
    }

    public function test_different_buckets_different_urls(): void
    {
        $http = new HttpClient('https://example.edgebase.fun', 'sk-test');
        $b1 = new StorageBucket($http, 'bucket-a');
        $b2 = new StorageBucket($http, 'bucket-b');
        $this->assertNotSame($b1->getUrl('file.txt'), $b2->getUrl('file.txt'));
    }
}
