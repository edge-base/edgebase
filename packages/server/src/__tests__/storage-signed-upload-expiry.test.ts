import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig, EdgeBaseError } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { createSignedUploadToken, partTrackingKey, storageRoute } from '../routes/storage.js';
import {
  isSignedUploadGrantMarker,
  SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY,
  SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY,
} from '../lib/signed-upload-grants.js';
import type { Env } from '../types.js';

const BUCKET = 'avatars';
const SECRET = 'signed-upload-expiry-test-secret';
const START = Date.UTC(2026, 6, 11, 0, 0, 0);

function createApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.onError((error, c) => error instanceof EdgeBaseError
    ? c.json(error.toJSON(), error.code as 403)
    : c.json({ code: 500, message: 'Internal server error.' }, 500));
  app.route('/api/storage', storageRoute);
  return app;
}

function executionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function r2Object(
  fullKey: string,
  etag: string,
  customMetadata: Record<string, string> = {},
): R2Object {
  return {
    key: fullKey,
    version: etag,
    size: 5,
    etag,
    httpEtag: `"${etag}"`,
    checksums: {},
    uploaded: new Date(START),
    httpMetadata: { contentType: 'text/plain' },
    customMetadata,
    range: undefined,
    storageClass: 'Standard',
    writeHttpMetadata: vi.fn(),
  } as unknown as R2Object;
}

function storedObject(key: string, etag: string): R2Object {
  return r2Object(`${BUCKET}/${key}`, etag);
}

function configureBucket(beforeUpload?: () => void) {
  setConfig(defineConfig({
    release: true,
    storage: {
      buckets: {
        [BUCKET]: {
          access: { write: () => false },
          ...(beforeUpload
            ? { handlers: { hooks: { beforeUpload: async () => beforeUpload() } } }
            : {}),
        },
      },
    },
  }));
}

async function signedUploadRequest(key: string, token: string, env: Env): Promise<Response> {
  const form = new FormData();
  form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
  form.append('key', key);
  return createApp().fetch(new Request(
    `https://storage.example.test/api/storage/${BUCKET}/upload?token=${encodeURIComponent(token)}&key=${encodeURIComponent(key)}`,
    { method: 'POST', body: form },
  ), env, executionContext());
}

