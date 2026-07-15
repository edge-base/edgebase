import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
}));

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil(promise: Promise<unknown>) {
      void promise.catch(() => {});
    },
    passThroughOnException() {},
  } as ExecutionContext;
}

function createEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const logsBinding = {
    idFromName: vi.fn((name: string) => ({ toString: () => name })),
    get: vi.fn(() => ({
      fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    })),
  };

  return {
    DATABASE: {} as never,
    AUTH: {} as never,
    DATABASE_LIVE: {} as never,
    ROOMS: {} as never,
    LOGS: logsBinding as never,
    STORAGE: {} as never,
    KV: {} as never,
    AUTH_DB: {} as never,
    CONTROL_DB: {} as never,
    EDGEBASE_CONFIG: {},
    ...overrides,
  };
}

async function loadWorker() {
  vi.doMock('../lib/runtime-startup.js', () => ({
    ensureServerStartup: vi.fn().mockResolvedValue(undefined),
  }));

  const mod = await import('../index.js');
  return mod.default;
}

describe('frontend routing', () => {
  it('serves the frontend root when a root-mounted bundle is configured', async () => {
    const assetsFetch = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      return new Response(`asset:${pathname}`, { status: 200 });
    });
    const worker = await loadWorker();

    const response = await worker.fetch(
      new Request('http://localhost:8787/'),
      createEnv({
        EDGEBASE_CONFIG: {
          frontend: {
            directory: './web/dist',
            spaFallback: true,
            headers: {
              'Content-Security-Policy': "default-src 'self'",
              'X-Frame-Options': 'DENY',
            },
          },
        },
        ASSETS: { fetch: assetsFetch },
      }) as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('asset:/index.html');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(assetsFetch).toHaveBeenCalledTimes(1);
  });

  it('follows same-origin asset redirects for canonical frontend index routes', async () => {
    const assetPaths: string[] = [];
    const assetsFetch = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      assetPaths.push(pathname);

      if (pathname === '/index.html') {
        return new Response(null, {
          status: 307,
          headers: { location: '/' },
        });
      }

      return new Response('asset:/', { status: 200 });
    });
    const worker = await loadWorker();

    const response = await worker.fetch(
      new Request('http://localhost:8787/'),
      createEnv({
        EDGEBASE_CONFIG: {
          frontend: {
            directory: './web/dist',
            spaFallback: true,
          },
        },
        ASSETS: { fetch: assetsFetch },
      }) as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('asset:/');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(assetPaths).toEqual(['/index.html', '/']);
  });

  it('applies SPA fallback only to HTML navigation routes', { timeout: 15_000 }, async () => {
    const assetPaths: string[] = [];
    const assetsFetch = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      assetPaths.push(pathname);
      return pathname === '/index.html'
        ? new Response('frontend-index', { status: 200 })
        : new Response('missing', { status: 404 });
    });
    const worker = await loadWorker();

    const htmlNavigation = await worker.fetch(
      new Request('http://localhost:8787/dashboard/settings', {
        headers: { accept: 'text/html,application/xhtml+xml' },
      }),
      createEnv({
        EDGEBASE_CONFIG: {
          frontend: {
            directory: './web/dist',
            spaFallback: true,
          },
        },
        ASSETS: { fetch: assetsFetch },
      }) as never,
      createExecutionContext(),
    );
    const missingAsset = await worker.fetch(
      new Request('http://localhost:8787/assets/missing.js', {
        headers: { accept: 'text/html,application/xhtml+xml' },
      }),
      createEnv({
        EDGEBASE_CONFIG: {
          frontend: {
            directory: './web/dist',
            spaFallback: true,
          },
        },
        ASSETS: { fetch: assetsFetch },
      }) as never,
      createExecutionContext(),
    );

    expect(await htmlNavigation.text()).toBe('frontend-index');
    expect(htmlNavigation.status).toBe(200);
    expect(missingAsset.status).toBe(404);
    expect(assetPaths).toEqual(['/index.html', '/assets/missing.js']);
  });

  it('respects custom mount paths and leaves API routes to the worker', async () => {
    const assetsFetch = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      return new Response(`asset:${pathname}`, { status: 200 });
    });
    const worker = await loadWorker();
    const env = createEnv({
      EDGEBASE_CONFIG: {
        frontend: {
          directory: './web/dist',
          mountPath: '/app',
          spaFallback: true,
        },
      },
      ASSETS: { fetch: assetsFetch },
    }) as never;

    const mounted = await worker.fetch(
      new Request('http://localhost:8787/app/dashboard', {
        headers: { accept: 'text/html' },
      }),
      env,
      createExecutionContext(),
    );
    const api = await worker.fetch(
      new Request('http://localhost:8787/api/health'),
      env,
      createExecutionContext(),
    );

    expect(await mounted.text()).toBe('asset:/app/index.html');
    expect(api.status).toBe(200);
    expect(assetsFetch).toHaveBeenCalledTimes(1);
  });

  it('serves frontend and admin assets without charging the API global binding', async () => {
    const assetsFetch = vi.fn(async (request: Request) => (
      new Response(`asset:${new URL(request.url).pathname}`, { status: 200 })
    ));
    const globalBindingLimit = vi.fn().mockResolvedValue({ success: false });
    const worker = await loadWorker();
    const env = createEnv({
      EDGEBASE_CONFIG: {
        release: true,
        frontend: {
          directory: './web/dist',
          spaFallback: true,
        },
        rateLimiting: {
          global: { requests: 100, window: '60s' },
        },
      },
      ASSETS: { fetch: assetsFetch },
      GLOBAL_RATE_LIMITER: { limit: globalBindingLimit },
    }) as never;

    for (const path of [
      '/',
      '/assets/app-abc123def456.js',
      '/manifest.webmanifest',
      '/mark-128.png',
      '/admin',
    ]) {
      const response = await worker.fetch(
        new Request(`http://localhost:8787${path}`, {
          headers: { accept: 'text/html', 'cf-connecting-ip': '198.51.100.20' },
        }),
        env,
        createExecutionContext(),
      );
      expect(response.status).toBe(200);
    }
    expect(globalBindingLimit).not.toHaveBeenCalled();

    const api = await worker.fetch(
      new Request('http://localhost:8787/api/health', {
        headers: { 'cf-connecting-ip': '198.51.100.20' },
      }),
      env,
      createExecutionContext(),
    );
    expect(api.status).toBe(429);
    expect(globalBindingLimit).toHaveBeenCalledTimes(1);
  });
});
