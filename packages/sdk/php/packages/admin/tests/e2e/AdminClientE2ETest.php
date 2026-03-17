<?php

declare(strict_types=1);

namespace EdgeBase\Tests\Admin;

use PHPUnit\Framework\TestCase;

/**
 * PHP Admin SDK — E2E 테스트
 *
 * 전제: wrangler dev --port 8688 로컬 서버 실행 중
 *
 * 실행:
 *   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
 *     cd packages/sdk/php/packages/admin && ./vendor/bin/phpunit tests/e2e/ -v
 *
 * 원칙: mock 금지, 실서버 기반 HTTP 요청
 */

class AdminClientE2ETest extends TestCase
{
    private static string $baseUrl;
    private static string $serviceKey;
    private static string $prefix;
    private static array $createdIds = [];
    private static ?string $createdUserId = null;
    private static ?\EdgeBase\Admin\AdminClient $admin = null;

    public static function setUpBeforeClass(): void
    {
        self::$baseUrl = $_ENV['BASE_URL'] ?? getenv('BASE_URL') ?: 'http://localhost:8688';
        self::$serviceKey = $_ENV['SERVICE_KEY'] ?? getenv('SERVICE_KEY') ?: 'test-service-key-for-admin';
        self::$prefix = 'php-admin-e2e-' . time();
        self::$admin = new \EdgeBase\Admin\AdminClient(self::$baseUrl, self::$serviceKey);
    }

    public static function tearDownAfterClass(): void
    {
        if (!self::$admin)
            return;
        foreach (self::$createdIds as $id) {
            try {
                self::$admin->db('shared')->table('posts')->delete($id);
            } catch (\Throwable) {
            }
        }
    }

    // ─── 1. AdminAuth ─────────────────────────────────────────────────────────

    public function test_admin_auth_create_user(): void
    {
        $email = 'php-admin-' . time() . '@test.com';
        $user = self::$admin->adminAuth->createUser(['email' => $email, 'password' => 'PhpAdmin123!']);
        $userId = $user['id'] ?? $user['user']['id'] ?? null;
        $this->assertNotNull($userId);
        self::$createdUserId = $userId;
    }

    public function test_admin_auth_get_user(): void
    {
        if (!self::$createdUserId)
            $this->markTestSkipped('No user created');
        $user = self::$admin->adminAuth->getUser(self::$createdUserId);
        $userId = $user['id'] ?? $user['user']['id'] ?? null;
        $this->assertSame(self::$createdUserId, $userId);
    }

    public function test_admin_auth_list_users(): void
    {
        $result = self::$admin->adminAuth->listUsers(5);
        $this->assertArrayHasKey('users', $result);
        $this->assertIsArray($result['users']);
    }

    public function test_admin_auth_set_custom_claims(): void
    {
        if (!self::$createdUserId)
            $this->markTestSkipped('No user created');
        try {
            self::$admin->adminAuth->setCustomClaims(self::$createdUserId, ['role' => 'premium']);
            $this->assertTrue(true);
        } catch (\Throwable $e) {
            $this->fail('setCustomClaims threw: ' . $e->getMessage());
        }
    }

    public function test_admin_auth_revoke_all_sessions(): void
    {
        if (!self::$createdUserId)
            $this->markTestSkipped('No user created');
        try {
            self::$admin->adminAuth->revokeAllSessions(self::$createdUserId);
            $this->assertTrue(true);
        } catch (\Throwable $e) {
            $this->fail('revokeAllSessions threw: ' . $e->getMessage());
        }
    }

    public function test_admin_auth_get_nonexistent_user(): void
    {
        $this->expectException(\EdgeBase\Core\EdgeBaseException::class);
        self::$admin->adminAuth->getUser('nonexistent-php-admin-99999');
    }

    // ─── 2. DB CRUD ──────────────────────────────────────────────────────────

