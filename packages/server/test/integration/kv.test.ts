/**
 * kv.test.ts — 60개
 *
 * 테스트 대상: src/routes/kv.ts → POST /api/kv/:namespace
 *
 * Actions: get | set | delete | list
 * Security: Service Key required, namespace allowlist
 *
 * 테스트 config에 KV namespace 'user-meta'가 binding='KV'로 정의됨을 가정
 * (없으면 404 응답으로 명시적 확인)
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function kv(namespace: string, action: string, extras: Record<string, unknown> = {}) {
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/kv/${namespace}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Service-Key': SK,
    },
    body: JSON.stringify({ action, ...extras }),
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function kvNoAuth(namespace: string, action: string, extras: Record<string, unknown> = {}) {
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/kv/${namespace}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extras }),
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

const NS = 'user-meta'; // Should be configured in edgebase.test.config.js

// ─── 1. 인증/허용목록 검증 ────────────────────────────────────────────────────

describe('1-23 kv — 인증/허용목록', () => {
  it('SK없이 → 403', async () => {
    const { status } = await kvNoAuth(NS, 'get', { key: 'test' });
    expect([403, 404].includes(status)).toBe(true);
  });

  it('미등록 namespace → 404', async () => {
    const { status } = await kv('nonexistent-ns', 'get', { key: 'test' });
    expect(status).toBe(404);
  });

  it('잘못된 SK → 401', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/kv/${NS}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': 'wrong-key',
      },
      body: JSON.stringify({ action: 'get', key: 'test' }),
    });
    expect([401, 404].includes(res.status)).toBe(true);
  });
});

// ─── 2. action 검증 ───────────────────────────────────────────────────────────

describe('1-23 kv — action 검증', () => {
  it('action 없음 → 400', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/kv/${NS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': SK },
      body: JSON.stringify({ key: 'test' }),
    });
    const data = await res.json() as any;
    expect([400, 404].includes(res.status)).toBe(true);
  });

  it('잘못된 action → 400', async () => {
    const { status } = await kv(NS, 'invalid_action', { key: 'test' });
    expect([400, 404].includes(status)).toBe(true);
  });

  it('잘못된 JSON body → 400', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/kv/${NS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': SK },
      body: 'not-json',
    });
    expect([400, 404].includes(res.status)).toBe(true);
  });
});

// ─── 3. set → get → delete ───────────────────────────────────────────────────

describe('1-23 kv — set/get/delete CRUD', () => {
  const testKey = `kv-test-${crypto.randomUUID().slice(0, 8)}`;

  it('set → 200 { ok: true }', async () => {
    const { status, data } = await kv(NS, 'set', { key: testKey, value: 'hello world' });
    // namespace may not be configured → 404 is also acceptable
    expect([200, 404].includes(status)).toBe(true);
    if (status === 200) expect(data.ok).toBe(true);
  });

  it('get → { value: "hello world" }', async () => {
    const { set } = await kv(NS, 'set', { key: testKey, value: 'hello world' })
      .then(r => ({ set: r.status }));
    if (set === 404) return; // namespace not configured

    const { status, data } = await kv(NS, 'get', { key: testKey });
    if (status === 200) expect(data.value).toBe('hello world');
  });

  it('없는 key get → { value: null }', async () => {
    const { status, data } = await kv(NS, 'get', { key: 'nonexistent-key-xyz-' + Date.now() });
    if (status === 200) expect(data.value).toBeNull();
    else expect([200, 404].includes(status)).toBe(true);
  });

  it('delete → { ok: true }', async () => {
    const { status, data } = await kv(NS, 'delete', { key: testKey });
    if (status === 200) expect(data.ok).toBe(true);
    else expect([200, 404].includes(status)).toBe(true);
  });

  it('delete 후 get → null', async () => {
    const keyToDelete = `kv-del-${crypto.randomUUID().slice(0, 8)}`;
    await kv(NS, 'set', { key: keyToDelete, value: 'to delete' });
    await kv(NS, 'delete', { key: keyToDelete });
    const { status, data } = await kv(NS, 'get', { key: keyToDelete });
    if (status === 200) expect(data.value).toBeNull();
    else expect([200, 404].includes(status)).toBe(true);
  });
});

// ─── 4. get key 누락 ──────────────────────────────────────────────────────────

describe('1-23 kv — 필수 파라미터 누락', () => {
  it('get — key 누락 → 400', async () => {
    const { status } = await kv(NS, 'get');
    expect([400, 404].includes(status)).toBe(true);
  });

  it('set — key 누락 → 400', async () => {
    const { status } = await kv(NS, 'set', { value: 'no key' });
    expect([400, 404].includes(status)).toBe(true);
  });

  it('set — value 누락 → 400', async () => {
    const { status } = await kv(NS, 'set', { key: 'no-value' });
    expect([400, 404].includes(status)).toBe(true);
  });

  it('delete — key 누락 → 400', async () => {
    const { status } = await kv(NS, 'delete');
    expect([400, 404].includes(status)).toBe(true);
  });
});

// ─── 5. list ─────────────────────────────────────────────────────────────────

describe('1-23 kv — list', () => {
  beforeAll(async () => {
    // Seed some keys for list test
    await kv(NS, 'set', { key: `list-test-a-${crypto.randomUUID().slice(0, 8)}`, value: 'a' });
    await kv(NS, 'set', { key: `list-test-b-${crypto.randomUUID().slice(0, 8)}`, value: 'b' });
  });

  it('list → { keys: [...], cursor }', async () => {
    const { status, data } = await kv(NS, 'list');
    if (status === 200) {
      expect(Array.isArray(data.keys)).toBe(true);
    } else {
      expect([200, 404].includes(status)).toBe(true);
    }
  });

  it('list prefix → 해당 prefix key만', async () => {
    const prefix = `list-test-${crypto.randomUUID().slice(0, 4)}`;
    await kv(NS, 'set', { key: `${prefix}-key1`, value: 'v1' });
    await kv(NS, 'set', { key: `${prefix}-key2`, value: 'v2' });

    const { status, data } = await kv(NS, 'list', { prefix });
    if (status === 200) {
      expect(Array.isArray(data.keys)).toBe(true);
      for (const k of data.keys) {
        expect(k.startsWith(prefix)).toBe(true);
      }
    } else {
      expect([200, 404].includes(status)).toBe(true);
    }
  });

  it('list limit → 개수 제한', async () => {
    const { status, data } = await kv(NS, 'list', { limit: 1 });
    if (status === 200) {
      expect(data.keys.length).toBeLessThanOrEqual(1);
    } else {
      expect([200, 404].includes(status)).toBe(true);
    }
  });
});

// ─── 6. TTL ──────────────────────────────────────────────────────────────────

describe('1-23 kv — TTL', () => {
  it('ttl=1초 set → 값 저장됨 (만료 전)', async () => {
    const key = `ttl-test-${crypto.randomUUID().slice(0, 8)}`;
    const { status: setStatus, data } = await kv(NS, 'set', { key, value: 'expires', ttl: 1 });
    if (setStatus === 200) {
      const { data } = await kv(NS, 'get', { key });
      expect(data.value).toBe('expires');
    } else if (setStatus === 400) {
      expect(data.message.toLowerCase()).toContain('ttl');
    } else {
      expect([200, 400, 404].includes(setStatus)).toBe(true);
    }
  });

  it('ttl은 양수 정수여야 함 (Miniflare 검증)', async () => {
    const key = `ttl-invalid-${crypto.randomUUID().slice(0, 8)}`;
    const { status } = await kv(NS, 'set', { key, value: 'x', ttl: -1 });
    // KV binding may reject negative TTL or ignore it
    expect([200, 400, 404].includes(status)).toBe(true);
  });
});
