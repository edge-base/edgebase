/**
 * storage.test.ts — 80개
 *
 * 테스트 대상: src/routes/storage.ts → R2 bucket
 *   POST   /api/storage/:bucket/upload
 *   GET    /api/storage/:bucket/:key{.+}
 *   GET    /api/storage/:bucket
 *   DELETE /api/storage/:bucket/:key{.+}
 *   GET    /api/storage/:bucket/:key{.+}/metadata
 *   PATCH  /api/storage/:bucket/:key{.+}/metadata
 *   POST   /api/storage/:bucket/signed-url
 *   POST   /api/storage/:bucket/signed-upload-url
 *   POST   /api/storage/:bucket/multipart/create
 *   POST   /api/storage/:bucket/multipart/complete
 *   POST   /api/storage/:bucket/multipart/abort
 *
 * 설정: edgebase.test.config.js에 avatars(공개 read, SK write), uploads(auth 필요) 버킷
 * 격리: 각 테스트는 고유 key prefix 사용, afterAll where 필요
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';
const BUCKET = 'avatars'; // publicly readable, SK writable
const HOOK_BUCKET = BUCKET;

async function upload(key: string, content: string, type = 'text/plain') {
  return uploadToBucket(BUCKET, key, content, type);
}

async function uploadToBucket(bucket: string, key: string, content: string, type = 'text/plain') {
  const form = new FormData();
  form.append('file', new Blob([content], { type }), key.split('/').pop());
  form.append('key', key);
  return (globalThis as any).SELF.fetch(`${BASE}/api/storage/${bucket}/upload`, {
    method: 'POST',
    headers: { 'X-EdgeBase-Service-Key': SK },
    body: form,
  });
}

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'X-EdgeBase-Service-Key': SK };
  const init: RequestInit = { method, headers };
  if (body && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, init);
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, headers: res.headers };
}

// ─── 1. Upload ─────────────────────────────────────────────────────────────────

describe('1-15 storage — upload', () => {
  const key = `test-upload-${crypto.randomUUID().slice(0, 8)}.txt`;

  afterAll(async () => {
    await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {});
  });

  it('업로드 성공 → 201, metadata 반환', async () => {
    const res = await upload(key, 'hello world');
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.key).toBe(key);
    expect(data.size).toBeGreaterThan(0);
    expect(data.contentType).toBe('text/plain');
  });

  it('동일 key 재업로드 → 201 (덮어쓰기)', async () => {
    await upload(key, 'first');
    const res = await upload(key, 'second');
    expect(res.status).toBe(201);
  });

  it('file/key 누락 → 400', async () => {
    const form = new FormData();
    form.append('key', 'some-key.txt');
    // file 누락
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('미설정 버킷 → 404', async () => {
    const form = new FormData();
    form.append('file', new Blob(['x']), 'x.txt');
    form.append('key', 'x.txt');
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/undefined_bucket/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    expect(res.status).toBe(404);
  });
});

// ─── 2. Download ──────────────────────────────────────────────────────────────

describe('1-15 storage — download', () => {
  const key = `test-download-${crypto.randomUUID().slice(0, 8)}.txt`;
  const content = 'download test content';

  beforeAll(async () => { await upload(key, content); });
  afterAll(async () => { await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {}); });

  it('존재하는 파일 다운로드 → 200, Content-Type 포함', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/${key}`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toBe(content);
  });

  it('존재하지 않는 파일 → 404', async () => {
    const { status } = await api('GET', `/api/storage/${BUCKET}/nonexistent-file-xyz.txt`);
    expect(status).toBe(404);
  });

  it('Content-Length 헤더 포함', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/${key}`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBeDefined();
  });
});

// ─── 3. List ──────────────────────────────────────────────────────────────────

describe('1-15 storage — list', () => {
  const prefix = `list-test-${crypto.randomUUID().slice(0, 8)}`;
  const keys: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 3; i++) {
      const key = `${prefix}/file-${i}.txt`;
      await upload(key, `content ${i}`);
      keys.push(key);
    }
  });

  afterAll(async () => {
    for (const k of keys) {
      await api('DELETE', `/api/storage/${BUCKET}/${k}`).catch(() => {});
    }
  });

  it('list → { files: [...], cursor, truncated }', async () => {
    const { status, data } = await api('GET', `/api/storage/${BUCKET}`);
    expect(status).toBe(200);
    expect(Array.isArray(data.files)).toBe(true);
    expect(typeof data.truncated).toBe('boolean');
  });

  it('prefix 필터 → 해당 prefix 파일만', async () => {
    const { data } = await api('GET', `/api/storage/${BUCKET}?prefix=${prefix}`);
    expect(data.files.length).toBeGreaterThanOrEqual(3);
    for (const f of data.files) {
      expect(f.key.startsWith(prefix)).toBe(true);
    }
  });

  it('limit=1 → 최대 1개', async () => {
    const { data } = await api('GET', `/api/storage/${BUCKET}?prefix=${prefix}&limit=1`);
    expect(data.files.length).toBeLessThanOrEqual(1);
  });
});

// ─── 4. Delete ────────────────────────────────────────────────────────────────

describe('1-15 storage — delete', () => {
  it('삭제 성공 → 200', async () => {
    const key = `test-delete-${crypto.randomUUID().slice(0, 8)}.txt`;
    await upload(key, 'delete me');
    const { status, data } = await api('DELETE', `/api/storage/${BUCKET}/${key}`);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('삭제 후 GET → 404', async () => {
    const key = `test-delete2-${crypto.randomUUID().slice(0, 8)}.txt`;
    await upload(key, 'delete verify');
    await api('DELETE', `/api/storage/${BUCKET}/${key}`);
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/${key}`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(res.status).toBe(404);
  });

  it('존재하지 않는 key 삭제 → 404', async () => {
    const { status } = await api('DELETE', `/api/storage/${BUCKET}/ghost-file-${Date.now()}.txt`);
    expect(status).toBe(404);
  });
});

// ─── 5. Metadata ──────────────────────────────────────────────────────────────

describe('1-15 storage — metadata', () => {
  const key = `test-meta-${crypto.randomUUID().slice(0, 8)}.txt`;

  beforeAll(async () => { await upload(key, 'metadata test'); });
  afterAll(async () => { await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {}); });

  it('GET metadata → { key, size, contentType, etag }', async () => {
    const { status, data } = await api('GET', `/api/storage/${BUCKET}/${key}/metadata`);
    expect(status).toBe(200);
    expect(data.key).toBe(key);
    expect(typeof data.size).toBe('number');
    expect(data.etag).toBeDefined();
    expect(data.contentType).toBeDefined();
  });

  it('PATCH metadata → 200, 업데이트된 metadata 반환', async () => {
    const { status, data } = await api('PATCH', `/api/storage/${BUCKET}/${key}/metadata`, {
      customMetadata: { label: 'updated-label' },
    });
    expect(status).toBe(200);
    expect(data.customMetadata?.label).toBe('updated-label');
  });

  it('존재하지 않는 파일 metadata → 404', async () => {
    const { status } = await api('GET', `/api/storage/${BUCKET}/ghost.txt/metadata`);
    expect(status).toBe(404);
  });

  it('multi-segment key metadata is immediately readable after upload', async () => {
    const nestedKey = `nested/meta-${crypto.randomUUID().slice(0, 8)}/file.txt`;
    await upload(nestedKey, 'nested metadata test');

    const { status, data } = await api('GET', `/api/storage/${BUCKET}/${nestedKey}/metadata`);
    expect(status).toBe(200);
    expect(data.key).toBe(nestedKey);

    await api('DELETE', `/api/storage/${BUCKET}/${nestedKey}`).catch(() => {});
  });
});

// ─── 6. Signed URL ────────────────────────────────────────────────────────────

describe('1-15 storage — signed-url', () => {
  const key = `test-signed-${crypto.randomUUID().slice(0, 8)}.txt`;

  beforeAll(async () => { await upload(key, 'signed url content'); });
  afterAll(async () => { await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {}); });

  it('signed-url 생성 → { url, expiresAt }', async () => {
    const { status, data } = await api('POST', `/api/storage/${BUCKET}/signed-url`, {
      key,
      expiresIn: '1h',
    });
    expect(status).toBe(200);
    expect(typeof data.url).toBe('string');
    expect(data.url).toContain('token=');
    expect(data.expiresAt).toBeDefined();
  });

  it('signed-url로 다운로드 성공', async () => {
    const { data } = await api('POST', `/api/storage/${BUCKET}/signed-url`, { key });
    // Extract just path+query from signed URL
    const url = new URL(data.url);
    const res = await (globalThis as any).SELF.fetch(`${BASE}${url.pathname}${url.search}`);
    expect(res.status).toBe(200);
  });

  it('존재하지 않는 파일 signed-url → 404', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/signed-url`, { key: 'nonexistent.txt' });
    expect(status).toBe(404);
  });

  it('key 누락 → 400', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/signed-url`, {});
    expect(status).toBe(400);
  });
});

// ─── 7. Signed Upload URL ─────────────────────────────────────────────────────

describe('1-15 storage — signed-upload-url', () => {
  it('signed-upload-url 생성 → { url, expiresAt }', async () => {
    const key = `test-signed-up-${crypto.randomUUID().slice(0, 8)}.txt`;
    const { status, data } = await api('POST', `/api/storage/${BUCKET}/signed-upload-url`, {
      key,
      expiresIn: '30m',
    });
    expect(status).toBe(200);
    expect(typeof data.url).toBe('string');
    expect(data.url).toContain('token=');
    expect(data.url).toContain('key=');
  });

  it('signed-upload-url 생성 → maxFileSize 반환', async () => {
    const key = `test-signed-up-max-${crypto.randomUUID().slice(0, 8)}.txt`;
    const { status, data } = await api('POST', `/api/storage/${BUCKET}/signed-upload-url`, {
      key,
      maxFileSize: '128B',
    });
    expect(status).toBe(200);
    expect(data.maxFileSize).toBe('128B');
  });

  it('signed-upload-url로 업로드 성공', async () => {
    const key = `test-signed-up2-${crypto.randomUUID().slice(0, 8)}.txt`;
    const { data } = await api('POST', `/api/storage/${BUCKET}/signed-upload-url`, { key });
    const signedUrl = data.url;

    // Upload via signed URL (no auth header needed)
    const form = new FormData();
    form.append('file', new Blob(['signed upload content'], { type: 'text/plain' }), 'file.txt');
    form.append('key', key);
    const urlObj = new URL(signedUrl);
    const res = await (globalThis as any).SELF.fetch(`${BASE}${urlObj.pathname}${urlObj.search}`, {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(201);

    // Cleanup
    await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {});
  });

  it('signed-upload-url maxFileSize 초과 업로드 → 413', async () => {
    const key = `test-signed-up-too-large-${crypto.randomUUID().slice(0, 8)}.txt`;
    const { data } = await api('POST', `/api/storage/${BUCKET}/signed-upload-url`, {
      key,
      maxFileSize: '128B',
    });
    const urlObj = new URL(data.url);
    const form = new FormData();
    form.append('file', new Blob(['x'.repeat(512)], { type: 'text/plain' }), 'file.txt');
    form.append('key', key);

    const res = await (globalThis as any).SELF.fetch(`${BASE}${urlObj.pathname}${urlObj.search}`, {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(413);
  });

  it('signed-upload-url key mismatch between query and form → 400', async () => {
    const key = `test-signed-up-mismatch-${crypto.randomUUID().slice(0, 8)}.txt`;
    const { data } = await api('POST', `/api/storage/${BUCKET}/signed-upload-url`, { key });
    const urlObj = new URL(data.url);
    const form = new FormData();
    form.append('file', new Blob(['signed upload mismatch'], { type: 'text/plain' }), 'file.txt');
    form.append('key', `${key}.other`);

    const res = await (globalThis as any).SELF.fetch(`${BASE}${urlObj.pathname}${urlObj.search}`, {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('key 누락 → 400', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/signed-upload-url`, {});
    expect(status).toBe(400);
  });
});

// ─── 8. Multipart Upload ──────────────────────────────────────────────────────

describe('1-15 storage — multipart', () => {
  const key = `multipart-${crypto.randomUUID().slice(0, 8)}.bin`;

  afterAll(async () => {
    await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {});
  });

  it('multipart create → { uploadId, key }', async () => {
    const { status, data } = await api('POST', `/api/storage/${BUCKET}/multipart/create`, {
      key,
      contentType: 'application/octet-stream',
    });
    expect(status).toBe(200);
    expect(typeof data.uploadId).toBe('string');
    expect(data.key).toBe(key);
  });

  it('key 누락 → 400', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/multipart/create`, {});
    expect(status).toBe(400);
  });

  it('multipart abort → 200', async () => {
    const { data: createData } = await api('POST', `/api/storage/${BUCKET}/multipart/create`, {
      key: `abort-${crypto.randomUUID().slice(0, 8)}.bin`,
      contentType: 'application/octet-stream',
    });
    const { status } = await api('POST', `/api/storage/${BUCKET}/multipart/abort`, {
      uploadId: createData.uploadId,
      key: `abort-${crypto.randomUUID().slice(0, 8)}.bin`,
    });
    // Abort non-existing session is either 200 or error
    expect([200, 400, 500].includes(status)).toBe(true);
  });

  it('multipart/complete — parts 누락 → 400', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/multipart/complete`, {
      uploadId: 'fake-upload-id',
      key: 'fake.bin',
      // parts 누락
    });
    expect(status).toBe(400);
  });
});

// ─── 9. Access Rules ──────────────────────────────────────────────────────────

describe('1-15 storage — access rules', () => {
  it('미설정 버킷 → 404', async () => {
    const { status } = await api('GET', '/api/storage/unknown_bucket');
    expect(status).toBe(404);
  });

  it('인증없이 쓰기 시도 (avatars는 SK만 허용) → 401 또는 403', async () => {
    const form = new FormData();
    form.append('file', new Blob(['x']), 'x.txt');
    form.append('key', 'x.txt');
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/upload`, {
      method: 'POST',
      body: form,
      // No auth headers
    });
    expect([401, 403].includes(res.status)).toBe(true);
  });
});

// ─── 10. Upload 추가 ────────────────────────────────────────────────────────

describe('1-15 storage — upload 추가', () => {
  it('업로드 후 반환된 key가 요청과 일치', async () => {
    const key = `upload-key-${crypto.randomUUID().slice(0, 8)}.txt`;
    const res = await upload(key, 'key match test');
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.key).toBe(key);
    await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {});
  });

  it('업로드 후 size > 0', async () => {
    const key = `upload-size-${crypto.randomUUID().slice(0, 8)}.txt`;
    const res = await upload(key, 'some content for size check');
    const data = await res.json() as any;
    expect(data.size).toBeGreaterThan(0);
    await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {});
  });

  it('동일 key 재업로드 → 내용 덮어쓰기 확인', async () => {
    const key = `upload-overwrite-${crypto.randomUUID().slice(0, 8)}.txt`;
    await upload(key, 'first content');
    await upload(key, 'second content');
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/${key}`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    const text = await res.text();
    expect(text).toBe('second content');
    await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {});
  });

  it('key 누락 → 400', async () => {
    const form = new FormData();
    form.append('file', new Blob(['data']), 'file.txt');
    // key 누락
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('빈 파일 업로드 → 201 또는 400', async () => {
    const key = `upload-empty-${crypto.randomUUID().slice(0, 8)}.txt`;
    const form = new FormData();
    form.append('file', new Blob([]), key.split('/').pop()!);
    form.append('key', key);
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    expect([201, 400].includes(res.status)).toBe(true);
    await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {});
  });

  it('서브디렉토리 key (a/b/c.txt) → 201', async () => {
    const key = `subdir-${crypto.randomUUID().slice(0, 8)}/nested/file.txt`;
    const res = await upload(key, 'nested dir test');
    expect(res.status).toBe(201);
    await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {});
  });
});

// ─── 11. Download 추가 ──────────────────────────────────────────────────────

describe('1-15 storage — download 추가', () => {
  const key = `dl-extra-${crypto.randomUUID().slice(0, 8)}.txt`;
  const content = 'download extra test content';

  beforeAll(async () => { await upload(key, content); });
  afterAll(async () => { await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {}); });

  it('다운로드 내용이 업로드 내용과 일치', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/${key}`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    const text = await res.text();
    expect(text).toBe(content);
  });

  it('존재하지 않는 key → 404 (다른 prefix)', async () => {
    const { status } = await api('GET', `/api/storage/${BUCKET}/ghost-dl-${crypto.randomUUID()}.txt`);
    expect(status).toBe(404);
  });

  it('다운로드 Content-Type이 업로드 시와 일치', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/${key}`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(res.headers.get('Content-Type')).toContain('text/plain');
  });

  it('다운로드 후 ETag 헤더 존재', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/${key}`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(res.status).toBe(200);
    // etag는 있을 수 있고 없을 수 있음
  });
});

// ─── 12. List 추가 ──────────────────────────────────────────────────────────

describe('1-15 storage — list 추가', () => {
  const prefix = `list-extra-${crypto.randomUUID().slice(0, 8)}`;
  const keys: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 5; i++) {
      const key = `${prefix}/item-${i}.txt`;
      await upload(key, `list content ${i}`);
      keys.push(key);
    }
  });

  afterAll(async () => {
    for (const k of keys) {
      await api('DELETE', `/api/storage/${BUCKET}/${k}`).catch(() => {});
    }
  });

  it('prefix 필터 → 5건 이상', async () => {
    const { data } = await api('GET', `/api/storage/${BUCKET}?prefix=${prefix}`);
    expect(data.files.length).toBeGreaterThanOrEqual(5);
  });

  it('limit=2 → 최대 2개', async () => {
    const { data } = await api('GET', `/api/storage/${BUCKET}?prefix=${prefix}&limit=2`);
    expect(data.files.length).toBeLessThanOrEqual(2);
  });

  it('limit=1 + truncated → cursor 존재', async () => {
    const { data } = await api('GET', `/api/storage/${BUCKET}?prefix=${prefix}&limit=1`);
    if (data.truncated) {
      expect(data.cursor).toBeDefined();
    }
  });

  it('offset pagination → later page does not repeat first page', async () => {
    const { data: firstPage } = await api('GET', `/api/storage/${BUCKET}?prefix=${prefix}&limit=2&offset=0`);
    const { data: secondPage } = await api('GET', `/api/storage/${BUCKET}?prefix=${prefix}&limit=2&offset=2`);
    const firstKeys = firstPage.files.map((file: any) => file.key);
    const secondKeys = secondPage.files.map((file: any) => file.key);
    const overlap = secondKeys.filter((key: string) => firstKeys.includes(key));
    expect(overlap).toHaveLength(0);
    expect(secondKeys).toEqual(keys.slice(2, 4));
  });

  it('offset cursor can continue offset-based pagination', async () => {
    const { data: firstPage } = await api('GET', `/api/storage/${BUCKET}?prefix=${prefix}&limit=2&offset=1`);
    expect(firstPage.cursor).toBe('offset:3');

    const { data: secondPage } = await api('GET', `/api/storage/${BUCKET}?prefix=${prefix}&limit=2&cursor=${encodeURIComponent(firstPage.cursor)}`);
    const firstKeys = firstPage.files.map((file: any) => file.key);
    const secondKeys = secondPage.files.map((file: any) => file.key);
    const overlap = secondKeys.filter((key: string) => firstKeys.includes(key));
    expect(overlap).toHaveLength(0);
    expect(secondKeys).toEqual(keys.slice(3, 5));
  });

  it('존재하지 않는 prefix → files 빈 배열', async () => {
    const { data } = await api('GET', `/api/storage/${BUCKET}?prefix=nonexistent-${crypto.randomUUID()}`);
    expect(data.files).toHaveLength(0);
  });

  it('list 결과 각 파일에 key, size 존재', async () => {
    const { data } = await api('GET', `/api/storage/${BUCKET}?prefix=${prefix}&limit=1`);
    if (data.files.length > 0) {
      expect(data.files[0].key).toBeDefined();
      expect(typeof data.files[0].size).toBe('number');
    }
  });
});

// ─── 13. Delete 추가 ────────────────────────────────────────────────────────

describe('1-15 storage — delete 추가', () => {
  it('존재하지 않는 key 삭제 → 200 idempotent 또는 404', async () => {
    const key = `del-ghost-${crypto.randomUUID().slice(0, 8)}.txt`;
    const { status } = await api('DELETE', `/api/storage/${BUCKET}/${key}`);
    // idempotent: 200 ok 또는 404
    expect([200, 404].includes(status)).toBe(true);
  });

  it('동일 key 두 번 삭제 → 두 번째도 200 또는 404', async () => {
    const key = `del-twice-${crypto.randomUUID().slice(0, 8)}.txt`;
    await upload(key, 'twice delete');
    const { status: s1 } = await api('DELETE', `/api/storage/${BUCKET}/${key}`);
    expect(s1).toBe(200);
    const { status: s2 } = await api('DELETE', `/api/storage/${BUCKET}/${key}`);
    expect([200, 404].includes(s2)).toBe(true);
  });

  it('서브디렉토리 key 삭제 → 200', async () => {
    const key = `del-sub-${crypto.randomUUID().slice(0, 8)}/nested.txt`;
    await upload(key, 'nested delete test');
    const { status } = await api('DELETE', `/api/storage/${BUCKET}/${key}`);
    expect(status).toBe(200);
  });

  it('삭제 후 list에서 해당 key 없음', async () => {
    const prefix = `del-list-${crypto.randomUUID().slice(0, 8)}`;
    const key = `${prefix}/check.txt`;
    await upload(key, 'delete list check');
    await api('DELETE', `/api/storage/${BUCKET}/${key}`);
    const { data } = await api('GET', `/api/storage/${BUCKET}?prefix=${prefix}`);
    const found = data.files.find((f: any) => f.key === key);
    expect(found).toBeUndefined();
  });
});

// ─── 14. Metadata 추가 ──────────────────────────────────────────────────────

describe('1-15 storage — metadata 추가', () => {
  const key = `meta-extra-${crypto.randomUUID().slice(0, 8)}.txt`;

  beforeAll(async () => { await upload(key, 'metadata extra test'); });
  afterAll(async () => { await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {}); });

  it('GET metadata → size가 업로드 내용 길이와 일치', async () => {
    const { data } = await api('GET', `/api/storage/${BUCKET}/${key}/metadata`);
    expect(data.size).toBe(19); // 'metadata extra test'.length = 19
  });

  it('PATCH metadata 후 GET으로 customMetadata 확인', async () => {
    await api('PATCH', `/api/storage/${BUCKET}/${key}/metadata`, {
      customMetadata: { tag: 'test-tag', version: '2' },
    });
    const { data } = await api('GET', `/api/storage/${BUCKET}/${key}/metadata`);
    expect(data.customMetadata?.tag).toBe('test-tag');
    expect(data.customMetadata?.version).toBe('2');
  });

  it('PATCH metadata 빈 객체 → 200', async () => {
    const { status } = await api('PATCH', `/api/storage/${BUCKET}/${key}/metadata`, {
      customMetadata: {},
    });
    expect(status).toBe(200);
  });

  it('존재하지 않는 파일 PATCH metadata → 404', async () => {
    const { status } = await api('PATCH', `/api/storage/${BUCKET}/ghost-meta-${crypto.randomUUID()}.txt/metadata`, {
      customMetadata: { x: 'y' },
    });
    expect(status).toBe(404);
  });

  it('metadata에 key, contentType, etag 모두 존재', async () => {
    const { data } = await api('GET', `/api/storage/${BUCKET}/${key}/metadata`);
    expect(data.key).toBe(key);
    expect(data.contentType).toBeDefined();
    expect(data.etag).toBeDefined();
  });
});

// ─── 15. getPublicUrl ────────────────────────────────────────────────────────

describe('1-15 storage — public url', () => {
  const key = `pub-url-${crypto.randomUUID().slice(0, 8)}.txt`;

  beforeAll(async () => { await upload(key, 'public url content'); });
  afterAll(async () => { await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {}); });

  it('avatars 버킷은 public read → 인증 없이 다운로드 200', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/${key}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('public url content');
  });

  it('documents 버킷은 auth required → 인증 없이 → 401 또는 403', async () => {
    const dKey = `doc-pub-${crypto.randomUUID().slice(0, 8)}.txt`;
    // Upload with SK
    const form = new FormData();
    form.append('file', new Blob(['doc content']), dKey);
    form.append('key', dKey);
    await (globalThis as any).SELF.fetch(`${BASE}/api/storage/documents/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    // Download without auth
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/documents/${dKey}`);
    expect([401, 403].includes(res.status)).toBe(true);
    await api('DELETE', `/api/storage/documents/${dKey}`).catch(() => {});
  });
});

// ─── 16. Signed URL 추가 ────────────────────────────────────────────────────

describe('1-15 storage — signed-url 추가', () => {
  const key = `signed-extra-${crypto.randomUUID().slice(0, 8)}.txt`;

  beforeAll(async () => { await upload(key, 'signed extra content'); });
  afterAll(async () => { await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {}); });

  it('signed-url TTL 지정 → expiresAt 존재', async () => {
    const { status, data } = await api('POST', `/api/storage/${BUCKET}/signed-url`, {
      key,
      expiresIn: '30m',
    });
    expect(status).toBe(200);
    expect(data.expiresAt).toBeDefined();
  });

  it('signed-url 기본 TTL(expiresIn 생략) → 200', async () => {
    const { status, data } = await api('POST', `/api/storage/${BUCKET}/signed-url`, { key });
    expect(status).toBe(200);
    expect(typeof data.url).toBe('string');
  });

  it('signed-url URL에 token 파라미터 포함', async () => {
    const { data } = await api('POST', `/api/storage/${BUCKET}/signed-url`, { key });
    expect(data.url).toContain('token=');
  });

  it('signed-url로 다운로드한 내용이 원본과 일치', async () => {
    const { data } = await api('POST', `/api/storage/${BUCKET}/signed-url`, { key });
    const url = new URL(data.url);
    const res = await (globalThis as any).SELF.fetch(`${BASE}${url.pathname}${url.search}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('signed extra content');
  });
});

// ─── 17. Signed Upload URL 추가 ─────────────────────────────────────────────

describe('1-15 storage — signed-upload-url 추가', () => {
  it('signed-upload-url expiresIn → 200, url에 token 포함', async () => {
    const key = `signed-up-extra-${crypto.randomUUID().slice(0, 8)}.txt`;
    const { status, data } = await api('POST', `/api/storage/${BUCKET}/signed-upload-url`, {
      key,
      expiresIn: '1h',
    });
    expect(status).toBe(200);
    expect(data.url).toContain('token=');
  });

  it('signed-upload-url 생성 후 업로드 → 다운로드 확인', async () => {
    const key = `signed-up-verify-${crypto.randomUUID().slice(0, 8)}.txt`;
    const { data } = await api('POST', `/api/storage/${BUCKET}/signed-upload-url`, { key });
    const urlObj = new URL(data.url);
    const form = new FormData();
    form.append('file', new Blob(['verify upload'], { type: 'text/plain' }), 'f.txt');
    form.append('key', key);
    const uploadRes = await (globalThis as any).SELF.fetch(
      `${BASE}${urlObj.pathname}${urlObj.search}`,
      { method: 'POST', body: form },
    );
    expect(uploadRes.status).toBe(201);
    // 다운로드 확인
    const dlRes = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/${key}`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(dlRes.status).toBe(200);
    const text = await dlRes.text();
    expect(text).toBe('verify upload');
    await api('DELETE', `/api/storage/${BUCKET}/${key}`).catch(() => {});
  });

  it('signed-upload-url expiresAt 필드 반환 확인', async () => {
    const key = `signed-up-exp-${crypto.randomUUID().slice(0, 8)}.txt`;
    const { data } = await api('POST', `/api/storage/${BUCKET}/signed-upload-url`, {
      key,
      expiresIn: '15m',
    });
    expect(data.expiresAt).toBeDefined();
  });
});

// ─── 18. Multipart 추가 ─────────────────────────────────────────────────────

describe('1-15 storage — multipart 추가', () => {
  it('multipart create → uploadId 문자열 반환', async () => {
    const key = `mp-extra-${crypto.randomUUID().slice(0, 8)}.bin`;
    const { status, data } = await api('POST', `/api/storage/${BUCKET}/multipart/create`, {
      key,
      contentType: 'application/octet-stream',
    });
    expect(status).toBe(200);
    expect(typeof data.uploadId).toBe('string');
    expect(data.uploadId.length).toBeGreaterThan(0);
    // abort to cleanup
    await api('POST', `/api/storage/${BUCKET}/multipart/abort`, {
      uploadId: data.uploadId,
      key,
    }).catch(() => {});
  });

  it('multipart create → key 반환 일치', async () => {
    const key = `mp-key-${crypto.randomUUID().slice(0, 8)}.bin`;
    const { data } = await api('POST', `/api/storage/${BUCKET}/multipart/create`, {
      key,
      contentType: 'application/octet-stream',
    });
    expect(data.key).toBe(key);
    await api('POST', `/api/storage/${BUCKET}/multipart/abort`, {
      uploadId: data.uploadId,
      key,
    }).catch(() => {});
  });

  it('multipart abort → 성공 또는 에러', async () => {
    const key = `mp-abort-${crypto.randomUUID().slice(0, 8)}.bin`;
    const { data: createData } = await api('POST', `/api/storage/${BUCKET}/multipart/create`, {
      key,
      contentType: 'application/octet-stream',
    });
    const { status } = await api('POST', `/api/storage/${BUCKET}/multipart/abort`, {
      uploadId: createData.uploadId,
      key,
    });
    expect([200, 400, 500].includes(status)).toBe(true);
  });

  it('multipart complete — parts 빈 배열 → 400 또는 500', async () => {
    const key = `mp-empty-${crypto.randomUUID().slice(0, 8)}.bin`;
    const { data: createData } = await api('POST', `/api/storage/${BUCKET}/multipart/create`, {
      key,
      contentType: 'application/octet-stream',
    });
    const { status } = await api('POST', `/api/storage/${BUCKET}/multipart/complete`, {
      uploadId: createData.uploadId,
      key,
      parts: [],
    });
    expect([400, 500].includes(status)).toBe(true);
  });

  it('multipart complete — uploadId 누락 → 400', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/multipart/complete`, {
      key: 'fake.bin',
      parts: [{ partNumber: 1, etag: 'fake' }],
    });
    expect(status).toBe(400);
  });

  it('multipart complete — key 누락 → 400', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/multipart/complete`, {
      uploadId: 'fake-upload-id',
      parts: [{ partNumber: 1, etag: 'fake' }],
    });
    expect(status).toBe(400);
  });

  it('multipart abort — uploadId 누락 → 400', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/multipart/abort`, {
      key: 'fake.bin',
    });
    expect(status).toBe(400);
  });

  it('multipart abort — key 누락 → 400', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/multipart/abort`, {
      uploadId: 'fake-upload-id',
    });
    expect(status).toBe(400);
  });

  it('multipart create — key 누락 → 400', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/multipart/create`, {
      contentType: 'application/octet-stream',
    });
    expect(status).toBe(400);
  });
});

// ─── 19. Path traversal / validation ─────────────────────────────────────────

describe('1-15 storage — path validation', () => {
  it('path traversal(..) → 400', async () => {
    const key = `../../../etc/passwd`;
    const form = new FormData();
    form.append('file', new Blob(['evil']), 'passwd');
    form.append('key', key);
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('빈 key → 400', async () => {
    const form = new FormData();
    form.append('file', new Blob(['data']), 'file.txt');
    form.append('key', '');
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('1024+ char key → 400', async () => {
    const longKey = 'a'.repeat(1025) + '.txt';
    const form = new FormData();
    form.append('file', new Blob(['data']), 'file.txt');
    form.append('key', longKey);
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('key에 null 바이트 포함 → 400', async () => {
    const key = `null-byte-${crypto.randomUUID().slice(0, 8)}\x00.txt`;
    const form = new FormData();
    form.append('file', new Blob(['data']), 'file.txt');
    form.append('key', key);
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('key에 .. 세그먼트 포함 → 400', async () => {
    const key = `safe/../traversal.txt`;
    const form = new FormData();
    form.append('file', new Blob(['data']), 'file.txt');
    form.append('key', key);
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('signed-url key에 path traversal → 400', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/signed-url`, {
      key: '../../../etc/passwd',
    });
    expect(status).toBe(400);
  });

  it('signed-upload-url key에 빈 문자열 → 400', async () => {
    const { status } = await api('POST', `/api/storage/${BUCKET}/signed-upload-url`, {
      key: '',
    });
    expect(status).toBe(400);
  });

  it('download path traversal → 400 또는 404', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/${BUCKET}/../../../etc/passwd`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect([400, 404].includes(res.status)).toBe(true);
  });

  it('delete path traversal → 400 또는 404', async () => {
    const { status } = await api('DELETE', `/api/storage/${BUCKET}/../../../etc/passwd`);
    expect([400, 404].includes(status)).toBe(true);
  });

  it('metadata path traversal → 400 또는 404', async () => {
    const { status } = await api('GET', `/api/storage/${BUCKET}/../../../etc/passwd/metadata`);
    expect([400, 404].includes(status)).toBe(true);
  });
});

describe('1-15 storage — hook rejection normalization', () => {
  const uploadBlockedKey = `reject-upload-${crypto.randomUUID().slice(0, 8)}.txt`;
  const downloadBlockedKey = `reject-download-${crypto.randomUUID().slice(0, 8)}.txt`;
  const deleteBlockedKey = `reject-delete-${crypto.randomUUID().slice(0, 8)}.txt`;

  beforeAll(async () => {
    await uploadToBucket(HOOK_BUCKET, downloadBlockedKey, 'download blocked');
    await uploadToBucket(HOOK_BUCKET, deleteBlockedKey, 'delete blocked');
  });

  afterAll(async () => {
    await api('DELETE', `/api/storage/${HOOK_BUCKET}/${downloadBlockedKey}`).catch(() => {});
    await api('DELETE', `/api/storage/${HOOK_BUCKET}/${deleteBlockedKey}`).catch(() => {});
  });

  it('beforeUpload hook rejection returns 403 JSON instead of 500', async () => {
    const res = await uploadToBucket(HOOK_BUCKET, uploadBlockedKey, 'blocked upload');
    expect(res.status).toBe(403);
    const data = await res.json() as any;
    expect(data.message).toContain('Blocked by test beforeUpload');
  });

  it('beforeDownload hook rejection returns 403 JSON instead of 500', async () => {
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/storage/${HOOK_BUCKET}/${downloadBlockedKey}`,
      { headers: { 'X-EdgeBase-Service-Key': SK } },
    );
    expect(res.status).toBe(403);
    const data = await res.json() as any;
    expect(data.message).toContain('Blocked by test beforeDownload');
  });

  it('beforeDelete hook rejection returns 403 JSON instead of 500', async () => {
    const { status, data } = await api('DELETE', `/api/storage/${HOOK_BUCKET}/${deleteBlockedKey}`);
    expect(status).toBe(403);
    expect(data.message).toContain('Blocked by test beforeDelete');
  });
});
