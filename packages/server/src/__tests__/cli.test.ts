/**
 * 서버 단위 테스트 — CLI keys.ts + service-key.ts
 * 1-24 cli.test.ts — 40개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/cli.test.ts
 *
 * NOTE:
 *   - CLI 명령 실행 없이 순수 함수만 테스트
 *   - generateServiceKey / maskKey → keys.ts에서 export
 *   - matchesScope / buildConstraintCtx → service-key.ts에서 export
 */

import { describe, it, expect } from 'vitest';
import { generateServiceKey, maskKey } from '../../../cli/src/commands/keys.js';
import {
  matchesScope,
  buildConstraintCtx,
} from '../lib/service-key.js';
import type { ServiceKeyEntry } from '@edgebase-fun/shared';

// ─── A. generateServiceKey ────────────────────────────────────────────────────

describe('generateServiceKey', () => {
  it('returns 64-character hex string', () => {
    const key = generateServiceKey();
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it('generates unique keys each call', () => {
    const a = generateServiceKey();
    const b = generateServiceKey();
    expect(a).not.toBe(b);
  });

  it('is cryptographically unpredictable (entropy check via uniqueness)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 20; i++) set.add(generateServiceKey());
    expect(set.size).toBe(20);
  });
});

// ─── B. maskKey ──────────────────────────────────────────────────────────────

describe('maskKey', () => {
  it('short key (<=8) → ****', () => {
    expect(maskKey('abc')).toBe('****');
    expect(maskKey('12345678')).toBe('****');
  });

  it('long key → sk_***...{last4}', () => {
    const key = '0'.repeat(60) + 'abcd';
    const masked = maskKey(key);
    expect(masked).toMatch(/^sk_\*+abcd$/);
  });

  it('shows last 4 characters', () => {
    const key = generateServiceKey();
    const masked = maskKey(key);
    expect(masked.endsWith(key.slice(-4))).toBe(true);
  });

  it('always starts with sk_', () => {
    const key = generateServiceKey();
    expect(maskKey(key).startsWith('sk_')).toBe(true);
  });

  it('does not reveal full key', () => {
    const key = generateServiceKey();
    expect(maskKey(key)).not.toBe(key);
  });
});

// ─── C. matchesScope ─────────────────────────────────────────────────────────

describe('matchesScope', () => {
  const rootEntry: ServiceKeyEntry = {
    kid: 'root-1',
    tier: 'root',
    scopes: [],
    secretSource: 'inline',
    inlineSecret: 'sk',
  };

  const scopedEntry: ServiceKeyEntry = {
    kid: 'scoped-1',
    tier: 'scoped',
    scopes: ['storage:bucket:avatars:write'],
    secretSource: 'inline',
    inlineSecret: 'sk',
  };

  const wildcardEntry: ServiceKeyEntry = {
    kid: 'wild-1',
    tier: 'scoped',
    scopes: ['storage:*:*:*'],
    secretSource: 'inline',
    inlineSecret: 'sk',
  };

  const globalWildEntry: ServiceKeyEntry = {
    kid: 'global-1',
    tier: 'scoped',
    scopes: ['*'],
    secretSource: 'inline',
    inlineSecret: 'sk',
  };

  it('root tier always passes', () => {
    expect(matchesScope('storage:bucket:avatars:write', rootEntry)).toBe(true);
    expect(matchesScope('db:table:posts:read', rootEntry)).toBe(true);
  });

  it('exact scope match → valid', () => {
    expect(matchesScope('storage:bucket:avatars:write', scopedEntry)).toBe(true);
  });

  it('scope mismatch → invalid', () => {
    expect(matchesScope('storage:bucket:photos:write', scopedEntry)).toBe(false);
    expect(matchesScope('db:table:posts:read', scopedEntry)).toBe(false);
  });

  it('wildcard scope matches domain:*:*:*', () => {
    expect(matchesScope('storage:bucket:avatars:write', wildcardEntry)).toBe(true);
    expect(matchesScope('storage:bucket:photos:read', wildcardEntry)).toBe(true);
  });

  it('wildcard does not cross domains', () => {
    expect(matchesScope('db:table:posts:read', wildcardEntry)).toBe(false);
  });

  it('global wildcard "*" matches anything', () => {
    expect(matchesScope('anything:goes:here:now', globalWildEntry)).toBe(true);
  });

  it('different segment count → no match', () => {
    const partial: ServiceKeyEntry = {
      kid: 'partial',
      tier: 'scoped',
      scopes: ['storage:bucket'],
      secretSource: 'inline',
      inlineSecret: 'sk',
    };
    expect(matchesScope('storage:bucket:avatars:write', partial)).toBe(false);
  });
});

// ─── E. buildConstraintCtx ────────────────────────────────────────────────────

describe('buildConstraintCtx', () => {
  it('extracts env from ENVIRONMENT', () => {
    const ctx = buildConstraintCtx({ ENVIRONMENT: 'production' });
    expect(ctx.env).toBe('production');
  });

  it('no env → undefined', () => {
    const ctx = buildConstraintCtx({});
    expect(ctx.env).toBeUndefined();
  });

  it('extracts IP from cf-connecting-ip header', () => {
    const req = { header: (name: string) => name === 'cf-connecting-ip' ? '1.2.3.4' : undefined };
    const ctx = buildConstraintCtx({ EDGEBASE_CONFIG: '{}' }, req);
    expect(ctx.ip).toBe('1.2.3.4');
  });

  it('ignores x-forwarded-for unless trustSelfHostedProxy is enabled', () => {
    const req = { header: (name: string) => name === 'x-forwarded-for' ? '5.6.7.8, 9.10.11.12' : undefined };
    const ctx = buildConstraintCtx({ EDGEBASE_CONFIG: '{}' }, req);
    expect(ctx.ip).toBeUndefined();
  });

  it('falls back to x-forwarded-for when trustSelfHostedProxy is enabled', () => {
    const req = { header: (name: string) => name === 'x-forwarded-for' ? '5.6.7.8, 9.10.11.12' : undefined };
    const ctx = buildConstraintCtx({ EDGEBASE_CONFIG: JSON.stringify({ trustSelfHostedProxy: true }) }, req);
    expect(ctx.ip).toBe('5.6.7.8');
  });
});