afterEach(() => {
  setConfig({});
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('signed upload expiry commit boundary', () => {
  it('allows the one request consumed while valid to finish after body processing crosses expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const expiresAt = START + 1_000;
    const key = 'expires-before-put.txt';
    const token = await createSignedUploadToken(key, BUCKET, expiresAt, SECRET);
    configureBucket(() => vi.setSystemTime(expiresAt));

    const put = vi.fn(async (fullKey: string) => {
      if (isSignedUploadGrantMarker(fullKey)) return r2Object(fullKey, 'grant-marker');
      return storedObject(key, 'valid-start-data-write');
    });
    const response = await signedUploadRequest(key, token, {
      JWT_USER_SECRET: SECRET,
      STORAGE: { put, head: vi.fn(), delete: vi.fn() } as unknown as R2Bucket,
    } as Env);

    expect(response.status).toBe(201);
    expect(put).toHaveBeenCalledTimes(2);
    expect(isSignedUploadGrantMarker(put.mock.calls[0]![0])).toBe(true);
    expect(put.mock.calls[1]![0]).toBe(`${BUCKET}/${key}`);
  });

  it('never deletes a write whose put finishes at the exact expiry boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const expiresAt = START + 1_000;
    const key = 'late-put.txt';
    const token = await createSignedUploadToken(key, BUCKET, expiresAt, SECRET);
    configureBucket();

    let current: R2Object | null = null;
    const put = vi.fn(async (fullKey: string) => {
      if (isSignedUploadGrantMarker(fullKey)) return r2Object(fullKey, 'grant-marker');
      current = storedObject(key, 'expired-write');
      vi.setSystemTime(expiresAt);
      return current;
    });
    const head = vi.fn(async () => current);
    const remove = vi.fn(async () => { current = null; });
    const response = await signedUploadRequest(key, token, {
      JWT_USER_SECRET: SECRET,
      STORAGE: { put, head, delete: remove } as unknown as R2Bucket,
    } as Env);

    expect(response.status).toBe(201);
    expect(head).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(current).not.toBeNull();
  });

  it('cannot delete a newer object that supersedes a request finishing after expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const expiresAt = START + 1_000;
    const key = 'superseded-late-put.txt';
    const token = await createSignedUploadToken(key, BUCKET, expiresAt, SECRET);
    configureBucket();

    const expiredWrite = storedObject(key, 'expired-write');
    const newerWrite = storedObject(key, 'newer-write');
    let current: R2Object | null = null;
    const put = vi.fn(async (fullKey: string) => {
      if (isSignedUploadGrantMarker(fullKey)) return r2Object(fullKey, 'grant-marker');
      current = expiredWrite;
      vi.setSystemTime(expiresAt);
      current = newerWrite;
      return expiredWrite;
    });
    const head = vi.fn();
    const remove = vi.fn();
    const response = await signedUploadRequest(key, token, {
      JWT_USER_SECRET: SECRET,
      STORAGE: { put, head, delete: remove } as unknown as R2Bucket,
    } as Env);

    expect(response.status).toBe(201);
    expect(head).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(current).toBe(newerWrite);
  });

  it('consumes the one-time grant before parsing a malformed request body', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const key = 'malformed-attempt.txt';
    const token = await createSignedUploadToken(key, BUCKET, START + 60_000, SECRET);
    configureBucket();

    let marker: R2Object | null = null;
    const put = vi.fn(async (fullKey: string) => {
      if (!isSignedUploadGrantMarker(fullKey)) {
        throw new Error('malformed signed upload must not write user data');
      }
      if (marker) return null;
      marker = r2Object(fullKey, 'consumed-before-parse');
      return marker;
    });
    const env = {
      JWT_USER_SECRET: SECRET,
      STORAGE: { put } as unknown as R2Bucket,
    } as Env;
    const url = `https://storage.example.test/api/storage/${BUCKET}/upload?token=${encodeURIComponent(token)}&key=${encodeURIComponent(key)}`;

    const malformed = await createApp().fetch(new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not multipart',
    }), env, executionContext());
    expect(malformed.status).toBe(400);

    const replay = await createApp().fetch(new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not multipart again',
    }), env, executionContext());
    expect(replay.status).toBe(403);
    expect(await replay.json()).toMatchObject({
      message: 'Signed upload token has already been used or revoked.',
      slug: 'access-denied',
    });
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls.every(([fullKey]) => isSignedUploadGrantMarker(fullKey))).toBe(true);
  });

  it('burns an oversized signed upload attempt so its body cost cannot be replayed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const key = 'oversized-attempt.txt';
    const token = await createSignedUploadToken(key, BUCKET, START + 60_000, SECRET, 1);
    configureBucket();

    let marker: R2Object | null = null;
    const put = vi.fn(async (fullKey: string) => {
      if (!isSignedUploadGrantMarker(fullKey)) {
        throw new Error('oversized signed upload must not write user data');
      }
      if (marker) return null;
      marker = r2Object(fullKey, 'consumed-before-size-check');
      return marker;
    });
    const env = {
      JWT_USER_SECRET: SECRET,
      STORAGE: { put } as unknown as R2Bucket,
    } as Env;

    const first = await signedUploadRequest(key, token, env);
    expect(first.status).toBe(413);
    const replay = await signedUploadRequest(key, token, env);
    expect(replay.status).toBe(403);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls.every(([fullKey]) => isSignedUploadGrantMarker(fullKey))).toBe(true);
  });

  it('rejects replay after the first upload is deleted by the application', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const key = 'single-use-after-delete.txt';
    const token = await createSignedUploadToken(key, BUCKET, START + 60_000, SECRET);
    configureBucket();

    let marker: R2Object | null = null;
    let current: R2Object | null = null;
    let dataWrites = 0;
    const put = vi.fn(async (fullKey: string) => {
      if (isSignedUploadGrantMarker(fullKey)) {
        if (marker) return null;
        marker = r2Object(fullKey, 'consumed-grant');
        return marker;
      }
      dataWrites += 1;
      current = storedObject(key, `data-${dataWrites}`);
      return current;
    });
    const head = vi.fn(async (fullKey: string) => isSignedUploadGrantMarker(fullKey) ? marker : current);
    const env = {
      JWT_USER_SECRET: SECRET,
      STORAGE: { put, head, delete: vi.fn() } as unknown as R2Bucket,
    } as Env;

    const first = await signedUploadRequest(key, token, env);
    expect(first.status).toBe(201);
    expect(current).not.toBeNull();

    // Simulate the app deleting the completed object while the URL has TTL left.
    current = null;
    const replay = await signedUploadRequest(key, token, env);

    expect(replay.status).toBe(403);
    expect(await replay.json()).toMatchObject({
      message: 'Signed upload token has already been used or revoked.',
      slug: 'access-denied',
    });
    expect(dataWrites).toBe(1);
    expect(current).toBeNull();
  });

  it('allows only one of two concurrent replay attempts to commit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const key = 'concurrent-single-use.txt';
    const token = await createSignedUploadToken(key, BUCKET, START + 60_000, SECRET);
    configureBucket();

    let marker: R2Object | null = null;
    let current: R2Object | null = null;
    let dataWrites = 0;
    const put = vi.fn(async (fullKey: string) => {
      if (isSignedUploadGrantMarker(fullKey)) {
        if (marker) return null;
        marker = r2Object(fullKey, 'consumed-grant');
        return marker;
      }
      dataWrites += 1;
      current = storedObject(key, `data-${dataWrites}`);
      return current;
    });
    const head = vi.fn(async (fullKey: string) => isSignedUploadGrantMarker(fullKey) ? marker : current);
    const env = {
      JWT_USER_SECRET: SECRET,
      STORAGE: { put, head, delete: vi.fn() } as unknown as R2Bucket,
    } as Env;

    const responses = await Promise.all([
      signedUploadRequest(key, token, env),
      signedUploadRequest(key, token, env),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 403]);
    expect(dataWrites).toBe(1);
    expect(current).not.toBeNull();
  });

  it('allows a signed multipart completion started while valid to finish after expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const expiresAt = START + 1_000;
    const key = 'late-multipart.txt';
    const token = await createSignedUploadToken(key, BUCKET, expiresAt, SECRET);
    configureBucket();

    let current: R2Object | null = null;
    const complete = vi.fn(async () => {
      current = storedObject(key, 'expired-multipart');
      vi.setSystemTime(expiresAt);
      return current;
    });
    const head = vi.fn(async (fullKey: string) => isSignedUploadGrantMarker(fullKey)
      ? r2Object(fullKey, 'bound-grant', {
        [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'multipart',
        [SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY]: 'upload-1',
      })
      : current);
    const remove = vi.fn(async () => { current = null; });
    const kvDelete = vi.fn().mockResolvedValue(undefined);
    const env = {
      JWT_USER_SECRET: SECRET,
      STORAGE: {
        resumeMultipartUpload: vi.fn(() => ({ complete })),
        head,
        delete: remove,
      } as unknown as R2Bucket,
      KV: { delete: kvDelete } as unknown as KVNamespace,
    } as Env;

    const response = await createApp().fetch(new Request(
      `https://storage.example.test/api/storage/${BUCKET}/multipart/complete?token=${encodeURIComponent(token)}&key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: 'upload-1',
          key,
          parts: [{ partNumber: 1, etag: 'part-1' }],
        }),
      },
    ), env, executionContext());

    expect(response.status).toBe(200);
    expect(complete).toHaveBeenCalledWith([{ partNumber: 1, etag: 'part-1' }]);
    expect(remove).not.toHaveBeenCalled();
    expect(current).not.toBeNull();
    expect(kvDelete).toHaveBeenCalledWith(partTrackingKey(BUCKET, key, 'upload-1'));
  });
});
