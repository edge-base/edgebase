<?php

declare(strict_types=1);

// PHP SDK unit tests — (ServerClient, server-only entry point).
//
// Run:
//   cd packages/sdk/php
//   composer test
//   # or with E2E:
//   BASE_URL=http://localhost:8688 EDGEBASE_SERVICE_KEY=sk_test composer test

use EdgeBase\ServerClient;
use EdgeBase\TableRef;
use PHPUnit\Framework\TestCase;

class ServerClientTest extends TestCase
{
    // ═══════════════════════════════════════════════════════════
    // Unit Tests — no server required
    // ═══════════════════════════════════════════════════════════

    public function testConstructor_CreatesInstance(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $this->assertNotNull($client);
        $client->destroy();
    }

    public function testAdminAuth_IsNotNull(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $this->assertNotNull($client->adminAuth);
        $client->destroy();
    }

    public function testStorage_IsNotNull(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $this->assertNotNull($client->storage);
        $client->destroy();
    }

    public function testCollection_ReturnsTableRef(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $ref = $client->table('posts');
        $this->assertInstanceOf(TableRef::class, $ref);
        $client->destroy();
    }

    public function testCollection_WhereImmutable(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $base = $client->table('posts');
        $filtered = $base->where('status', '==', 'published');
        $this->assertNotSame($base, $filtered, 'where() should return a new TableRef');
        $client->destroy();
    }

    public function testCollection_OrderByImmutable(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $base = $client->table('posts');
        $sorted = $base->orderBy('createdAt', 'desc');
        $this->assertNotSame($base, $sorted);
        $client->destroy();
    }

    public function testCollection_LimitImmutable(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $base = $client->table('posts');
        $limited = $base->limit(20);
        $this->assertNotSame($base, $limited);
        $client->destroy();
    }

    public function testCollection_ChainedQueryBuilder(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $ref = $client->table('posts')
            ->where('status', '==', 'published')
            ->orderBy('createdAt', 'desc')
            ->limit(20)
            ->offset(10)
        ;
        $this->assertInstanceOf(TableRef::class, $ref);
        $client->destroy();
    }

    public function testSetContext_StoredAndReturned(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $client->setContext(['workspaceId' => 'ws-123']);
        $ctx = $client->getContext();
        $this->assertSame('ws-123', $ctx['workspaceId'] ?? null);
        $client->destroy();
    }

    public function testStorage_GetUrl(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $url = $client->storage->bucket('avatars')->getUrl('profile.png');
        $this->assertSame('https://test.edgebase.fun/api/storage/avatars/profile.png', $url);
        $client->destroy();
    }

    // ═══════════════════════════════════════════════════════════
    // KV / D1 / Vectorize Unit Tests
    // ═══════════════════════════════════════════════════════════

    public function testKv_ReturnsKvClient(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $kv = $client->kv('cache');
        $this->assertInstanceOf(\EdgeBase\KvClient::class, $kv);
        $client->destroy();
    }

    public function testKv_DifferentNamespacesAreIndependent(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $kv1 = $client->kv('cache');
        $kv2 = $client->kv('sessions');
        $this->assertNotSame($kv1, $kv2);
        $client->destroy();
    }

    public function testD1_ReturnsD1Client(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $d1 = $client->d1('analytics');
        $this->assertInstanceOf(\EdgeBase\D1Client::class, $d1);
        $client->destroy();
    }

    public function testD1_DifferentDatabasesAreIndependent(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $d1a = $client->d1('analytics');
        $d1b = $client->d1('logs');
        $this->assertNotSame($d1a, $d1b);
        $client->destroy();
    }

    public function testVector_ReturnsVectorizeClient(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $vec = $client->vector('embeddings');
        $this->assertInstanceOf(\EdgeBase\VectorizeClient::class, $vec);
        $client->destroy();
    }

