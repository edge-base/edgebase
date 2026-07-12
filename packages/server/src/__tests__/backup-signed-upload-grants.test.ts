import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { SIGNED_UPLOAD_GRANT_PREFIX } from '../lib/signed-upload-grants.js';
import { backupRoute } from '../routes/backup.js';
import type { Env } from '../types.js';

function createApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.route('/admin/api/backup', backupRoute);
  return app;
}

function configureServiceKey() {
  setConfig(defineConfig({
    release: true,
    serviceKeys: {
      keys: [{
        kid: 'root',
        tier: 'root',
        scopes: ['*'],
        secretSource: 'inline',
        inlineSecret: 'sk-backup-test',
      }],
    },
  }));
}

function r2Object(key: string): R2Object {
  return {
    key,
    size: 1,
    etag: `etag-${key}`,
    httpMetadata: { contentType: 'text/plain' },
  } as unknown as R2Object;
}

afterEach(() => {
  setConfig({});
  vi.restoreAllMocks();
});

describe('backup maintenance and signed upload grants', () => {
  it('preserves consumed grant markers during storage wipe', async () => {
    configureServiceKey();
    const marker = `${SIGNED_UPLOAD_GRANT_PREFIX}1999999999999/${'a'.repeat(32)}`;
    const userKey = 'avatars/user-file.txt';
    const remove = vi.fn().mockResolvedValue(undefined);
    const env = {
      STORAGE: {
        list: vi.fn().mockResolvedValue({
          objects: [r2Object(marker), r2Object(userKey)],
          truncated: false,
        }),
        delete: remove,
      } as unknown as R2Bucket,
    } as Env;

    const response = await createApp().fetch(new Request(
      'https://backup.example.test/admin/api/backup/restore-storage?action=wipe',
      {
        method: 'POST',
        headers: { 'X-EdgeBase-Service-Key': 'sk-backup-test' },
      },
    ), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, deleted: 1 });
    expect(remove).toHaveBeenCalledWith([userKey]);
  });

  it('keeps internal grant markers out of storage exports', async () => {
    configureServiceKey();
    const marker = `${SIGNED_UPLOAD_GRANT_PREFIX}1999999999999/${'b'.repeat(32)}`;
    const userKey = 'avatars/exported.txt';
    const env = {
      STORAGE: {
        list: vi.fn().mockResolvedValue({
          objects: [r2Object(marker), r2Object(userKey)],
          truncated: false,
        }),
      } as unknown as R2Bucket,
    } as Env;

    const response = await createApp().fetch(new Request(
      'https://backup.example.test/admin/api/backup/dump-storage?action=list',
      {
        method: 'POST',
        headers: { 'X-EdgeBase-Service-Key': 'sk-backup-test' },
      },
    ), env);
    const body = await response.json() as { objects: Array<{ key: string }>; total: number };

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.objects.map((object) => object.key)).toEqual([userKey]);
  });
});
