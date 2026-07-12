import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig, EdgeBaseError } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { storageRoute } from '../routes/storage.js';
import type { Env } from '../types.js';

const BUCKET = 'private-files';

function storedObject(key: string, uploadedBy: string): R2Object {
  return {
    key: `${BUCKET}/${key}`,
    version: `version-${key}`,
    size: 5,
    etag: `etag-${key}`,
    httpEtag: `"etag-${key}"`,
    checksums: {},
    uploaded: new Date('2026-07-11T00:00:00.000Z'),
    httpMetadata: { contentType: 'text/plain' },
    customMetadata: { uploadedBy },
    range: undefined,
    storageClass: 'Standard',
    writeHttpMetadata: vi.fn(),
  } as unknown as R2Object;
}

function createApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.onError((error, c) =>
    error instanceof EdgeBaseError
      ? c.json(error.toJSON(), error.code as 403)
      : c.json({ code: 500, message: 'Internal server error.' }, 500),
  );
  app.use('/api/storage/*', async (c, next) => {
    c.set('auth', {
      id: 'owner-user',
      role: 'user',
      isAnonymous: false,
      meta: {},
    });
    await next();
  });
  app.route('/api/storage', storageRoute);
  return app;
}

async function request(path: string, body: unknown, env: Env): Promise<Response> {
  return await createApp().fetch(
    new Request(`https://storage.example.test/api/storage/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
    {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext,
  );
}

afterEach(() => {
  setConfig({});
  vi.restoreAllMocks();
});

describe('signed download URL object authority', () => {
  it('evaluates a single signed URL against the stored object metadata', async () => {
    setConfig(
      defineConfig({
        release: true,
        storage: {
          buckets: {
            [BUCKET]: {
              access: {
                read: (auth, file) => auth?.id === file.uploadedBy,
              },
            },
          },
        },
      }),
    );
    const objects = new Map([
      [`${BUCKET}/owned.txt`, storedObject('owned.txt', 'owner-user')],
      [`${BUCKET}/other.txt`, storedObject('other.txt', 'other-user')],
    ]);
    const env = {
      JWT_USER_SECRET: 'signed-url-authority-secret',
      STORAGE: {
        head: vi.fn(async (key: string) => objects.get(key) ?? null),
      } as unknown as R2Bucket,
    } as Env;

    await expect(request('signed-url', { key: 'owned.txt' }, env)).resolves.toMatchObject({
      status: 200,
    });
    await expect(request('signed-url', { key: 'other.txt' }, env)).resolves.toMatchObject({
      status: 403,
    });
  });

  it('does not let a list-level empty-resource allowance authorize a mixed batch', async () => {
    setConfig(
      defineConfig({
        release: true,
        storage: {
          buckets: {
            [BUCKET]: {
              access: {
                read: (auth, file) =>
                  Object.keys(file).length === 0 || auth?.id === file.uploadedBy,
              },
            },
          },
        },
      }),
    );
    const objects = new Map([
      [`${BUCKET}/owned.txt`, storedObject('owned.txt', 'owner-user')],
      [`${BUCKET}/other.txt`, storedObject('other.txt', 'other-user')],
    ]);
    const env = {
      JWT_USER_SECRET: 'signed-url-authority-secret',
      STORAGE: {
        head: vi.fn(async (key: string) => objects.get(key) ?? null),
      } as unknown as R2Bucket,
    } as Env;

    const response = await request('signed-urls', { keys: ['owned.txt', 'other.txt'] }, env);
    expect(response.status).toBe(403);
  });
});
