import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig, EdgeBaseError } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import {
  SELF_HOST_GATEWAY_AUTHORITY_HEADER,
  resolvePublicRequestOrigin,
  trustsSelfHostedProxyHeaders,
} from '../lib/public-origin.js';
import { storageRoute } from '../routes/storage.js';
import type { Env } from '../types.js';

afterEach(() => setConfig({}));

describe('public request origin trust boundary', () => {
  it('trusts proxy headers only for an explicitly trusted self-hosted runtime', () => {
    const cases: Array<[Record<string, unknown>, boolean]> = [
      [{
        EDGEBASE_RUNTIME_MODE: 'self-hosted',
        EDGEBASE_CONFIG: JSON.stringify({ trustSelfHostedProxy: true }),
      }, true],
      [{ EDGEBASE_RUNTIME_MODE: 'self-hosted', trustSelfHostedProxy: true }, true],
      [{ EDGEBASE_RUNTIME_MODE: 'self-hosted', trustSelfHostedProxy: false }, false],
      [{ EDGEBASE_RUNTIME_MODE: 'cloudflare', trustSelfHostedProxy: true }, false],
      [{ EDGEBASE_RUNTIME_MODE: 'local', trustSelfHostedProxy: true }, false],
      [{ trustSelfHostedProxy: true }, false],
    ];

    for (const [env, expected] of cases) {
      expect(trustsSelfHostedProxyHeaders(env)).toBe(expected);
    }
  });

  it('uses proxy-overwritten HTTPS scheme and host only in trusted self-hosted mode', () => {
    const env = {
      EDGEBASE_RUNTIME_MODE: 'self-hosted',
      EDGEBASE_CONFIG: JSON.stringify({ trustSelfHostedProxy: true }),
    };
    const request = new Request('http://127.0.0.1:8787/api/storage/files/signed-url', {
      headers: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'files.example.com:443',
      },
    });

    expect(resolvePublicRequestOrigin(env, request)).toBe('https://files.example.com');
  });

  it('requires the CLI gateway proof whenever a gateway secret is configured', () => {
    const secret = 'a'.repeat(64);
    const env = {
      EDGEBASE_RUNTIME_MODE: 'self-hosted',
      EDGEBASE_SELF_HOST_GATEWAY_SECRET: secret,
      trustSelfHostedProxy: true,
    };
    const headers = {
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'files.example.com',
    };

    for (const supplied of [undefined, 'b'.repeat(64), 'invalid']) {
      const request = new Request('http://127.0.0.1:8787/upload', {
        headers: {
          ...headers,
          ...(supplied ? { 'X-EdgeBase-Self-Host-Gateway': supplied } : {}),
        },
      });
      expect(trustsSelfHostedProxyHeaders(env, request)).toBe(false);
      expect(resolvePublicRequestOrigin(env, request)).toBe('http://127.0.0.1:8787');
    }

    const proven = new Request('http://127.0.0.1:8787/upload', {
      headers: {
        ...headers,
        [SELF_HOST_GATEWAY_AUTHORITY_HEADER]: secret,
      },
    });
    expect(trustsSelfHostedProxyHeaders(env, proven)).toBe(true);
    expect(resolvePublicRequestOrigin(env, proven)).toBe('https://files.example.com');
  });

  it('returns an HTTPS signed upload URL from an HTTP trusted-proxy upstream request', async () => {
    setConfig(defineConfig({
      release: true,
      trustSelfHostedProxy: true,
      storage: {
        buckets: {
          files: { access: { write: () => true } },
        },
      },
    }));
    const app = new OpenAPIHono<HonoEnv>();
    app.onError((error, c) => error instanceof EdgeBaseError
      ? c.json(error.toJSON(), error.code as 403)
      : c.json({ code: 500, message: 'Internal server error.' }, 500));
    app.route('/api/storage', storageRoute);
    const response = await app.fetch(new Request(
      'http://127.0.0.1:8787/api/storage/files/signed-upload-url',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': 'files.example.com',
        },
        body: JSON.stringify({ key: 'folder/report ?#1.pdf' }),
      },
    ), {
      EDGEBASE_RUNTIME_MODE: 'self-hosted',
      JWT_USER_SECRET: 'signed-url-secret',
    } as unknown as Env);

    expect(response.status).toBe(200);
    const payload = await response.json() as { url: string };
    const signed = new URL(payload.url);
    expect(signed.origin).toBe('https://files.example.com');
    expect(signed.pathname).toBe('/api/storage/files/upload');
    expect(signed.searchParams.get('key')).toBe('folder/report ?#1.pdf');
    expect(signed.searchParams.get('token')).toMatch(/^v3\./);
  });

  it('ignores forged forwarded scheme and host in Cloudflare mode even when the option is set', () => {
    const env = {
      EDGEBASE_RUNTIME_MODE: 'cloudflare',
      EDGEBASE_CONFIG: JSON.stringify({ trustSelfHostedProxy: true }),
    };
    const request = new Request('https://edge.example.com/api/storage/files/signed-url', {
      headers: {
        'X-Forwarded-Proto': 'http',
        'X-Forwarded-Host': 'attacker.example',
      },
    });

    expect(resolvePublicRequestOrigin(env, request)).toBe('https://edge.example.com');
  });

  it('ignores forwarded headers in direct self-hosted mode', () => {
    const request = new Request('http://localhost:8787/api/storage/files/signed-url', {
      headers: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'attacker.example',
      },
    });

    expect(resolvePublicRequestOrigin({ EDGEBASE_RUNTIME_MODE: 'self-hosted' }, request))
      .toBe('http://localhost:8787');
  });

  it('rejects protocol-relative and credential-bearing forwarded hosts', () => {
    const env = {
      EDGEBASE_RUNTIME_MODE: 'self-hosted',
      EDGEBASE_CONFIG: JSON.stringify({ trustSelfHostedProxy: true }),
    };
    for (const host of ['//attacker.example', 'user@attacker.example', 'attacker.example/path']) {
      const request = new Request('http://upstream.internal:8787/api/storage/files/signed-url', {
        headers: {
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': host,
        },
      });
      expect(resolvePublicRequestOrigin(env, request)).toBe('https://upstream.internal:8787');
    }
  });
});
