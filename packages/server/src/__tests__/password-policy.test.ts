/**
 * 서버 단위 테스트 — lib/password-policy.ts
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/password-policy.test.ts
 *
 * 테스트 대상:
 *   validatePassword — policy validation + HIBP k-anonymity mock
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validatePassword } from '../lib/password-policy.js';

// ─── A. Default policy (no config) ─────────────────────────────────────────

describe('validatePassword — default policy', () => {
  it('8+ char password → valid', async () => {
    const result = await validatePassword('abcdefgh');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('7 char password → too short', async () => {
    const result = await validatePassword('abcdefg');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('at least 8');
  });

  it('empty password → too short', async () => {
    const result = await validatePassword('');
    expect(result.valid).toBe(false);
  });

  it('exactly 8 chars → valid', async () => {
    const result = await validatePassword('12345678');
    expect(result.valid).toBe(true);
  });
});

// ─── B. Custom minLength ────────────────────────────────────────────────────

describe('validatePassword — custom minLength', () => {
  it('minLength 12 — 11 chars → invalid', async () => {
    const result = await validatePassword('12345678901', { minLength: 12 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('at least 12');
  });

  it('minLength 12 — 12 chars → valid', async () => {
    const result = await validatePassword('123456789012', { minLength: 12 });
    expect(result.valid).toBe(true);
  });
});

// ─── C. Uppercase requirement ───────────────────────────────────────────────

describe('validatePassword — requireUppercase', () => {
  it('no uppercase → error', async () => {
    const result = await validatePassword('abcdefgh', { requireUppercase: true });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('uppercase');
  });

  it('with uppercase → valid', async () => {
    const result = await validatePassword('Abcdefgh', { requireUppercase: true });
    expect(result.valid).toBe(true);
  });
});

// ─── D. Lowercase requirement ───────────────────────────────────────────────

describe('validatePassword — requireLowercase', () => {
  it('no lowercase → error', async () => {
    const result = await validatePassword('ABCDEFGH', { requireLowercase: true });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('lowercase');
  });

  it('with lowercase → valid', async () => {
    const result = await validatePassword('ABCDEFGh', { requireLowercase: true });
    expect(result.valid).toBe(true);
  });
});

// ─── E. Number requirement ──────────────────────────────────────────────────

describe('validatePassword — requireNumber', () => {
  it('no digit → error', async () => {
    const result = await validatePassword('abcdefgh', { requireNumber: true });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('digit');
  });

  it('with digit → valid', async () => {
    const result = await validatePassword('abcdefg1', { requireNumber: true });
    expect(result.valid).toBe(true);
  });
});

// ─── F. Special character requirement ───────────────────────────────────────

describe('validatePassword — requireSpecial', () => {
  it('no special char → error', async () => {
    const result = await validatePassword('Abcdefg1', { requireSpecial: true });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('special');
  });

  it('with special char → valid', async () => {
    const result = await validatePassword('Abcdefg!', { requireSpecial: true });
    expect(result.valid).toBe(true);
  });
});

// ─── G. Multiple errors ─────────────────────────────────────────────────────

describe('validatePassword — multiple errors', () => {
  it('all requirements violated → all errors returned', async () => {
    const result = await validatePassword('ab', {
      minLength: 8,
      requireUppercase: true,
      requireNumber: true,
      requireSpecial: true,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── H. HIBP check (mocked) ────────────────────────────────────────────────

describe('validatePassword — HIBP check', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('leaked password → error', async () => {
    // SHA-1 of "password" = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    // Prefix: 5BAA6, Suffix: 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    globalThis.fetch = vi.fn(async () =>
      new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\nABC:1\n', { status: 200 }),
    ) as any;

    const result = await validatePassword('password', { checkLeaked: true });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('data breach');
  });

  it('safe password → valid', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\nBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:2\n', { status: 200 }),
    ) as any;

    const result = await validatePassword('MyUniquePa$$w0rd!', { checkLeaked: true });
    expect(result.valid).toBe(true);
  });

  it('HIBP API error → fail-open (valid)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network error');
    }) as any;

    const result = await validatePassword('password', { checkLeaked: true });
    // Fail-open: password accepted when API is down
    expect(result.valid).toBe(true);
  });

  it('HIBP API non-200 → fail-open (valid)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('', { status: 500 }),
    ) as any;

    const result = await validatePassword('password', { checkLeaked: true });
    expect(result.valid).toBe(true);
  });

  it('HIBP not checked if other validations fail', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    // Password too short — HIBP should NOT be called
    await validatePassword('ab', { minLength: 8, checkLeaked: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
