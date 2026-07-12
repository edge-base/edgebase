import { describe, expect, it } from 'vitest';
import { resolveOAuthBaseUrl } from '../routes/oauth.js';
import type { Env } from '../types.js';

function env(mode: 'self-hosted' | 'cloudflare' | 'local-development', config: Record<string, unknown>): Env {
  return {
    EDGEBASE_RUNTIME_MODE: mode,
    EDGEBASE_CONFIG: JSON.stringify(config),
  } as unknown as Env;
}

describe('OAuth public redirect origin', () => {
  it('keeps an explicit baseUrl authoritative over request and proxy headers', () => {
    const request = new Request('http://upstream.internal:8787/api/auth/oauth/google', {
      headers: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'proxy.example.com',
      },
    });

    expect(resolveOAuthBaseUrl(env('self-hosted', {
      baseUrl: 'https://configured.example.com/',
      trustSelfHostedProxy: true,
    }), request)).toBe('https://configured.example.com');
  });

  it('uses the browser-facing HTTPS origin behind a trusted self-hosted proxy', () => {
    const request = new Request('http://127.0.0.1:8787/api/auth/oauth/google', {
      headers: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'auth.example.com',
      },
    });

    expect(resolveOAuthBaseUrl(env('self-hosted', { trustSelfHostedProxy: true }), request))
      .toBe('https://auth.example.com');
  });

  it('ignores spoofed forwarding headers in Cloudflare mode', () => {
    const request = new Request('https://edge.example.com/api/auth/oauth/google', {
      headers: {
        'X-Forwarded-Proto': 'http',
        'X-Forwarded-Host': 'attacker.example',
      },
    });

    expect(resolveOAuthBaseUrl(env('cloudflare', { trustSelfHostedProxy: true }), request))
      .toBe('https://edge.example.com');
  });

  it('ignores forwarding headers for an untrusted direct self-hosted request', () => {
    const request = new Request('http://localhost:8787/api/auth/oauth/google', {
      headers: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'attacker.example',
      },
    });

    expect(resolveOAuthBaseUrl(env('self-hosted', {}), request)).toBe('http://localhost:8787');
  });

  it('permits release HTTP OAuth origins only on the CLI-owned local loopback boundary', () => {
    const config = { release: true, baseUrl: 'http://127.0.0.1:8787' };
    const localRequest = new Request('http://127.0.0.1:8787/api/auth/oauth/google', {
      headers: { 'CF-Connecting-IP': '127.0.0.1' },
    });
    expect(resolveOAuthBaseUrl(env('local-development', config), localRequest))
      .toBe('http://127.0.0.1:8787');

    const publicRequest = new Request('http://api.example.com/api/auth/oauth/google', {
      headers: { 'CF-Connecting-IP': '127.0.0.1' },
    });
    expect(() => resolveOAuthBaseUrl(env('local-development', config), publicRequest))
      .toThrow('must use HTTPS in release mode');

    const nonLoopbackPeer = new Request('http://127.0.0.1:8787/api/auth/oauth/google', {
      headers: { 'CF-Connecting-IP': '198.51.100.11' },
    });
    expect(() => resolveOAuthBaseUrl(env('local-development', config), nonLoopbackPeer))
      .toThrow('must use HTTPS in release mode');
  });
});