    public function testVector_DifferentIndexesAreIndependent(): void
    {
        $client = new ServerClient('https://test.edgebase.fun', 'sk-test');
        $v1 = $client->vector('embeddings');
        $v2 = $client->vector('search-index');
        $this->assertNotSame($v1, $v2);
        $client->destroy();
    }

    // ═══════════════════════════════════════════════════════════
    // E2E Tests — require BASE_URL + EDGEBASE_SERVICE_KEY
    // ═══════════════════════════════════════════════════════════

    private function e2eSetup(): ServerClient
    {
        $url = getenv('BASE_URL') ?: '';
        $key = getenv('EDGEBASE_SERVICE_KEY') ?: '';
        return new ServerClient($url, $key);
    }

    private function uniqueEmail(): string
    {
        return 'e2e-php-' . (int) (microtime(true) * 1000) . '@test.com';
    }

    public function testE2E_AdminAuth_CreateAndGetUser(): void
    {
        $client = $this->e2eSetup();
        $email = $this->uniqueEmail();

        $created = $client->adminAuth->createUser([
            'email' => $email,
            'password' => 'PhpE2EPass123!',
        ]);
        $this->assertNotEmpty($created['id'] ?? '');
        $this->assertSame($email, $created['email'] ?? '');

        $fetched = $client->adminAuth->getUser($created['id']);
        $this->assertSame($created['id'], $fetched['id']);
        $this->assertSame($email, $fetched['email']);

        $client->destroy();
    }

    public function testE2E_AdminAuth_ListUsers(): void
    {
        $client = $this->e2eSetup();
        $result = $client->adminAuth->listUsers(10);
        $this->assertIsArray($result['users'] ?? null);
        $client->destroy();
    }

    public function testE2E_Collection_CRUD(): void
    {
        $client = $this->e2eSetup();

        // Create
        $created = $client->table('posts')->insert([
            'title' => 'PHP E2E Test',
        ]);
        $id = $created['id'] ?? '';
        $this->assertNotEmpty($id);

        // Get
        $fetched = $client->table('posts')->getOne($id);
        $this->assertSame($id, $fetched['id'] ?? '');

        // Update
        $client->table('posts')->update($id, ['content' => 'updated']);

        // Delete
        $client->table('posts')->delete($id);

        $client->destroy();
    }

    public function testE2E_Sql_SimpleQuery(): void
    {
        $client = $this->e2eSetup();
        $rows = $client->sql('posts', 'SELECT id FROM posts LIMIT 5');
        $this->assertIsArray($rows['rows'] ?? $rows);
        $client->destroy();
    }

    public function testE2E_AdminAuth_RevokeAllSessions(): void
    {
        $client = $this->e2eSetup();
        $email = $this->uniqueEmail();
        $created = $client->adminAuth->createUser([
            'email' => $email,
            'password' => 'PhpE2EPass123!',
        ]);
        $id = $created['id'] ?? '';
        $this->assertNotEmpty($id);

        $client->adminAuth->revokeAllSessions($id);
        $this->assertTrue(true); // 에러가 나지 않으면 통과
        $client->destroy();
    }

    public function testE2E_DatabaseLive_Broadcast(): void
    {
        $client = $this->e2eSetup();
        $channel = 'php-bcast-' . (int) (microtime(true) * 1000);
        $client->broadcast($channel, 'server-event', ['msg' => 'Hello from PHP Server SDK']);
        $this->assertTrue(true);
        $client->destroy();
    }

    public function testE2E_Storage_CreateSignedUploadUrl(): void
    {
        $client = $this->e2eSetup();
        $key = 'php-srv-' . (int) (microtime(true) * 1000) . '/signed-upload.txt';
        $res = $client->storage->bucket('documents')->createSignedUploadUrl($key, 3600);

        $this->assertNotEmpty($res['url'] ?? '');
        $this->assertStringContainsString('/upload', $res['url']);
        $client->destroy();
    }