    public function test_db_insert_returns_id(): void
    {
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => self::$prefix . '-create']);
        $id = $r['id'] ?? null;
        $this->assertNotNull($id);
        self::$createdIds[] = $id;
    }

    public function test_db_get_one(): void
    {
        $created = self::$admin->db('shared')->table('posts')->insert(['title' => self::$prefix . '-getone']);
        $id = $created['id'];
        self::$createdIds[] = $id;
        $fetched = self::$admin->db('shared')->table('posts')->getOne($id);
        $this->assertSame($id, $fetched['id'] ?? null);
    }

    public function test_db_update(): void
    {
        $created = self::$admin->db('shared')->table('posts')->insert(['title' => self::$prefix . '-orig']);
        $id = $created['id'];
        self::$createdIds[] = $id;
        $updated = self::$admin->db('shared')->table('posts')->update($id, ['title' => self::$prefix . '-upd']);
        $this->assertSame(self::$prefix . '-upd', $updated['title'] ?? null);
    }

    public function test_db_delete_then_get_throws(): void
    {
        $created = self::$admin->db('shared')->table('posts')->insert(['title' => self::$prefix . '-del']);
        $id = $created['id'];
        self::$admin->db('shared')->table('posts')->delete($id);
        $this->expectException(\EdgeBase\Core\EdgeBaseException::class);
        self::$admin->db('shared')->table('posts')->getOne($id);
    }

    public function test_db_list_returns_items(): void
    {
        $result = self::$admin->db('shared')->table('posts')->limit(3)->getList();
        $this->assertArrayHasKey('items', $result);
        $this->assertIsArray($result['items']);
        $this->assertLessThanOrEqual(3, count($result['items']));
    }

    public function test_db_count_returns_number(): void
    {
        $count = self::$admin->db('shared')->table('posts')->count();
        $this->assertIsInt($count);
        $this->assertGreaterThanOrEqual(0, $count);
    }

    // ─── 3. Filter & Query ────────────────────────────────────────────────────

    public function test_where_filter_finds_record(): void
    {
        $unique = self::$prefix . '-filter-' . uniqid();
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => $unique]);
        self::$createdIds[] = $r['id'];
        $list = self::$admin->db('shared')->table('posts')->where('title', '==', $unique)->getList();
        $this->assertNotEmpty($list['items']);
        $this->assertSame($unique, $list['items'][0]['title'] ?? null);
    }

    public function test_order_by_limit(): void
    {
        $list = self::$admin->db('shared')->table('posts')->orderBy('createdAt', 'desc')->limit(3)->getList();
        $this->assertLessThanOrEqual(3, count($list['items']));
    }

    // ─── 4. Batch ─────────────────────────────────────────────────────────────

    public function test_insert_many(): void
    {
        $items = [
            ['title' => self::$prefix . '-batch-1'],
            ['title' => self::$prefix . '-batch-2'],
            ['title' => self::$prefix . '-batch-3'],
        ];
        $result = self::$admin->db('shared')->table('posts')->insertMany($items);
        foreach (($result['inserted'] ?? $result) as $r) {
            self::$createdIds[] = $r['id'];
        }
        $this->assertCount(3, $result['inserted'] ?? $result);
    }

    // ─── 5. Upsert ───────────────────────────────────────────────────────────

    public function test_upsert_new_record(): void
    {
        $r = self::$admin->db('shared')->table('posts')->upsert(['title' => self::$prefix . '-upsert']);
        $this->assertArrayHasKey('id', $r);
        self::$createdIds[] = $r['id'];
    }

    // ─── 6. FieldOps ─────────────────────────────────────────────────────────

    public function test_increment_view_count(): void
    {
        $created = self::$admin->db('shared')->table('posts')->insert([
            'title' => self::$prefix . '-inc',
            'viewCount' => 0,
        ]);
        $id = $created['id'];
        self::$createdIds[] = $id;
        $updated = self::$admin->db('shared')->table('posts')->update($id, [
            'viewCount' => \EdgeBase\Core\FieldOps::increment(5),
        ]);
        $this->assertSame(5, $updated['viewCount'] ?? null);
    }

    // ─── 7. KV ───────────────────────────────────────────────────────────────

    public function test_kv_set_and_get(): void
    {
        $key = 'php-admin-kv-' . time();
        self::$admin->kv('test')->set($key, 'hello-php-admin');
        $val = self::$admin->kv('test')->get($key);
        $this->assertSame('hello-php-admin', $val);
    }

    public function test_kv_delete(): void
    {
        $key = 'php-admin-kv-del-' . time();
        self::$admin->kv('test')->set($key, 'del-me');
        self::$admin->kv('test')->delete($key);
        $val = self::$admin->kv('test')->get($key);
        $this->assertNull($val);
    }

    public function test_kv_list(): void
    {
        $result = self::$admin->kv('test')->list();
        $this->assertIsArray($result);
    }

    // ─── 8. SQL ──────────────────────────────────────────────────────────────

    public function test_raw_sql_select(): void
    {
        $result = self::$admin->sql('shared', null, 'SELECT 1 AS val', []);
        $this->assertIsArray($result);
    }

    // ─── 9. Broadcast ────────────────────────────────────────────────────────

    public function test_broadcast_succeeds(): void
    {
        try {
            self::$admin->broadcast('general', 'server-event', ['msg' => 'hello from php admin E2E']);
            $this->assertTrue(true);
        } catch (\Throwable $e) {
            $this->fail('broadcast threw: ' . $e->getMessage());
        }
    }

    // ─── 10. Error Handling ──────────────────────────────────────────────────

    public function test_get_one_nonexistent_throws(): void
    {
        $this->expectException(\EdgeBase\Core\EdgeBaseException::class);
        self::$admin->db('shared')->table('posts')->getOne('nonexistent-php-99999');
    }

    public function test_update_nonexistent_throws(): void
    {
        $this->expectException(\EdgeBase\Core\EdgeBaseException::class);
        self::$admin->db('shared')->table('posts')->update('nonexistent-php-upd', ['title' => 'X']);
    }

    public function test_invalid_service_key_throws(): void
    {
        $badAdmin = new \EdgeBase\Admin\AdminClient(self::$baseUrl, 'invalid-sk');
        $this->expectException(\EdgeBase\Core\EdgeBaseException::class);
        $badAdmin->db('shared')->table('posts')->insert(['title' => 'X']);
    }

    // ─── 11. AdminAuth extended ─────────────────────────────────────────────

    public function test_admin_auth_update_user(): void
    {
        if (!self::$createdUserId)
            $this->markTestSkipped('No user created');
        $updated = self::$admin->adminAuth->updateUser(self::$createdUserId, [
            'displayName' => 'PHP Admin E2E User',
        ]);
        $name = $updated['displayName'] ?? $updated['display_name'] ?? null;
        $this->assertNotNull($name);
    }

    public function test_admin_auth_update_user_preserves_email(): void
    {
        if (!self::$createdUserId)
            $this->markTestSkipped('No user created');
        $user = self::$admin->adminAuth->getUser(self::$createdUserId);
        $email = $user['email'] ?? null;
        $this->assertNotNull($email);
        $this->assertStringContainsString('@', $email);
    }

    public function test_admin_auth_list_users_limit(): void
    {
        $result = self::$admin->adminAuth->listUsers(2);
        $this->assertArrayHasKey('users', $result);
        $this->assertLessThanOrEqual(2, count($result['users']));
    }

    public function test_admin_auth_delete_user_and_verify(): void
    {
        $email = 'php-admin-del-' . time() . '@test.com';
        $user = self::$admin->adminAuth->createUser(['email' => $email, 'password' => 'PhpDel123!']);
        $userId = $user['id'] ?? $user['user']['id'] ?? null;
        $this->assertNotNull($userId);
        self::$admin->adminAuth->deleteUser($userId);
        $this->expectException(\EdgeBase\Core\EdgeBaseException::class);
        self::$admin->adminAuth->getUser($userId);
    }

    // ─── 12. DB Extended CRUD ───────────────────────────────────────────────

    public function test_db_insert_with_nested_data(): void
    {
        $r = self::$admin->db('shared')->table('posts')->insert([
            'title' => self::$prefix . '-nested',
            'metadata' => ['tags' => ['php', 'admin'], 'version' => 2],
        ]);
        self::$createdIds[] = $r['id'];
        $fetched = self::$admin->db('shared')->table('posts')->getOne($r['id']);
        $this->assertSame('php', $fetched['metadata']['tags'][0] ?? null);
    }

    public function test_db_insert_unicode_title(): void
    {
        $title = self::$prefix . '-한국어-テスト';
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => $title]);
        self::$createdIds[] = $r['id'];
        $fetched = self::$admin->db('shared')->table('posts')->getOne($r['id']);
        $this->assertSame($title, $fetched['title']);
    }

    public function test_db_update_returns_updated_at(): void
    {
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => self::$prefix . '-upd-ts']);
        self::$createdIds[] = $r['id'];
        $updated = self::$admin->db('shared')->table('posts')->update($r['id'], ['title' => self::$prefix . '-upd-ts2']);
        $this->assertArrayHasKey('updatedAt', $updated);
    }

    public function test_db_upsert_existing_record(): void
    {
        $r = self::$admin->db('shared')->table('posts')->insert([
            'title' => self::$prefix . '-upsert-existing',
            'viewCount' => 5,
        ]);
        self::$createdIds[] = $r['id'];
        // Upsert with same ID should update
        $result = self::$admin->db('shared')->table('posts')->upsert([
            'id' => $r['id'],
            'title' => self::$prefix . '-upsert-existing',
            'viewCount' => 99,
        ]);
        $this->assertSame($r['id'], $result['id']);
    }

    // ─── 13. Filter Extended ────────────────────────────────────────────────

    public function test_where_not_equals_filter(): void
    {
        $unique = self::$prefix . '-neq-' . uniqid();
        $r = self::$admin->db('shared')->table('posts')->insert(['title' => $unique, 'viewCount' => 42]);
        self::$createdIds[] = $r['id'];
        $list = self::$admin->db('shared')->table('posts')
            ->where('title', '==', $unique)
            ->where('viewCount', '!=', 0)
            ->getList();
        $this->assertNotEmpty($list['items']);
    }

    public function test_where_less_than(): void
    {
        $unique = self::$prefix . '-lt-' . uniqid();
        $table = self::$admin->db('shared')->table('posts');
        $table->insert(['title' => $unique, 'viewCount' => 5]);
        $r2 = $table->insert(['title' => $unique, 'viewCount' => 15]);
        self::$createdIds[] = $r2['id'];
        $list = $table->where('title', '==', $unique)->where('viewCount', '<', 10)->getList();
        foreach ($list['items'] as $item) {
            $this->assertLessThan(10, $item['viewCount'] ?? 999);
            self::$createdIds[] = $item['id'];
        }
    }

    public function test_limit_and_offset_pagination(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        // 테스트 전용 데이터 4개 생성 (다른 테스트의 동시 쓰기 영향 차단)
        $tag = 'pag-' . substr(md5(uniqid()), 0, 8);
        for ($i = 0; $i < 4; $i++) {
            $r = $table->insert(['title' => $tag . '-' . $i]);
            self::$createdIds[] = $r['id'];
        }
        $page1 = $table->where('title', 'contains', $tag)->limit(2)->offset(0)->getList();
        $page2 = $table->where('title', 'contains', $tag)->limit(2)->offset(2)->getList();
        if (!empty($page1['items']) && !empty($page2['items'])) {
            $ids1 = array_map(fn($i) => $i['id'], $page1['items']);
            $ids2 = array_map(fn($i) => $i['id'], $page2['items']);
            $this->assertEmpty(array_intersect($ids1, $ids2));
        }
        $this->assertTrue(true);
    }

    // ─── 14. Batch Extended ─────────────────────────────────────────────────

    public function test_insert_many_returns_correct_count(): void
    {
        $items = [];
        for ($i = 0; $i < 5; $i++) {
            $items[] = ['title' => self::$prefix . '-batch5-' . $i];
        }
        $result = self::$admin->db('shared')->table('posts')->insertMany($items);
        $created = $result['inserted'] ?? $result;
        $this->assertCount(5, $created);
        foreach ($created as $r) { self::$createdIds[] = $r['id']; }
    }

    public function test_update_many_updates_records(): void
    {
        $unique = self::$prefix . '-bum-' . uniqid();
        $table = self::$admin->db('shared')->table('posts');
        $items = [
            ['title' => $unique, 'viewCount' => 0],
            ['title' => $unique, 'viewCount' => 0],
            ['title' => $unique, 'viewCount' => 0],
        ];
        $created = $table->insertMany($items);
        foreach (($created['inserted'] ?? $created) as $r) { self::$createdIds[] = $r['id']; }
        $result = $table->where('title', '==', $unique)->updateMany(['viewCount' => 77]);
        $this->assertGreaterThanOrEqual(3, $result->totalSucceeded);
    }

    public function test_delete_many_removes_records(): void
    {
        $unique = self::$prefix . '-bdm-' . uniqid();
        $table = self::$admin->db('shared')->table('posts');
        $items = [['title' => $unique], ['title' => $unique]];
        $table->insertMany($items);
        $result = $table->where('title', '==', $unique)->deleteMany();
        $this->assertGreaterThanOrEqual(2, $result->totalProcessed);
    }

    // ─── 15. FieldOps Extended ──────────────────────────────────────────────

    public function test_increment_accumulates(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        $r = $table->insert(['title' => self::$prefix . '-inc-acc', 'viewCount' => 10]);
        self::$createdIds[] = $r['id'];
        $table->update($r['id'], ['viewCount' => \EdgeBase\Core\FieldOps::increment(5)]);
        $upd = $table->update($r['id'], ['viewCount' => \EdgeBase\Core\FieldOps::increment(3)]);
        $this->assertSame(18, $upd['viewCount'] ?? null);
    }

    public function test_delete_field_sets_null(): void
    {
        $table = self::$admin->db('shared')->table('posts');
        $r = $table->insert(['title' => self::$prefix . '-delf', 'extra' => 'remove-me']);
        self::$createdIds[] = $r['id'];
        $upd = $table->update($r['id'], ['extra' => \EdgeBase\Core\FieldOps::deleteField()]);
        $this->assertNull($upd['extra'] ?? null);
    }

    // ─── 16. KV Extended ────────────────────────────────────────────────────

    public function test_kv_set_get_delete_chain(): void
    {
        $key = 'php-admin-kv-chain-' . time();
        $kv = self::$admin->kv('test');
        $kv->set($key, 'chain-val');
        $this->assertSame('chain-val', $kv->get($key));
        $kv->delete($key);
        $this->assertNull($kv->get($key));
    }

    public function test_kv_overwrite_value(): void
    {
        $key = 'php-admin-kv-overwrite-' . time();
        $kv = self::$admin->kv('test');
        $kv->set($key, 'first');
        $kv->set($key, 'second');
        $this->assertSame('second', $kv->get($key));
        $kv->delete($key); // cleanup
    }

    public function test_kv_get_nonexistent_returns_null(): void
    {
        $kv = self::$admin->kv('test');
        $val = $kv->get('php-admin-kv-nonexistent-' . uniqid());
        $this->assertNull($val);
    }

    public function test_kv_list_with_prefix(): void
    {
        $prefix = 'php-admin-kv-pfx-' . time() . '-';
        $kv = self::$admin->kv('test');
        $kv->set($prefix . 'a', 'va');
        $kv->set($prefix . 'b', 'vb');
        $result = $kv->list($prefix);
        $this->assertIsArray($result);
        // cleanup
        $kv->delete($prefix . 'a');
        $kv->delete($prefix . 'b');
    }

    // ─── 17. SQL Extended ───────────────────────────────────────────────────

    public function test_sql_with_params(): void
    {
        $result = self::$admin->sql('shared', null, 'SELECT 1 + ? AS val', [41]);
        $this->assertIsArray($result);
    }

    public function test_sql_returns_array(): void
    {
        $result = self::$admin->sql('shared', null, "SELECT 'hello' AS msg", []);
        $this->assertIsArray($result);
    }

    // ─── 18. Broadcast Extended ─────────────────────────────────────────────

    public function test_broadcast_with_empty_payload(): void
    {
        try {
            self::$admin->broadcast('test-channel', 'empty-event', []);
            $this->assertTrue(true);
        } catch (\Throwable $e) {
            $this->fail('broadcast with empty payload threw: ' . $e->getMessage());
        }
    }

    public function test_broadcast_with_complex_payload(): void
    {
        try {
            self::$admin->broadcast('test-channel', 'complex-event', [
                'message' => 'hello from PHP admin E2E extended',
                'timestamp' => time(),
                'nested' => ['key' => 'value'],
            ]);
            $this->assertTrue(true);
        } catch (\Throwable $e) {
            $this->fail('broadcast with complex payload threw: ' . $e->getMessage());
        }
    }

    // ─── 19. Storage via Admin ──────────────────────────────────────────────

    public function test_storage_upload_and_download(): void
    {
        $bucket = self::$admin->storage->bucket('test');
        $path = self::$prefix . '/admin-file.txt';
        $content = 'Admin E2E storage test ' . time();
        $bucket->upload($path, $content, 'text/plain');
        $downloaded = $bucket->download($path);
        $this->assertSame($content, $downloaded);
        try { $bucket->delete($path); } catch (\Throwable) {}
    }

    public function test_storage_list_files(): void
    {
        $bucket = self::$admin->storage->bucket('test');
        $path = self::$prefix . '/admin-list.txt';
        $bucket->upload($path, 'list test', 'text/plain');
        $files = $bucket->list(self::$prefix . '/');
        $this->assertIsArray($files);
        try { $bucket->delete($path); } catch (\Throwable) {}
    }

    public function test_storage_delete_file(): void
    {
        $bucket = self::$admin->storage->bucket('test');
        $path = self::$prefix . '/admin-delete.txt';
        $bucket->upload($path, 'delete me', 'text/plain');
        $result = $bucket->delete($path);
        $this->assertIsArray($result);
    }

    // ─── 20. PHP-specific patterns ──────────────────────────────────────────

    public function test_array_map_on_list_items(): void
    {
        $result = self::$admin->db('shared')->table('posts')->limit(3)->getList();
        $ids = array_map(fn($item) => $item['id'] ?? '', $result['items']);
        $this->assertIsArray($ids);
        $this->assertLessThanOrEqual(3, count($ids));
    }

    public function test_json_encode_decode_round_trip(): void
    {
        $r = self::$admin->db('shared')->table('posts')->insert([
            'title' => self::$prefix . '-json-rt',
            'viewCount' => 123,
        ]);
        self::$createdIds[] = $r['id'];
        $json = json_encode($r, JSON_THROW_ON_ERROR);
        $decoded = json_decode($json, true);
        $this->assertSame($r['id'], $decoded['id']);
        $this->assertSame(123, $decoded['viewCount']);
    }

    // ─── 21. Push E2E ───────────────────────────────────────────────────────

    public function test_push_send_nonexistent_user(): void
    {
        $result = self::$admin->push()->send('nonexistent-push-user-99999', [
            'title' => 'Test',
            'body' => 'Hello',
        ]);
        $this->assertIsArray($result);
        $this->assertSame(0, $result['sent'] ?? 0);
    }

    public function test_push_send_to_token(): void
    {
        $result = self::$admin->push()->sendToToken('fake-fcm-token-e2e', [
            'title' => 'Token',
            'body' => 'Test',
        ]);
        $this->assertIsArray($result);
        $this->assertArrayHasKey('sent', $result);
    }

    public function test_push_send_many(): void
    {
        $result = self::$admin->push()->sendMany(
            ['nonexistent-user-a', 'nonexistent-user-b'],
            ['title' => 'Batch', 'body' => 'Test']
        );
        $this->assertIsArray($result);
    }

    public function test_push_get_tokens(): void
    {
        $tokens = self::$admin->push()->getTokens('nonexistent-push-user-tokens');
        $this->assertIsArray($tokens);
    }

    public function test_push_get_logs(): void
    {
        $logs = self::$admin->push()->getLogs('nonexistent-push-user-logs');
        $this->assertIsArray($logs);
    }

    public function test_push_send_to_topic(): void
    {
        $result = self::$admin->push()->sendToTopic('test-topic-e2e', [
            'title' => 'Topic',
            'body' => 'Test',
        ]);
        $this->assertIsArray($result);
    }

    public function test_push_broadcast(): void
    {
        $result = self::$admin->push()->broadcast([
            'title' => 'Broadcast',
            'body' => 'E2E Test',
        ]);
        $this->assertIsArray($result);
    }

    // ─── Vectorize (stub) ──────────────────────────────────────────────────

    public function test_vectorize_upsert_stub(): void
    {
        $vec = self::$admin->vector('embeddings');
        $result = $vec->upsert([
            ['id' => 'doc-1', 'values' => array_fill(0, 1536, 0.1), 'metadata' => ['title' => 'test']],
        ]);
        $this->assertTrue($result['ok'] ?? false);
    }

    public function test_vectorize_insert_stub(): void
    {
        $vec = self::$admin->vector('embeddings');
        $result = $vec->insert([
            ['id' => 'doc-ins-1', 'values' => array_fill(0, 1536, 0.2)],
        ]);
        $this->assertTrue($result['ok'] ?? false);
    }

    public function test_vectorize_search_stub(): void
    {
        $vec = self::$admin->vector('embeddings');
        $matches = $vec->search(array_fill(0, 1536, 0.1), 5);
        $this->assertIsArray($matches);
    }

    public function test_vectorize_search_with_namespace(): void
    {
        $vec = self::$admin->vector('embeddings');
        $matches = $vec->search(array_fill(0, 1536, 0.1), 5, null, 'test-ns');
        $this->assertIsArray($matches);
    }

    public function test_vectorize_search_with_return_values(): void
    {
        $vec = self::$admin->vector('embeddings');
        $matches = $vec->search(array_fill(0, 1536, 0.1), 5, null, null, true);
        $this->assertIsArray($matches);
    }

    public function test_vectorize_query_by_id_stub(): void
    {
        $vec = self::$admin->vector('embeddings');
        $matches = $vec->queryById('doc-1', 5);
        $this->assertIsArray($matches);
    }

    public function test_vectorize_get_by_ids_stub(): void
    {
        $vec = self::$admin->vector('embeddings');
        $vectors = $vec->getByIds(['doc-1', 'doc-2']);
        $this->assertIsArray($vectors);
    }

    public function test_vectorize_delete_stub(): void
    {
        $vec = self::$admin->vector('embeddings');
        $result = $vec->delete(['doc-1', 'doc-2']);
        $this->assertTrue($result['ok'] ?? false);
    }

    public function test_vectorize_describe_stub(): void
    {
        $vec = self::$admin->vector('embeddings');
        $info = $vec->describe();
        $this->assertIsArray($info);
        $this->assertArrayHasKey('vectorCount', $info);
        $this->assertArrayHasKey('dimensions', $info);
        $this->assertArrayHasKey('metric', $info);
    }

    public function test_vectorize_search_dimension_mismatch(): void
    {
        $vec = self::$admin->vector('embeddings');
        $this->expectException(\Throwable::class);
        $vec->search([0.1, 0.2, 0.3], 5);
    }

    public function test_vectorize_nonexistent_index(): void
    {
        $vec = self::$admin->vector('nonexistent-index-99');
        $this->expectException(\Throwable::class);
        $vec->describe();
    }
}
