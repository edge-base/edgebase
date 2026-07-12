import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { setConfig } from '../lib/do-router.js';
import { captchaMiddleware, _test } from '../middleware/captcha-verify.js';
import type { Env } from '../types.js';
import type { EdgeBaseConfig } from '@edge-base/shared';

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.post('/verify', captchaMiddleware('signin'), (c) => c.json({ ok: true }));
  return app;
}

afterEach(() => {
  setConfig({});
  vi.unstubAllGlobals();
});

describe('captcha remoteip runtime trust boundary', () => {
  it.each([
    {
      label: 'Cloudflare uses CF-Connecting-IP and ignores spoofed XFF',
      mode: 'cloudflare',
      trust: true,
      expected: '198.51.100.20',
    },
    {
      label: 'trusted self-hosted proxy uses overwritten XFF',
      mode: 'self-hosted',
      trust: true,
      expected: '10.0.0.8',
    },
    {
      label: 'direct self-hosted ingress omits client-controlled remoteip',
      mode: 'self-hosted',
      trust: false,
      expected: undefined,
    },
    {
      label: 'absent runtime identity omits client-controlled remoteip',
      mode: undefined,
      trust: true,
      expected: undefined,
    },
  ])('$label', async ({ mode, trust, expected }) => {
    setConfig({
      trustSelfHostedProxy: trust,
      captcha: {
        siteKey: 'synthetic-site-key',
        secretKey: 'synthetic-secret-key',
        hostnames: ['api.example.test'],
        failMode: 'closed',
      },
    } as never);
    const siteverify = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: 'signin',
      hostname: 'api.example.test',
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', siteverify);

    const response = await createApp().request('https://api.example.test/verify', {
      method: 'POST',
      headers: {
        'X-EdgeBase-Captcha-Token': 'synthetic-captcha-token',
        'CF-Connecting-IP': '198.51.100.20',
        'X-Forwarded-For': '10.0.0.8, 192.0.2.1',
      },
    }, {
      ...(mode ? { EDGEBASE_RUNTIME_MODE: mode } : {}),
    } as unknown as Env);

    expect(response.status).toBe(200);
    const request = siteverify.mock.calls[0]![1] as RequestInit;
    expect(request.redirect).toBe('error');
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    if (expected === undefined) expect(body).not.toHaveProperty('remoteip');
    else expect(body.remoteip).toBe(expected);
  });

  it('fails closed in release mode when captcha:true is not fully provisioned', () => {
    setConfig({ release: true, captcha: true });

    expect(() => _test.resolveCaptchaConfig({} as Env)).toThrow(
      /site key, secret key, or exact hostname allowlist is missing/i,
    );
  });

  it('permits a missing local widget only on the CLI-owned non-release loopback listener', () => {
    setConfig({ release: false, captcha: true });

    expect(_test.resolveCaptchaConfig({
      EDGEBASE_RUNTIME_MODE: 'local-development',
    } as Env, new Request('http://localhost/verify', {
      headers: { 'CF-Connecting-IP': '127.0.0.1' },
    }))).toBeNull();

    expect(() => _test.resolveCaptchaConfig({
      EDGEBASE_RUNTIME_MODE: 'self-hosted',
    } as Env, new Request('http://localhost/verify'))).toThrow(/CAPTCHA is enabled/i);
  });

  it('rejects a merged config and environment hostname allowlist above the provider limit', () => {
    setConfig({
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        hostnames: Array.from({ length: 10 }, (_, index) => `host-${index}.example.test`),
      },
    });

    expect(() => _test.resolveCaptchaConfig({
      TURNSTILE_SECRET: 'synthetic-secret-key',
      CAPTCHA_HOSTNAMES: 'extra.example.test',
      EDGEBASE_RUNTIME_MODE: 'cloudflare',
    } as Env)).toThrow(/at most 10 exact hostnames/i);
  });

  it('rejects fail-open outside trusted local development even when release is false', () => {
    setConfig({
      release: false,
      captcha: {
        siteKey: 'synthetic-site-key',
        hostnames: ['api.example.test'],
        failMode: 'open',
      },
    });

    expect(() => _test.resolveCaptchaConfig({
      TURNSTILE_SECRET: 'synthetic-secret-key',
      EDGEBASE_RUNTIME_MODE: 'cloudflare',
    } as Env)).toThrow(/only in the trusted local-development runtime/i);
  });

  it('defaults a non-release cloud worker to fail-closed on Siteverify outages', async () => {
    setConfig({
      release: false,
      captcha: {
        siteKey: 'synthetic-site-key',
        hostnames: ['api.example.test'],
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const response = await createApp().request('https://api.example.test/verify', {
      method: 'POST',
      headers: { 'X-EdgeBase-Captcha-Token': 'synthetic-captcha-token' },
    }, {
      TURNSTILE_SECRET: 'synthetic-secret-key',
      EDGEBASE_RUNTIME_MODE: 'cloudflare',
    } as Env);

    expect(response.status).toBe(503);
  });

  it('classifies Cloudflare internal-error as service unavailability, not a user CAPTCHA failure', async () => {
    setConfig({
      release: true,
      captcha: { siteKey: 'synthetic-site-key', hostnames: ['api.example.test'] },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      'error-codes': ['internal-error'],
    }))));

    const response = await createApp().request('https://api.example.test/verify', {
      method: 'POST',
      headers: { 'X-EdgeBase-Captcha-Token': 'synthetic-captcha-token' },
    }, { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env);

    expect(response.status).toBe(503);
  });

  it('rejects an oversized token before calling Siteverify', async () => {
    setConfig({
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        secretKey: 'synthetic-secret-key',
        hostnames: ['api.example.test'],
      },
    });
    const siteverify = vi.fn();
    vi.stubGlobal('fetch', siteverify);

    const response = await createApp().request('https://api.example.test/verify', {
      method: 'POST',
      headers: { 'X-EdgeBase-Captcha-Token': 'x'.repeat(2049) },
    }, { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env);

    expect(response.status).toBe(403);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'truthy non-boolean success',
      payload: { success: 1, action: 'signin', hostname: 'api.example.test' },
    },
    {
      label: 'missing action',
      payload: { success: true, hostname: 'api.example.test' },
    },
    {
      label: 'wrong hostname',
      payload: { success: true, action: 'signin', hostname: 'attacker.example' },
    },
  ])('rejects $label from Siteverify', async ({ payload }) => {
    setConfig({
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        secretKey: 'synthetic-secret-key',
        hostnames: ['api.example.test'],
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
    })));

    const response = await createApp().request('https://api.example.test/verify', {
      method: 'POST',
      headers: { 'X-EdgeBase-Captcha-Token': 'synthetic-captcha-token' },
    }, { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env);

    expect(response.status).toBe(403);
  });

  it('defaults to fail-closed on a release Siteverify outage', async () => {
    setConfig({
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        secretKey: 'synthetic-secret-key',
        hostnames: ['api.example.test'],
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const response = await createApp().request('https://api.example.test/verify', {
      method: 'POST',
      headers: { 'X-EdgeBase-Captcha-Token': 'synthetic-captcha-token' },
    }, { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env);

    expect(response.status).toBe(503);
  });

  it('never fail-opens a rejected Siteverify request such as an invalid secret', async () => {
    setConfig({
      release: false,
      captcha: {
        siteKey: 'synthetic-site-key',
        secretKey: 'synthetic-secret-key',
        hostnames: ['api.example.test'],
        failMode: 'open',
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: false }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )));

    const response = await createApp().request('http://localhost/verify', {
      method: 'POST',
      headers: { 'X-EdgeBase-Captcha-Token': 'synthetic-captcha-token' },
    }, {
      EDGEBASE_RUNTIME_MODE: 'local-development',
      TURNSTILE_SECRET: 'synthetic-secret-key',
    } as Env);

    expect(response.status).toBe(503);
  });

  it('accepts captcha_token in the URL only for the OAuth navigation action', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.get('/signin', captchaMiddleware('signin'), (c) => c.json({ ok: true }));
    app.get('/oauth', captchaMiddleware('oauth'), (c) => c.json({ ok: true }));
    setConfig({
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        secretKey: 'synthetic-secret-key',
        hostnames: ['api.example.test'],
      },
    });
    const siteverify = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: 'oauth',
      hostname: 'api.example.test',
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', siteverify);
    const env = { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env;

    const rejected = await app.request(
      'https://api.example.test/signin?captcha_token=must-not-enter-logs',
      undefined,
      env,
    );
    const accepted = await app.request(
      'https://api.example.test/oauth?captcha_token=oauth-navigation-token',
      undefined,
      env,
    );

    expect(rejected.status).toBe(403);
    expect(accepted.status).toBe(200);
    expect(siteverify).toHaveBeenCalledOnce();
  });

  it('treats an oversized or malformed Siteverify response as a fail-closed outage', async () => {
    setConfig({
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        hostnames: ['api.example.test'],
      },
    });
    const env = { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env;
    for (const responseBody of ['x'.repeat(64 * 1024 + 1), '{malformed']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(responseBody)));
      const response = await createApp().request('https://api.example.test/verify', {
        method: 'POST',
        headers: { 'X-EdgeBase-Captcha-Token': 'synthetic-captcha-token' },
      }, env);
      expect(response.status).toBe(503);
    }
  });

  it('allows only a valid, correctly scoped Service Key to bypass CAPTCHA', async () => {
    const baseConfig = {
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        hostnames: ['api.example.test'],
      },
    } satisfies EdgeBaseConfig;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env;

    setConfig({
      ...baseConfig,
      serviceKeys: {
        keys: [{
          kid: 'captcha',
          tier: 'scoped',
          scopes: ['auth:*:*:bypass'],
          secretSource: 'inline',
          inlineSecret: 'jb_captcha_synthetic-secret',
        }],
      },
    });
    const allowed = await createApp().request('https://api.example.test/verify', {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': 'jb_captcha_synthetic-secret' },
    }, env);
    expect(allowed.status).toBe(200);

    setConfig({
      ...baseConfig,
      serviceKeys: {
        keys: [{
          kid: 'captcha',
          tier: 'scoped',
          scopes: ['db:shared:read'],
          secretSource: 'inline',
          inlineSecret: 'jb_captcha_synthetic-secret',
        }],
      },
    });
    const denied = await createApp().request('https://api.example.test/verify', {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': 'jb_captcha_synthetic-secret' },
    }, env);
    expect(denied.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fall back to a body token when a dedicated header is malformed', async () => {
    setConfig({
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        hostnames: ['api.example.test'],
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await createApp().request('https://api.example.test/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Captcha-Token': '   ',
      },
      body: JSON.stringify({ captchaToken: 'valid-looking-body-token' }),
    }, { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env);

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads captchaToken from a bounded clone without consuming the handler body', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post('/verify', captchaMiddleware('signin'), async (c) => c.json({
      received: await c.req.json(),
    }));
    setConfig({
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        secretKey: 'synthetic-secret-key',
        hostnames: ['api.example.test'],
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: 'signin',
      hostname: 'api.example.test',
    }), { headers: { 'Content-Type': 'application/json' } })));
    const body = { captchaToken: 'synthetic-captcha-token', value: 'preserved' };

    const response = await app.request('https://api.example.test/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: body });
  });
});