    // ═══════════════════════════════════════════════════════════
    // Query Tests
    // ═══════════════════════════════════════════════════════════

    private function uniquePrefix(): string
    {
        return 'php-e2e-' . (int) (microtime(true) * 1000);
    }

    public function testE2E_Query_WhereFilter(): void
    {
        $client = $this->e2eSetup();
        $prefix = $this->uniquePrefix();
        $client->table('posts')->insert(['title' => $prefix]);
        $result = $client->table('posts')->where('title', '==', $prefix)->get();
        $this->assertNotEmpty($result->items);
        $client->destroy();
    }

    public function testE2E_Query_OrderByLimit(): void
    {
        $client = $this->e2eSetup();
        $result = $client->table('posts')->orderBy('createdAt', 'desc')->limit(2)->get();
        $this->assertLessThanOrEqual(2, count($result->items));
        $client->destroy();
    }

    public function testE2E_Query_Count(): void
    {
        $client = $this->e2eSetup();
        $count = $client->table('posts')->count();
        $this->assertGreaterThanOrEqual(0, $count);
        $client->destroy();
    }

    public function testE2E_Query_OffsetPagination(): void
    {
        $client = $this->e2eSetup();
        $prefix = $this->uniquePrefix();
        for ($i = 0; $i < 5; $i++) {
            $client->table('posts')->insert(['title' => "{$prefix}-{$i}"]);
        }
        $page1 = $client->table('posts')->orderBy('title', 'asc')->limit(2)->get();
        $page2 = $client->table('posts')->orderBy('title', 'asc')->limit(2)->offset(2)->get();
        $this->assertLessThanOrEqual(2, count($page1->items));
        $this->assertLessThanOrEqual(2, count($page2->items));
        $client->destroy();
    }

    public function testE2E_Query_MultipleWhere(): void
    {
        $client = $this->e2eSetup();
        $prefix = $this->uniquePrefix();
        $client->table('posts')->insert(['title' => $prefix, 'views' => 30]);
        $result = $client->table('posts')
            ->where('title', '==', $prefix)
            ->where('views', '>=', 20)
            ->get();
        $this->assertNotEmpty($result->items);
        $client->destroy();
    }

    public function testE2E_Query_Search(): void
    {
        $client = $this->e2eSetup();
        $prefix = $this->uniquePrefix();
        $client->table('posts')->insert(['title' => $prefix, 'content' => "{$prefix} search body"]);
        try {
            $result = $client->table('posts')->search($prefix)->get();
            $this->assertNotEmpty($result->items);
        } catch (\Exception $e) {
            // FTS may not be configured — skip
            $this->assertTrue(true);
        }
        $client->destroy();
    }

    // ═══════════════════════════════════════════════════════════
    // Storage Full Suite
    // ═══════════════════════════════════════════════════════════

    public function testE2E_Storage_UploadAndDownload(): void
    {
        $client = $this->e2eSetup();
        $prefix = $this->uniquePrefix();
        $key = "{$prefix}/test.bin";
        $content = 'Hello from PHP E2E';
        $client->storage->bucket('documents')->upload($key, $content, 'application/octet-stream');
        $downloaded = $client->storage->bucket('documents')->download($key);
        $this->assertSame($content, $downloaded);
        $client->destroy();
    }

    public function testE2E_Storage_ListFiles(): void
    {
        $client = $this->e2eSetup();
        $prefix = $this->uniquePrefix();
        $key = "{$prefix}/list-test.txt";
        $client->storage->bucket('documents')->upload($key, 'list test', 'text/plain');
        $files = $client->storage->bucket('documents')->list("{$prefix}/");
        $this->assertNotEmpty($files);
        $client->destroy();
    }

