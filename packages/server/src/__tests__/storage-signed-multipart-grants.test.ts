import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig, EdgeBaseError } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import {
  isSignedUploadGrantMarker,
  SIGNED_MULTIPART_MAX_BYTES_METADATA_KEY,
  SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY,
  SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY,
  SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY,
} from '../lib/signed-upload-grants.js';
import { createSignedUploadToken, storageRoute } from '../routes/storage.js';
import type { Env } from '../types.js';

const BUCKET = 'documents';
const SECRET = 'signed-multipart-grant-test-secret';
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
    size: 0,
    etag,
    httpEtag: `"${etag}"`,
    checksums: {},
    uploaded: new Date(START),
    httpMetadata: {},
    customMetadata,
    range: undefined,
    storageClass: 'Standard',
    writeHttpMetadata: vi.fn(),
  } as unknown as R2Object;
}

function conditional(options: R2PutOptions): R2Conditional {
  return options.onlyIf as R2Conditional;
}

function signedUrl(path: string, key: string, token: string): string {
  const url = new URL(`https://storage.example.test/api/storage/${BUCKET}/${path}`);
  url.searchParams.set('key', key);
  url.searchParams.set('token', token);
  return url.toString();
}

function configureBucket(): void {
  setConfig(defineConfig({
    release: true,
    storage: {
      buckets: {
        [BUCKET]: { access: { write: () => false } },
      },
    },
  }));
}

