import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edgebase-fun/shared';
import { setConfig } from '../lib/do-router.js';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { storageRoute } from '../routes/storage.js';
import type { Env } from '../types.js';

function createApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.route('/api/storage', storageRoute);
  return app;
}

function createEnv(): Env {
  return {
    STORAGE: {
      put: vi.fn().mockResolvedValue({
        key: 'avatars/notify/upload.txt',
        size: 5,
        etag: 'etag-1',
        uploaded: new Date('2025-01-01T00:00:00.000Z'),
        httpMetadata: { contentType: 'text/plain' },
        customMetadata: {},
      }),
    },
  } as unknown as Env;
}

describe('Storage hook context', () => {
  afterEach(() => {
    setConfig({});
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('routes push self-calls through the request origin using the root service key', async () => {
    setConfig(defineConfig({
      release: true,
      serviceKeys: {
        keys: [
          {
            kid: 'storage-write',
            tier: 'scoped',
            scopes: ['storage:bucket:avatars:write'],
            secretSource: 'inline',
            inlineSecret: 'sk-storage-write',
          },
          {
            kid: 'root',
            tier: 'root',
            scopes: ['*'],
            secretSource: 'inline',
            inlineSecret: 'sk-root',
          },
        ],
      },
      storage: {
        buckets: {
          avatars: {
            access: {
              write: () => true,
            },
            handlers: {
              hooks: {
                beforeUpload: async (_auth, file, ctx) => {
                  await ctx.push.send('user-123', { body: `Uploaded ${file.key}` });
                },
              },
            },
          },
        },
      },
    }));

    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ sent: 1, failed: 0, removed: 0 }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const app = createApp();
    const form = new FormData();
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
    form.append('key', 'notify/upload.txt');
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const response = await app.fetch(new Request('https://storage.example.test/api/storage/avatars/upload', {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': 'sk-root' },
      body: form,
    }), createEnv(), executionCtx);

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://storage.example.test/api/push/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': 'sk-root',
        }),
        body: JSON.stringify({
          userId: 'user-123',
          payload: { body: 'Uploaded notify/upload.txt' },
        }),
      }),
    );
  });
});
