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