afterEach(() => {
  setConfig({});
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('signed multipart upload grant binding', () => {
  it('lets only the winning claim create an R2 multipart session', async () => {
    configureBucket();
    const key = 'concurrent.bin';
    const token = await createSignedUploadToken(key, BUCKET, Date.now() + 60_000, SECRET);
    const concurrency = 64;
    let marker: R2Object | null = null;
    let initialHeads = 0;
    let releaseHeads!: () => void;
    const bothHeadsReached = new Promise<void>((resolve) => { releaseHeads = resolve; });
    const uploads = new Map<string, { abort: ReturnType<typeof vi.fn> }>();
    let nextUpload = 0;

    const head = vi.fn(async (fullKey: string) => {
      if (!isSignedUploadGrantMarker(fullKey)) return null;
      if (initialHeads < concurrency) {
        initialHeads += 1;
        if (initialHeads === concurrency) releaseHeads();
        await bothHeadsReached;
        return null;
      }
      return marker;
    });
    const put = vi.fn(async (fullKey: string, _value: unknown, options: R2PutOptions) => {
      if (conditional(options).etagDoesNotMatch === '*') {
        await Promise.resolve();
        if (marker) return null;
        marker = r2Object(fullKey, 'claim-etag', options.customMetadata);
        return marker;
      }
      if (conditional(options).etagMatches === marker?.etag) {
        marker = r2Object(fullKey, 'bound-etag', options.customMetadata);
        return marker;
      }
      return null;
    });
    const createMultipartUpload = vi.fn(async () => {
      const uploadId = `upload-${++nextUpload}`;
      const upload = { uploadId, abort: vi.fn().mockResolvedValue(undefined) };
      uploads.set(uploadId, upload);
      return upload as unknown as R2MultipartUpload;
    });
    const env = {
      JWT_USER_SECRET: SECRET,
      STORAGE: { head, put, createMultipartUpload } as unknown as R2Bucket,
    } as Env;
    const request = () => createApp().fetch(new Request(signedUrl('multipart/create', key, token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }), env, executionContext());

    const responses = await Promise.all(Array.from({ length: concurrency }, request));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 403)).toHaveLength(concurrency - 1);
    expect(createMultipartUpload).toHaveBeenCalledTimes(1);

    const success = responses.find((response) => response.status === 200)!;
    const { uploadId } = await success.json() as { uploadId: string };
    expect(marker).toMatchObject({
      customMetadata: {
        [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'multipart',
        [SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY]: uploadId,
      },
    });
    expect(uploads.get(uploadId)?.abort).not.toHaveBeenCalled();
    expect(uploads.size).toBe(1);
  });

  it('reuses a token only inside its bound session and rejects every other upload ID', async () => {
    configureBucket();
    const key = 'bound.bin';
    const token = await createSignedUploadToken(key, BUCKET, Date.now() + 60_000, SECRET);
    let marker: R2Object | null = null;
    const abort = vi.fn().mockResolvedValue(undefined);
    const uploadPart = vi.fn(async (partNumber: number) => ({ partNumber, etag: `part-${partNumber}` }));
    const resumeMultipartUpload = vi.fn(() => ({ abort, uploadPart } as unknown as R2MultipartUpload));
    const createMultipartUpload = vi.fn(async () => ({
      uploadId: 'upload-1',
      abort,
    } as unknown as R2MultipartUpload));
    const storage = {
      head: vi.fn(async (fullKey: string) => isSignedUploadGrantMarker(fullKey) ? marker : null),
      put: vi.fn(async (fullKey: string, _value: unknown, options: R2PutOptions) => {
        if (conditional(options).etagDoesNotMatch === '*') {
          if (marker) return null;
          marker = r2Object(fullKey, 'claim-etag', options.customMetadata);
          return marker;
        }
        if (conditional(options).etagMatches === marker?.etag) {
          marker = r2Object(fullKey, 'bound-etag', options.customMetadata);
          return marker;
        }
        return null;
      }),
      createMultipartUpload,
      resumeMultipartUpload,
    } as unknown as R2Bucket;
    const kv = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace;
    const env = { JWT_USER_SECRET: SECRET, STORAGE: storage, KV: kv } as Env;

    const created = await createApp().fetch(new Request(signedUrl('multipart/create', key, token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }), env, executionContext());
    expect(created.status).toBe(200);

    for (const partNumber of [1, 2]) {
      const url = new URL(signedUrl('multipart/upload-part', key, token));
      url.searchParams.set('uploadId', 'upload-1');
      url.searchParams.set('partNumber', String(partNumber));
      const response = await createApp().fetch(new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array([partNumber]),
      }), env, executionContext());
      expect(response.status).toBe(200);
    }
    expect(uploadPart).toHaveBeenCalledTimes(2);

    const wrongPartUrl = new URL(signedUrl('multipart/upload-part', key, token));
    wrongPartUrl.searchParams.set('uploadId', 'upload-2');
    wrongPartUrl.searchParams.set('partNumber', '3');
    const wrongPart = await createApp().fetch(new Request(wrongPartUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array([3]),
    }), env, executionContext());
    expect(wrongPart.status).toBe(403);

    const wrongParts = await createApp().fetch(new Request(
      signedUrl('uploads/upload-2/parts', key, token),
    ), env, executionContext());
    expect(wrongParts.status).toBe(403);

    const wrongComplete = await createApp().fetch(new Request(signedUrl('multipart/complete', key, token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId: 'upload-2',
        key,
        parts: [{ partNumber: 1, etag: 'part-1' }],
      }),
    }), env, executionContext());
    expect(wrongComplete.status).toBe(403);

    const wrongAbort = await createApp().fetch(new Request(signedUrl('multipart/abort', key, token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: 'upload-2', key }),
    }), env, executionContext());
    expect(wrongAbort.status).toBe(403);

    const boundAbort = await createApp().fetch(new Request(signedUrl('multipart/abort', key, token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: 'upload-1', key }),
    }), env, executionContext());
    expect(boundAbort.status).toBe(200);
    expect(abort).toHaveBeenCalledTimes(1);

    const replayCreate = await createApp().fetch(new Request(signedUrl('multipart/create', key, token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }), env, executionContext());
    expect(replayCreate.status).toBe(403);
    expect(createMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('reserves the aggregate maxFileSize before concurrent R2 part writes and aborts on overflow', async () => {
    configureBucket();
    const key = 'bounded-concurrent.bin';
    const token = await createSignedUploadToken(key, BUCKET, Date.now() + 60_000, SECRET, 8);
    let marker: R2Object | null = null;
    let revision = 0;
    const abort = vi.fn().mockResolvedValue(undefined);
    const uploadPart = vi.fn(async (partNumber: number) => ({
      partNumber,
      etag: `part-${partNumber}`,
    }));
    const resumeMultipartUpload = vi.fn(() => ({ abort, uploadPart } as unknown as R2MultipartUpload));
    const createMultipartUpload = vi.fn(async () => ({
      uploadId: 'upload-bounded',
      abort,
    } as unknown as R2MultipartUpload));
    const storage = {
      head: vi.fn(async (fullKey: string) => isSignedUploadGrantMarker(fullKey) ? marker : null),
      put: vi.fn(async (fullKey: string, _value: unknown, options: R2PutOptions) => {
        if (conditional(options).etagDoesNotMatch === '*') {
          if (marker) return null;
          revision += 1;
          marker = r2Object(fullKey, `etag-${revision}`, options.customMetadata);
          return marker;
        }
        const expectedEtag = conditional(options).etagMatches;
        await Promise.resolve();
        if (expectedEtag !== marker?.etag) return null;
        revision += 1;
        marker = r2Object(fullKey, `etag-${revision}`, options.customMetadata);
        return marker;
      }),
      createMultipartUpload,
      resumeMultipartUpload,
    } as unknown as R2Bucket;
    const kv = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace;
    const env = { JWT_USER_SECRET: SECRET, STORAGE: storage, KV: kv } as Env;

    const created = await createApp().fetch(new Request(signedUrl('multipart/create', key, token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }), env, executionContext());
    expect(created.status).toBe(200);
    expect(marker).toMatchObject({
      customMetadata: {
        [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'multipart',
        [SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY]: 'upload-bounded',
        [SIGNED_MULTIPART_MAX_BYTES_METADATA_KEY]: '8',
        [SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY]: '0',
      },
    });

    const requestPart = (partNumber: number) => {
      const url = new URL(signedUrl('multipart/upload-part', key, token));
      url.searchParams.set('uploadId', 'upload-bounded');
      url.searchParams.set('partNumber', String(partNumber));
      return createApp().fetch(new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '2',
        },
        body: new Uint8Array([partNumber, partNumber]),
      }), env, executionContext());
    };

    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => requestPart(index + 1)));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(4);
    expect(responses.filter((response) => response.status === 413)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 403)).toHaveLength(3);
    expect(uploadPart).toHaveBeenCalledTimes(4);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(kv.delete).toHaveBeenCalledTimes(1);
    expect(marker).toMatchObject({
      customMetadata: {
        [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'failed',
        [SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY]: 'upload-bounded',
        [SIGNED_MULTIPART_MAX_BYTES_METADATA_KEY]: '8',
        [SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY]: '8',
      },
    });

    const replay = await requestPart(9);
    expect(replay.status).toBe(403);
    expect(uploadPart).toHaveBeenCalledTimes(4);
  });

  it('terminally closes the claim when R2 create fails and requires a new token', async () => {
    configureBucket();
    const key = 'create-failure.bin';
    const token = await createSignedUploadToken(key, BUCKET, Date.now() + 60_000, SECRET);
    let marker: R2Object | null = null;
    const put = vi.fn(async (fullKey: string, _value: unknown, options: R2PutOptions) => {
      if (conditional(options).etagDoesNotMatch === '*') {
        if (marker) return null;
        marker = r2Object(fullKey, 'claim-etag', options.customMetadata);
        return marker;
      }
      if (conditional(options).etagMatches === marker?.etag) {
        marker = r2Object(fullKey, 'failed-etag', options.customMetadata);
        return marker;
      }
      return null;
    });
    const createMultipartUpload = vi.fn().mockRejectedValue(new Error('ambiguous R2 create failure'));
    const env = {
      JWT_USER_SECRET: SECRET,
      STORAGE: {
        head: vi.fn(async (fullKey: string) => isSignedUploadGrantMarker(fullKey) ? marker : null),
        put,
        createMultipartUpload,
      } as unknown as R2Bucket,
    } as Env;
    const request = () => createApp().fetch(new Request(signedUrl('multipart/create', key, token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }), env, executionContext());

    const failedCreate = await request();
    expect(failedCreate.status).toBe(500);
    expect(marker).toMatchObject({
      customMetadata: { [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'failed' },
    });

    const replay = await request();
    expect(replay.status).toBe(403);
    expect(createMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('aborts a newly created session when the grant expires before binding', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    configureBucket();
    const key = 'expires-during-create.bin';
    const token = await createSignedUploadToken(key, BUCKET, START + 1_000, SECRET);
    const abort = vi.fn().mockResolvedValue(undefined);
    let marker: R2Object | null = null;
    const put = vi.fn(async (fullKey: string, _value: unknown, options: R2PutOptions) => {
      if (conditional(options).etagDoesNotMatch === '*') {
        marker = r2Object(fullKey, 'claim-etag', options.customMetadata);
        return marker;
      }
      if (conditional(options).etagMatches === marker?.etag) {
        marker = r2Object(fullKey, 'failed-etag', options.customMetadata);
        return marker;
      }
      return null;
    });
    const createMultipartUpload = vi.fn(async () => {
      vi.setSystemTime(START + 1_000);
      return { uploadId: 'upload-expired', abort } as unknown as R2MultipartUpload;
    });
    const env = {
      JWT_USER_SECRET: SECRET,
      STORAGE: {
        head: vi.fn().mockResolvedValue(null),
        put,
        createMultipartUpload,
      } as unknown as R2Bucket,
    } as Env;

    const response = await createApp().fetch(new Request(signedUrl('multipart/create', key, token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }), env, executionContext());

    expect(response.status).toBe(403);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(2);
    expect(marker).toMatchObject({
      customMetadata: { [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'failed' },
    });
  });
});
