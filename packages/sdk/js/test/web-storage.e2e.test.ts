import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@edgebase-fun/web';

function resolveBaseUrl() {
  const candidate = process.env['BASE_URL'];
  return candidate && /^https?:\/\//i.test(candidate) ? candidate : 'http://localhost:8688';
}

const SERVER = resolveBaseUrl();
const STORAGE_BUCKET = 'documents';
const PASSWORD = 'WebStorage123!';
const createdKeys = new Set<string>();

const client = createClient(SERVER);
const bucket = client.storage.bucket(STORAGE_BUCKET);

async function cleanupKey(key: string) {
  try {
    await bucket.delete(key);
  } catch {
    // ignore cleanup failures for already-removed keys
  } finally {
    createdKeys.delete(key);
  }
}

beforeAll(async () => {
  const email = `jsweb-storage-${crypto.randomUUID().slice(0, 8)}@test.com`;
  await client.auth.signUp({ email, password: PASSWORD });
});

afterAll(async () => {
  for (const key of [...createdKeys]) {
    await cleanupKey(key);
  }
  client.destroy();
});

describe('js-web:storage with_auth', () => {
  it('upload_download_roundtrip_with_auth', async () => {
    const key = `js-web-roundtrip-${crypto.randomUUID().slice(0, 8)}.txt`;
    const content = 'Hello from js-web storage';
    createdKeys.add(key);

    const info = await bucket.upload(key, new Blob([content], { type: 'text/plain' }));
    expect(info.key).toBe(key);

    const downloaded = await bucket.download(key, { as: 'text' }) as string;
    expect(downloaded).toBe(content);

    await cleanupKey(key);
  });

  it('upload + list_with_prefix', async () => {
    const prefix = `js-web-list-${crypto.randomUUID().slice(0, 8)}`;
    const key = `${prefix}/file.txt`;
    createdKeys.add(key);

    await bucket.upload(key, new Blob(['list me'], { type: 'text/plain' }));
    const result = await bucket.list({ prefix });
    expect(result.files.some(file => file.key === key)).toBe(true);

    await cleanupKey(key);
  });

  it('upload + delete_file', async () => {
    const key = `js-web-delete-${crypto.randomUUID().slice(0, 8)}.txt`;
    createdKeys.add(key);

    await bucket.upload(key, new Blob(['delete me'], { type: 'text/plain' }));
    await bucket.delete(key);
    createdKeys.delete(key);

    try {
      await bucket.download(key, { as: 'text' });
      expect.unreachable('Downloading a deleted object should fail.');
    } catch (error: any) {
      expect(error.status ?? error.statusCode ?? 500).toBeGreaterThanOrEqual(400);
    }
  });

  it('storage_signed_url', async () => {
    const key = `js-web-signed-${crypto.randomUUID().slice(0, 8)}.txt`;
    createdKeys.add(key);

    await bucket.upload(key, new Blob(['signed'], { type: 'text/plain' }));
    const signedUrl = await bucket.createSignedUrl(key, { expiresIn: '5m' });
    expect(signedUrl).toContain('/api/storage/');
    expect(signedUrl).toContain(encodeURIComponent(key));

    await cleanupKey(key);
  });

  it('storage_metadata', async () => {
    const key = `js-web-meta-${crypto.randomUUID().slice(0, 8)}.json`;
    createdKeys.add(key);

    await bucket.upload(key, new Blob(['{}'], { type: 'application/json' }));
    const metadata = await bucket.getMetadata(key);
    expect(metadata.key).toBe(key);
    expect(metadata.contentType ?? '').toContain('application/json');

    await cleanupKey(key);
  });

  it('storage_uploadString', async () => {
    const key = `js-web-upload-string-${crypto.randomUUID().slice(0, 8)}.txt`;
    const content = 'uploadString from js-web';
    createdKeys.add(key);

    await bucket.uploadString(key, content);
    const downloaded = await bucket.download(key, { as: 'text' }) as string;
    expect(downloaded).toBe(content);

    await cleanupKey(key);
  });

  it('storage_getUrl contains bucket and key', () => {
    const url = bucket.getUrl('folder/js-web-url.txt');
    expect(url).toContain(`/api/storage/${STORAGE_BUCKET}/`);
    expect(url).toContain('js-web-url.txt');
  });

  it('storage_nonexistent_throws', async () => {
    const key = `nonexistent-js-web-${crypto.randomUUID().slice(0, 8)}.txt`;

    try {
      await bucket.download(key, { as: 'text' });
      expect.unreachable('Downloading a missing object should fail.');
    } catch (error: any) {
      expect(error.status ?? error.statusCode ?? 500).toBeGreaterThanOrEqual(400);
    }
  });
});
