import { describe, expect, it } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import {
  appendRedirectParams,
  buildEmailActionUrl,
  parseClientRedirectInput,
  parseClientRedirectState,
  parseClientRedirectUrl,
} from '../lib/auth-redirect.js';

const envWithAllowList = {
  EDGEBASE_CONFIG: defineConfig({
    auth: {
      allowedRedirectUrls: [
        'https://app.example.com',
        'https://preview.example.com/*',
      ],
    },
  }),
} as const;

describe('auth redirect helpers', () => {
  it('appends only present redirect params', () => {
    expect(
      appendRedirectParams('https://app.example.com/auth/callback', {
        token: 'tok_123',
        type: 'magic-link',
        state: '',
      }),
    ).toBe('https://app.example.com/auth/callback#token=tok_123&type=magic-link');
  });

  it('accepts exact and wildcard allowed redirect URLs', () => {
    expect(
      parseClientRedirectUrl(envWithAllowList as never, 'https://app.example.com/auth/callback'),
    ).toBe('https://app.example.com/auth/callback');
    expect(
      parseClientRedirectUrl(envWithAllowList as never, 'https://preview.example.com/review/123'),
    ).toBe('https://preview.example.com/review/123');
  });

  it('rejects redirect URLs outside the allow list', () => {
    expect(() =>
      parseClientRedirectUrl(envWithAllowList as never, 'https://evil.example.com/auth/callback'),
    ).toThrow('redirect_url is not allowed');
  });

  it('requires exact custom-scheme deep links and rejects opaque-origin aliases', () => {
    const customEnv = {
      EDGEBASE_CONFIG: defineConfig({
        auth: { allowedRedirectUrls: ['myapp://auth/callback'] },
      }),
    };
    expect(
      parseClientRedirectUrl(customEnv as never, 'myapp://auth/callback'),
    ).toBe('myapp://auth/callback');
    expect(() =>
      parseClientRedirectUrl(customEnv as never, 'evil://steal/callback'),
    ).toThrow('redirect_url is not allowed');
    expect(() =>
      parseClientRedirectUrl(customEnv as never, 'myapp://other/callback'),
    ).toThrow('redirect_url is not allowed');
  });

  it('does not permit wildcard matching for custom schemes', () => {
    const customWildcardEnv = {
      EDGEBASE_CONFIG: defineConfig({
        auth: { allowedRedirectUrls: ['myapp://auth/*'] },
      }),
    };
    expect(() =>
      parseClientRedirectUrl(customWildcardEnv as never, 'myapp://auth/callback'),
    ).toThrow('redirect_url is not allowed');
  });

  it('fails closed without an allowlist in release mode', () => {
    const releaseEnv = { EDGEBASE_CONFIG: defineConfig({ release: true }) };
    expect(() =>
      parseClientRedirectUrl(releaseEnv as never, 'https://evil.example/callback'),
    ).toThrow('requires auth.allowedRedirectUrls in release mode');
  });

  it('keeps no-allowlist redirects available in development mode', () => {
    const developmentEnv = { EDGEBASE_CONFIG: defineConfig({ release: false }) };
    expect(
      parseClientRedirectUrl(developmentEnv as never, 'https://localhost.example/callback'),
    ).toBe('https://localhost.example/callback');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,callback',
    'file:///tmp/callback',
    'blob:https://app.example.com/id',
    'intent://callback',
    'mailto:security@example.com',
  ])('rejects executable or privileged redirect scheme %s', (redirectUrl) => {
    const developmentEnv = { EDGEBASE_CONFIG: defineConfig({ release: false }) };
    expect(() => parseClientRedirectUrl(developmentEnv as never, redirectUrl)).toThrow(
      'Invalid redirect_url',
    );
  });

  it('rejects URL credentials even when the HTTP origin is allowlisted', () => {
    expect(() =>
      parseClientRedirectUrl(envWithAllowList as never, 'https://user:secret@app.example.com/callback'),
    ).toThrow('Invalid redirect_url');
  });

  it('rejects plain HTTP callbacks in release mode even when explicitly allowlisted', () => {
    const releaseHttpEnv = {
      EDGEBASE_CONFIG: defineConfig({
        release: true,
        auth: { allowedRedirectUrls: ['http://app.example.com'] },
      }),
    };
    expect(() =>
      parseClientRedirectUrl(releaseHttpEnv as never, 'http://app.example.com/callback'),
    ).toThrow('must use HTTPS in release mode');
  });

  it('rejects custom-scheme callbacks in release mode even when exactly allowlisted', () => {
    const releaseCustomEnv = {
      EDGEBASE_CONFIG: defineConfig({
        release: true,
        auth: { allowedRedirectUrls: ['myapp://auth/callback'] },
      }),
    };
    expect(() =>
      parseClientRedirectUrl(releaseCustomEnv as never, 'myapp://auth/callback'),
    ).toThrow('must use HTTPS in release mode');
  });

  it('permits release HTTP redirects only on the CLI-owned local loopback boundary', () => {
    const localEnv = {
      EDGEBASE_RUNTIME_MODE: 'local-development',
      EDGEBASE_CONFIG: defineConfig({
        release: true,
        auth: { allowedRedirectUrls: ['http://127.0.0.1:3000/callback'] },
      }),
    };
    const localRequest = new Request('http://127.0.0.1:8787/api/auth/signin', {
      headers: { 'CF-Connecting-IP': '127.0.0.1' },
    });
    expect(parseClientRedirectUrl(
      localEnv as never,
      'http://127.0.0.1:3000/callback',
      localRequest,
    )).toBe('http://127.0.0.1:3000/callback');

    const publicRequest = new Request('http://api.example.com/api/auth/signin', {
      headers: { 'CF-Connecting-IP': '127.0.0.1' },
    });
    expect(() => parseClientRedirectUrl(
      localEnv as never,
      'http://127.0.0.1:3000/callback',
      publicRequest,
    )).toThrow('must use HTTPS in release mode');

    const nonLoopbackPeer = new Request('http://127.0.0.1:8787/api/auth/signin', {
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
    });
    expect(() => parseClientRedirectUrl(
      localEnv as never,
      'http://127.0.0.1:3000/callback',
      nonLoopbackPeer,
    )).toThrow('must use HTTPS in release mode');
  });

  it('validates client redirect state length and null handling', () => {
    expect(parseClientRedirectState(null)).toBeNull();
    expect(() => parseClientRedirectState('x'.repeat(1025))).toThrow('state must not exceed 1024 characters');
  });

  it('parses redirect input and preserves state', () => {
    expect(
      parseClientRedirectInput(envWithAllowList as never, {
        redirectUrl: 'https://app.example.com/auth/callback',
        state: 'return-to-dashboard',
      }),
    ).toEqual({
      redirectUrl: 'https://app.example.com/auth/callback',
      state: 'return-to-dashboard',
    });
  });

  it('builds redirect URLs only when a client redirect is present', () => {
    expect(
      buildEmailActionUrl({
        redirectUrl: null,
        fallbackUrl: 'https://edgebase.example.com/auth/fallback',
        token: 'tok_123',
        type: 'verify-email',
      }),
    ).toBe('https://edgebase.example.com/auth/fallback');

    expect(
      buildEmailActionUrl({
        redirectUrl: 'https://app.example.com/auth/callback',
        fallbackUrl: 'https://edgebase.example.com/auth/fallback',
        token: 'tok_123',
        type: 'verify-email',
        state: 'from-test',
      }),
    ).toBe(
      'https://app.example.com/auth/callback#token=tok_123&type=verify-email&state=from-test',
    );
  });
});
