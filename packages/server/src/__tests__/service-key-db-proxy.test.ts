import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { EdgeBaseError } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { authMiddleware } from '../middleware/auth.js';
import { errorHandlerMiddleware } from '../middleware/error-handler.js';
import { rulesMiddleware } from '../middleware/rules.js';
import { tablesRoute } from '../routes/tables.js';
import type { Env } from '../types.js';

function createApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.onError((err, c) => {
    if (err instanceof EdgeBaseError) {
      return c.json(err.toJSON(), err.code as 400);
    }
    return c.json({ code: 500, message: 'Internal server error.' }, 500);
  });
  app.use('*', errorHandlerMiddleware);
  app.use('/api/*', authMiddleware);
  app.use('/api/db/*', rulesMiddleware);
  app.route('/api/db', tablesRoute);
  return app;
}

function createEnv(
  onFetch: (input: RequestInfo, init?: RequestInit) => void | Response | Promise<void | Response>,
  overrides: Partial<Env> = {},
): Env {
  return {
    DATABASE: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async (input: RequestInfo, init?: RequestInit) => {
          const result = await onFetch(input, init);
          if (result instanceof Response) {
            return result;
          }
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      }),
    } as unknown as DurableObjectNamespace,
    ...overrides,
  } as Env;
}

function createAuthedApp(auth: Record<string, unknown>) {
  const app = new OpenAPIHono<HonoEnv>();
  app.onError((err, c) => {
    if (err instanceof EdgeBaseError) {
      return c.json(err.toJSON(), err.code as 400);
    }
    return c.json({ code: 500, message: 'Internal server error.' }, 500);
  });
  app.use('*', errorHandlerMiddleware);
  app.use('/api/*', async (c, next) => {
    c.set('auth' as never, auth as never);
    return next();
  });
  app.use('/api/db/*', rulesMiddleware);
  app.route('/api/db', tablesRoute);
  return app;
}

