import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { renameBackingTable, startSidecar, type SidecarOptions } from '../src/lib/dev-sidecar.js';

let projectDir: string;
let configPath: string;
let fetchMock: ReturnType<typeof vi.fn>;

function writeConfig(content: string): void {
  writeFileSync(configPath, content, 'utf-8');
}

function sidecarOptions(): SidecarOptions {
  return {
    port: 8788,
    workerPort: 8787,
    projectDir,
    configPath,
    adminSecret: 'secret',
  };
}

describe('renameBackingTable', () => {
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'edgebase-sidecar-test-'));
    configPath = join(projectDir, 'edgebase.config.ts');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('renames the physical table for static namespaces via the worker SQL route', async () => {
    writeConfig(`import { defineConfig } from '@edgebase/shared';

export default defineConfig({
  databases: {
    shared: {
      tables: {
        users: {
          schema: {
            name: { type: 'string' },
          },
        },
      },
    },
  },
});
`);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ rows: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await renameBackingTable(sidecarOptions(), 'Bearer admin-token', 'shared', 'users', 'accounts');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/admin/api/data/sql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-token',
        }),
      }),
    );
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      namespace: 'shared',
      sql: 'ALTER TABLE "users" RENAME TO "accounts"',
      params: [],
    });
  });

  it('treats a missing physical table as a no-op so config-only tables can still be renamed', async () => {
    writeConfig(`import { defineConfig } from '@edgebase/shared';

export default defineConfig({
  databases: {
    shared: {
      tables: {
        drafts: {
          schema: {
            title: { type: 'string' },
          },
        },
      },
    },
  },
});
`);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'no such table: drafts' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      renameBackingTable(sidecarOptions(), 'Bearer admin-token', 'shared', 'drafts', 'articles'),
    ).resolves.toBeUndefined();
  });

  it('fails closed for dynamic namespaces instead of pretending the rename is global', async () => {
    writeConfig(`import { defineConfig } from '@edgebase/shared';

export default defineConfig({
  databases: {
    workspace: {
      instance: true,
      tables: {
        members: {
          schema: {
            userId: { type: 'string' },
          },
        },
      },
    },
  },
});
`);

    await expect(
      renameBackingTable(sidecarOptions(), 'Bearer admin-token', 'workspace', 'members', 'accounts'),
    ).rejects.toThrow(/dynamic namespace 'workspace'/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('auth settings sidecar', () => {
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'edgebase-sidecar-auth-test-'));
    configPath = join(projectDir, 'edgebase.config.ts');
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('writes enabled oauth providers to the targeted env file', async () => {
    writeConfig(`import { defineConfig } from '@edgebase/shared';

export default defineConfig({
  auth: {
    oauth: {
      google: {
        clientId: process.env.EDGEBASE_OAUTH_GOOGLE_CLIENT_ID ?? '',
        clientSecret: process.env.EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET ?? '',
      },
      discord: {
        clientId: process.env.EDGEBASE_OAUTH_DISCORD_CLIENT_ID ?? '',
        clientSecret: process.env.EDGEBASE_OAUTH_DISCORD_CLIENT_SECRET ?? '',
      },
    },
    allowedOAuthProviders: Array.from(
      new Set(
        (process.env.EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ),
  },
});
`);

    writeFileSync(join(projectDir, '.env.development'), [
      '# EdgeBase local development secrets',
      '',
      'JWT_ADMIN_SECRET=secret',
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=gid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=gsecret',
      '',
    ].join('\n'), 'utf-8');
    writeFileSync(join(projectDir, '.dev.vars'), [
      'JWT_ADMIN_SECRET=secret',
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=gid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=gsecret',
      '',
    ].join('\n'), 'utf-8');

    const server = startSidecar({
      ...sidecarOptions(),
      port: 0,
    });
    await once(server, 'listening');

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected sidecar to listen on a TCP port.');
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/auth/settings?target=development`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Internal-Secret': 'secret',
        },
        body: JSON.stringify({
          emailAuth: true,
          anonymousAuth: false,
          allowedOAuthProviders: ['google', 'discord'],
          allowedRedirectUrls: [],
          session: {
            accessTokenTTL: '15m',
            refreshTokenTTL: '7d',
            maxActiveSessions: null,
          },
          magicLink: {
            enabled: false,
            autoCreate: true,
            tokenTTL: null,
          },
          emailOtp: {
            enabled: false,
            autoCreate: true,
          },
          passkeys: {
            enabled: false,
            rpName: null,
            rpID: null,
            origin: [],
          },
          oauth: {
            google: {
              clientId: 'gid',
              clientSecret: 'gsecret',
            },
            discord: {
              clientId: 'did',
              clientSecret: 'dsecret',
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(readFileSync(join(projectDir, '.env.development'), 'utf-8')).toContain(
        'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google,discord',
      );
      expect(readFileSync(join(projectDir, '.env.development'), 'utf-8')).toContain(
        'EDGEBASE_OAUTH_DISCORD_CLIENT_ID=did',
      );
      expect(readFileSync(join(projectDir, '.dev.vars'), 'utf-8')).toContain(
        'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google,discord',
      );
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