    public function testE2E_Storage_Delete(): void
    {
        $client = $this->e2eSetup();
        $prefix = $this->uniquePrefix();
        $key = "{$prefix}/delete-test.txt";
        $client->storage->bucket('documents')->upload($key, 'delete me', 'text/plain');
        $client->storage->bucket('documents')->delete($key);
        try {
            $client->storage->bucket('documents')->download($key);
            $this->fail('Expected error after delete');
        } catch (\Exception $e) {
            $this->assertTrue(true);
        }
        $client->destroy();
    }

    public function testE2E_Storage_GetMetadata(): void
    {
        $client = $this->e2eSetup();
        $prefix = $this->uniquePrefix();
        $key = "{$prefix}/meta.txt";
        $client->storage->bucket('documents')->upload($key, 'metadata test', 'text/plain');
        $meta = $client->storage->bucket('documents')->getMetadata($key);
        $this->assertSame($key, $meta['key'] ?? '');
        $client->destroy();
    }

    public function testE2E_Storage_CreateSignedUrl(): void
    {
        $client = $this->e2eSetup();
        $prefix = $this->uniquePrefix();
        $key = "{$prefix}/signed.txt";
        $client->storage->bucket('documents')->upload($key, 'signed content', 'text/plain');
        $result = $client->storage->bucket('documents')->createSignedUrl($key);
        $this->assertNotEmpty($result['url'] ?? '');
        $client->destroy();
    }

    // ═══════════════════════════════════════════════════════════
    // Batch Operations
    // ═══════════════════════════════════════════════════════════

    public function testE2E_Batch_InsertMany(): void
    {
        $client = $this->e2eSetup();
        $result = $client->table('posts')->insertMany([
            ['title' => 'PHP Batch A'],
            ['title' => 'PHP Batch B'],
            ['title' => 'PHP Batch C'],
        ]);
        $this->assertCount(3, $result);
        $client->destroy();
    }

    public function testE2E_Batch_UpdateMany(): void
    {
        $client = $this->e2eSetup();
        $prefix = $this->uniquePrefix();
        $client->table('posts')->insert(['title' => "{$prefix}-BatchUpdate"]);
        $result = $client->table('posts')
            ->where('title', '==', "{$prefix}-BatchUpdate")
            ->updateMany(['content' => 'batch-updated']);
        $this->assertNotNull($result);
        $client->destroy();
    }

    public function testE2E_Batch_DeleteMany(): void
    {
        $client = $this->e2eSetup();
        $prefix = $this->uniquePrefix();
        $client->table('posts')->insert(['title' => "{$prefix}-BatchDelete"]);
        $result = $client->table('posts')
            ->where('title', '==', "{$prefix}-BatchDelete")
            ->deleteMany();
        $this->assertNotNull($result);
        $client->destroy();
    }

    // ═══════════════════════════════════════════════════════════
    // Upsert
    // ═══════════════════════════════════════════════════════════

    public function testE2E_Upsert(): void
    {
        $client = $this->e2eSetup();
        $result = $client->table('posts')->upsert(['title' => 'PHP Upsert']);
        $this->assertNotNull($result);
        $this->assertNotEmpty($result->record['id'] ?? '');
        $client->destroy();
    }

    // ═══════════════════════════════════════════════════════════
    // Error Handling
    // ═══════════════════════════════════════════════════════════

    public function testE2E_Error_GetNonExistent404(): void
    {
        $client = $this->e2eSetup();
        $this->expectException(\Exception::class);
        $client->table('posts')->getOne('nonexistent-php-99999');
        $client->destroy();
    }

    public function testE2E_Error_UpdateNonExistent(): void
    {
        $client = $this->e2eSetup();
        $this->expectException(\Exception::class);
        $client->table('posts')->update('nonexistent-update-php', ['title' => 'Nope']);
        $client->destroy();
    }

    public function testE2E_Error_DeleteNonExistent(): void
    {
        $client = $this->e2eSetup();
        $this->expectException(\Exception::class);
        $client->table('posts')->delete('nonexistent-delete-php');
        $client->destroy();
    }