describe('DB proxy service key forwarding', () => {
  afterEach(() => {
    setConfig({});
  });

  it('forwards X-Is-Service-Key for scoped Bearer keys that pass db scope validation', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        shared: {
          provider: 'do',
          tables: {
            users: {},
          },
        },
      },
      serviceKeys: {
        keys: [
          {
            kid: 'db1',
            tier: 'scoped',
            scopes: ['db:table:users:read'],
            secretSource: 'inline',
            inlineSecret: 'jb_db1_scoped',
          },
        ],
      },
    }));

    let forwardedHeaders: Headers | null = null;
    const app = createApp();
    const response = await app.request('/api/db/shared/tables/users', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer jb_db1_scoped',
      },
    }, createEnv((_input, init) => {
      forwardedHeaders = new Headers(init?.headers);
    }));

    expect(response.status).toBe(200);
    expect(forwardedHeaders).not.toBeNull();
    expect(forwardedHeaders!.get('X-Is-Service-Key')).toBe('true');
  });

  it('forwards X-Is-Service-Key for tenant-constrained Bearer keys when the db id matches', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          tables: {
            users: {},
          },
        },
      },
      serviceKeys: {
        keys: [
          {
            kid: 'tenant-db',
            tier: 'scoped',
            scopes: ['db:table:users:read'],
            secretSource: 'inline',
            inlineSecret: 'jb_tenant-db_scoped',
            constraints: {
              tenant: 'ws-123',
              env: ['prod'],
            },
          },
        ],
      },
    }));

    let forwardedHeaders: Headers | null = null;
    const app = createApp();
    const response = await app.request('/api/db/workspace/ws-123/tables/users', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer jb_tenant-db_scoped',
      },
    }, createEnv((_input, init) => {
      forwardedHeaders = new Headers(init?.headers);
    }, {
      ENVIRONMENT: 'prod',
    }));

    expect(response.status).toBe(200);
    expect(forwardedHeaders).not.toBeNull();
    expect(forwardedHeaders!.get('X-Is-Service-Key')).toBe('true');
    expect(forwardedHeaders!.get('X-DO-Name')).toBe('workspace:ws-123');
  });

  it('does not bypass db rules when scoped Bearer key lacks the required db scope', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        shared: {
          provider: 'do',
          tables: {
            users: {},
          },
        },
      },
      serviceKeys: {
        keys: [
          {
            kid: 'db2',
            tier: 'scoped',
            scopes: ['storage:bucket:avatars:read'],
            secretSource: 'inline',
            inlineSecret: 'jb_db2_scoped',
          },
        ],
      },
    }));

    let forwarded = false;
    const app = createApp();
    const response = await app.request('/api/db/shared/tables/users', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer jb_db2_scoped',
      },
    }, createEnv(() => {
      forwarded = true;
    }));

    expect(response.status).toBe(401);
    expect(forwarded).toBe(false);
  });

  it('does not bypass db rules when a tenant-constrained Bearer key targets another db id', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          tables: {
            users: {},
          },
        },
      },
      serviceKeys: {
        keys: [
          {
            kid: 'tenant-db-mismatch',
            tier: 'scoped',
            scopes: ['db:table:users:read'],
            secretSource: 'inline',
            inlineSecret: 'jb_tenant-db-mismatch_payload',
            constraints: {
              tenant: 'ws-123',
              env: ['prod'],
            },
          },
        ],
      },
    }));

    let forwarded = false;
    const app = createApp();
    const response = await app.request('/api/db/workspace/ws-999/tables/users', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer jb_tenant-db-mismatch_payload',
      },
    }, createEnv(() => {
      forwarded = true;
    }, {
      ENVIRONMENT: 'prod',
    }));

    expect(response.status).toBe(401);
    expect(forwarded).toBe(false);
  });

  it('allows service-key dynamic DB bootstrap even when canCreate returns false', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          instance: true,
          access: {
            canCreate: () => false,
          },
          tables: {
            users: {},
          },
        },
      },
      serviceKeys: {
        keys: [
          {
            kid: 'dynamic-bootstrap',
            tier: 'scoped',
            scopes: ['db:table:users:write'],
            secretSource: 'inline',
            inlineSecret: 'jb_dynamic-bootstrap_scoped',
          },
        ],
      },
    }));

    const forwardedHeaders: Headers[] = [];
    let callCount = 0;
    const app = createApp();
    const response = await app.request('/api/db/workspace/ws-123/tables/users', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer jb_dynamic-bootstrap_scoped',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'u1' }),
    }, createEnv((_input, init) => {
      forwardedHeaders.push(new Headers(init?.headers));
      callCount += 1;
    }, {
      DATABASE: {
        idFromName: (name: string) => name as unknown as DurableObjectId,
        get: () => ({
          fetch: async (_input: RequestInfo, init?: RequestInit) => {
            forwardedHeaders.push(new Headers(init?.headers));
            callCount += 1;
            if (callCount === 1) {
              return new Response(JSON.stringify({ needsCreate: true, namespace: 'workspace', id: 'ws-123' }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        }),
      } as unknown as DurableObjectNamespace,
    }));

    expect(response.status).toBe(200);
    expect(forwardedHeaders).toHaveLength(2);
    expect(forwardedHeaders[0].get('X-Is-Service-Key')).toBe('true');
    expect(forwardedHeaders[1].get('X-Is-Service-Key')).toBe('true');
    expect(forwardedHeaders[1].get('X-DO-Create-Authorized')).toBe('1');
  });

  it('preserves the final 201 response body after dynamic DB bootstrap retry', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          instance: true,
          access: {
            canCreate: () => false,
          },
          tables: {
            users: {},
          },
        },
      },
      serviceKeys: {
        keys: [
          {
            kid: 'dynamic-create-body',
            tier: 'scoped',
            scopes: ['db:table:users:write'],
            secretSource: 'inline',
            inlineSecret: 'jb_dynamic-create-body_scoped',
          },
        ],
      },
    }));

    let callCount = 0;
    const app = createApp();
    const response = await app.request('/api/db/workspace/ws-123/tables/users', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer jb_dynamic-create-body_scoped',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'u1', name: 'June' }),
    }, {
      ...createEnv(() => {}),
      DATABASE: {
        idFromName: (name: string) => name as unknown as DurableObjectId,
        get: () => ({
          fetch: async () => {
            callCount += 1;
            if (callCount === 1) {
              return new Response(JSON.stringify({ needsCreate: true, namespace: 'workspace', id: 'ws-123' }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            return new Response(JSON.stringify({ id: 'u1', name: 'June' }), {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        }),
      } as unknown as DurableObjectNamespace,
    } as Env);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: 'u1', name: 'June' });
  });

  it('does not trust raw X-EdgeBase-Internal on public DB requests', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          instance: true,
          access: {
            access: () => false,
          },
          tables: {
            users: {
              access: {
                read: () => true,
              },
            },
          },
        },
      },
    }));

    let forwarded = false;
    const app = createApp();
    const response = await app.request('/api/db/workspace/ws-123/tables/users', {
      method: 'GET',
      headers: {
        'X-EdgeBase-Internal': 'true',
      },
    }, createEnv(() => {
      forwarded = true;
    }));

    expect(response.status).toBe(403);
    expect(forwarded).toBe(false);
  });

  it('strips client-supplied bypass headers before forwarding to the database DO', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          instance: true,
          tables: {
            users: {
              access: {
                read: () => true,
              },
            },
          },
        },
      },
    }));

    let forwardedHeaders: Headers | null = null;
    const app = createApp();
    const response = await app.request('/api/db/workspace/ws-123/tables/users', {
      method: 'GET',
      headers: {
        'X-EdgeBase-Internal': 'true',
        'X-Is-Service-Key': 'true',
      },
    }, createEnv((_input, init) => {
      forwardedHeaders = new Headers(init?.headers);
    }));

    expect(response.status).toBe(200);
    expect(forwardedHeaders).not.toBeNull();
    expect(forwardedHeaders!.get('X-EdgeBase-Internal')).toBeNull();
    expect(forwardedHeaders!.get('X-Is-Service-Key')).toBeNull();
  });

  it('supports dbRules.access() lookups through ctx.db.get()', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        shared: {
          provider: 'do',
          tables: {
            servers: {
              access: {
                read: () => true,
              },
            },
          },
        },
        server: {
          provider: 'do',
          instance: true,
          access: {
            async access(auth, id, ctx) {
              if (!auth) return false;
              const server = await ctx.db.get('servers', id);
              return Array.isArray(server?.memberIds) && server.memberIds.includes(auth.id);
            },
          },
          tables: {
            serverMessages: {
              access: {
                read: () => true,
              },
            },
          },
        },
      },
    }));

    let sharedLookups = 0;
    let serverReads = 0;
    const app = createAuthedApp({ id: 'user-1' });
    const response = await app.request('/api/db/server/ws-123/tables/serverMessages', {
      method: 'GET',
    }, createEnv((_input, init) => {
      const headers = new Headers(init?.headers);
      const doName = headers.get('X-DO-Name');
      if (doName === 'shared') {
        sharedLookups += 1;
        return new Response(JSON.stringify({ id: 'ws-123', memberIds: ['user-1'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (doName === 'server:ws-123') {
        serverReads += 1;
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ code: 404, message: 'missing' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    expect(response.status).toBe(200);
    expect(sharedLookups).toBe(1);
    expect(serverReads).toBe(1);
  });

  it('supports dbRules.access() lookups through ctx.db.exists() in the current dynamic namespace', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          access: {
            async access(auth, id, ctx) {
              if (!auth) return false;
              return ctx.db.exists('workspace_members', {
                userId: auth.id,
                workspaceId: id,
                membershipStatus: 'active',
              });
            },
          },
          tables: {
            workspace_members: {
              access: {
                read: () => true,
              },
            },
            issues: {
              access: {
                read: () => true,
              },
            },
          },
        },
      },
    }));

    let membershipLookups = 0;
    let issueReads = 0;
    const app = createAuthedApp({ id: 'user-1' });
    const response = await app.request('/api/db/workspace/ws-123/tables/issues', {
      method: 'GET',
    }, createEnv((_input, init) => {
      const headers = new Headers(init?.headers);
      const doName = headers.get('X-DO-Name');
      const url = typeof _input === 'string' ? _input : _input instanceof Request ? _input.url : String(_input);
      if (doName === 'workspace:ws-123' && url.includes('/tables/workspace_members?')) {
        membershipLookups += 1;
        expect(headers.get('X-Is-Service-Key')).toBe('true');
        expect(headers.get('X-EdgeBase-Internal')).toBe('true');
        return new Response(JSON.stringify({
          items: [{ id: 'member-1', userId: 'user-1', workspaceId: 'ws-123', membershipStatus: 'active' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (doName === 'workspace:ws-123' && url.endsWith('/tables/issues')) {
        issueReads += 1;
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ code: 404, message: 'missing' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    expect(response.status).toBe(200);
    expect(membershipLookups).toBe(1);
    expect(issueReads).toBe(1);
  });

  it('does not fail closed when dynamic db access lookup takes longer than 50ms', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          access: {
            async access(auth, id, ctx) {
              if (!auth) return false;
              return ctx.db.exists('workspace_members', {
                userId: auth.id,
                workspaceId: id,
                membershipStatus: 'active',
              });
            },
          },
          tables: {
            workspace_members: {
              access: {
                read: () => true,
              },
            },
            issues: {
              access: {
                read: () => true,
              },
            },
          },
        },
      },
    }));

    const app = createAuthedApp({ id: 'user-1' });
    const response = await app.request('/api/db/workspace/ws-slow/tables/issues', {
      method: 'GET',
    }, createEnv(async (_input, init) => {
      const headers = new Headers(init?.headers);
      const doName = headers.get('X-DO-Name');
      const url = typeof _input === 'string' ? _input : _input instanceof Request ? _input.url : String(_input);
      if (doName === 'workspace:ws-slow' && url.includes('/tables/workspace_members?')) {
        await new Promise((resolve) => setTimeout(resolve, 75));
        return new Response(JSON.stringify({
          items: [{ id: 'member-1', userId: 'user-1', workspaceId: 'ws-slow', membershipStatus: 'active' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (doName === 'workspace:ws-slow' && url.endsWith('/tables/issues')) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ code: 404, message: 'missing' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    expect(response.status).toBe(200);
  });
});
