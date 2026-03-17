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
class HttpClientTest extends TestCase
{
    protected function tearDown(): void
    {
        putenv('EDGEBASE_HTTP_TIMEOUT_MS');
        parent::tearDown();
    }

    public function test_constructor_creates_instance(): void
    {
        $client = new HttpClient('https://dummy.edgebase.fun', 'sk-test');
        $this->assertInstanceOf(HttpClient::class, $client);
    }

    public function test_context_defaults_to_null(): void
    {
        $client = new HttpClient('https://dummy.edgebase.fun');
        $this->assertNull($client->getContext());
    }

    public function test_set_context_and_get_context(): void
    {
        $client = new HttpClient('https://dummy.edgebase.fun');
        $ctx = ['userId' => 'u-123', 'role' => 'admin'];
        $client->setContext($ctx);
        $this->assertSame($ctx, $client->getContext());
    }

    public function test_set_context_to_null(): void
    {
        $client = new HttpClient('https://dummy.edgebase.fun');
        $client->setContext(['key' => 'val']);
        $client->setContext(null);
        $this->assertNull($client->getContext());
    }

    public function test_build_public_url(): void
    {
        $client = new HttpClient('https://example.edgebase.fun');
        $url = $client->buildPublicUrl('/api/storage/bucket/file.png');
        $this->assertSame('https://example.edgebase.fun/api/storage/bucket/file.png', $url);
    }

    public function test_build_public_url_trims_trailing_slash(): void
    {
        $client = new HttpClient('https://example.edgebase.fun/');
        $url = $client->buildPublicUrl('/api/storage/bucket/file.png');
        $this->assertSame('https://example.edgebase.fun/api/storage/bucket/file.png', $url);
    }

    public function test_empty_service_key_allowed(): void
    {
        $client = new HttpClient('https://dummy.edgebase.fun', '');
        $this->assertInstanceOf(HttpClient::class, $client);
    }

    public function test_timeout_uses_env_override_when_present(): void
    {
        putenv('EDGEBASE_HTTP_TIMEOUT_MS=12000');
        $client = new HttpClient('https://dummy.edgebase.fun', 'sk-test');
        $property = new \ReflectionProperty(HttpClient::class, 'timeoutMs');
        $property->setAccessible(true);
        $this->assertSame(12000, $property->getValue($client));
    }

    public function test_timeout_stays_disabled_when_env_is_invalid(): void
    {
        putenv('EDGEBASE_HTTP_TIMEOUT_MS=invalid');
        $client = new HttpClient('https://dummy.edgebase.fun', 'sk-test');
        $property = new \ReflectionProperty(HttpClient::class, 'timeoutMs');
        $property->setAccessible(true);
        $this->assertSame(0, $property->getValue($client));
    }

    public function test_auth_headers_request_connection_close(): void
    {
        $client = new HttpClient('https://dummy.edgebase.fun', 'sk-test');
        $method = new \ReflectionMethod(HttpClient::class, 'authHeaders');
        $method->setAccessible(true);
        $headers = $method->invoke($client, true);

        $this->assertContains('Connection: close', $headers);
    }
}