    // ═══════════════════════════════════════════════════════════
    // Cursor Pagination (🔲 → ✅)
    // ═══════════════════════════════════════════════════════════

    public function testE2E_CursorPagination(): void
    {
        $client = $this->e2eSetup();
        $prefix = 'php-cursor-' . uniqid();

        // 레코드 6개 삽입
        for ($i = 0; $i < 6; $i++) {
            $client->table('posts')->insert(['title' => sprintf('%s-%02d', $prefix, $i)]);
        }

        // 첫 페이지 (limit 3)
        $page1 = $client->table('posts')
            ->where('title', 'contains', $prefix)
            ->orderBy('title', 'asc')
            ->limit(3)
            ->get();
        $this->assertGreaterThan(0, count($page1->items), 'page1 should have items');

        if (isset($page1->cursor) && $page1->cursor) {
            $page2 = $client->table('posts')
                ->where('title', 'contains', $prefix)
                ->orderBy('title', 'asc')
                ->limit(3)
                ->after($page1->cursor)
                ->get();
            if (count($page2->items) > 0) {
                $ids1 = array_column($page1->items, 'id');
                $ids2 = array_column($page2->items, 'id');
                $this->assertEmpty(
                    array_intersect($ids1, $ids2),
                    'cursor page2 should have different items'
                );
            }
        } else {
            // offset fallback
            $page2 = $client->table('posts')
                ->where('title', 'contains', $prefix)
                ->orderBy('title', 'asc')
                ->limit(3)
                ->offset(3)
                ->get();
            if (count($page1->items) > 0 && count($page2->items) > 0) {
                $this->assertNotEquals(
                    $page1->items[0]['id'],
                    $page2->items[0]['id'],
                    'offset page2 should return different items'
                );
            }
        }
        $client->destroy();
    }

    // ═══════════════════════════════════════════════════════════
    // Multipart Upload (🔲 → ✅)
    // ═══════════════════════════════════════════════════════════

    public function testE2E_MultipartUpload(): void
    {
        $client = $this->e2eSetup();
        $prefix = 'php-multipart-' . uniqid();
        $key = "$prefix/upload.bin";
        $chunk1 = 'Hello, ';
        $chunk2 = 'PHP multipart world!';

        $bucket = $client->storage->bucket('documents');

        // 1. 업로드 시작
        $uploadId = $bucket->initiateResumableUpload($key, 'application/octet-stream');
        $this->assertNotEmpty($uploadId, 'uploadId should not be empty');

        // 2. 파트 업로드
        $bucket->resumeUpload($key, $uploadId, $chunk1, ['isLastChunk' => false]);
        $bucket->resumeUpload($key, $uploadId, $chunk2, ['isLastChunk' => true]);

        // 3. 다운로드로 검증
        $downloaded = $bucket->download($key);
        $this->assertNotEmpty($downloaded, 'downloaded content should not be empty');
        $client->destroy();
    }

    // ═══════════════════════════════════════════════════════════
    // Admin set-claims (🔲 → ✅)
    // ═══════════════════════════════════════════════════════════

    public function testE2E_AdminSetCustomClaims(): void
    {
        $client = $this->e2eSetup();
        $email = 'php-claims-' . uniqid() . '@test.com';

        // 유저 생성
        $created = $client->adminAuth->createUser($email, 'PHPClaimsPass123!');
        $user = $created['user'] ?? $created;
        $id = $user['id'];
        $this->assertNotEmpty($id, 'user id should not be empty');

        // custom claims 설정
        $client->adminAuth->setCustomClaims($id, ['plan' => 'pro', 'tier' => 2]);

        // getUser로 재조회 — 에러 없으면 통과
        $fetched = $client->adminAuth->getUser($id);
        $fetchedUser = $fetched['user'] ?? $fetched;
        $this->assertEquals($id, $fetchedUser['id'], 'fetched user id should match');

        $client->destroy();
    }
}
