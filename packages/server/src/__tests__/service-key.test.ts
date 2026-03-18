/**
 * Unit tests for lib/service-key.ts
 *
 * Focuses on buildKeymap and validateKey (KNOWN_UNCOVERED_EXPORTS),
 * plus matchesScope and validateScopedKey coverage.
 */
import { describe, it, expect } from 'vitest';
import {
  buildKeymap,
  extractBearerToken,
  validateKey,
  validateConfiguredKey,
  matchesConfiguredSecret,
  matchesScope,
  validateScopedKey,
  buildConstraintCtx,
  extractServiceKeyHeader,
  resolveRootServiceKey,
  resolveServiceKeyCandidate,
} from '../lib/service-key.js';
import { getTrustedClientIp } from '../lib/client-ip.js';
import type { EdgeBaseConfig, ServiceKeyEntry } from '@edgebase-fun/shared';
import type { Env } from '../types.js';

// ─── Helpers ───

function makeEntry(overrides: Partial<ServiceKeyEntry> & { kid: string }): ServiceKeyEntry {
  return {
    tier: 'root',
    scopes: ['*'],
    secretSource: 'inline',
    inlineSecret: 'test-secret',
    ...overrides,
  };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { ...overrides } as Env;
}

function makeConfig(keys: ServiceKeyEntry[]): EdgeBaseConfig {
  return { serviceKeys: { keys } } as EdgeBaseConfig;
}

// ─── buildKeymap ───

describe('buildKeymap', () => {
  it('returns null when config has no serviceKeys', () => {
    const result = buildKeymap({} as EdgeBaseConfig, makeEnv());
    expect(result).toBeNull();
  });

  it('returns null when serviceKeys.keys is empty', () => {
    const result = buildKeymap(makeConfig([]), makeEnv());
    expect(result).toBeNull();
  });

  it('builds keymap from inline secrets', () => {
    const entry = makeEntry({ kid: 'k1', inlineSecret: 'secret-1' });
    const result = buildKeymap(makeConfig([entry]), makeEnv());

    expect(result).not.toBeNull();
    expect(result!.size).toBe(1);
    expect(result!.get('k1')!.secret).toBe('secret-1');
    expect(result!.get('k1')!.entry).toBe(entry);
  });

  it('resolves dashboard secrets from env', () => {
    const entry = makeEntry({
      kid: 'k2',
      secretSource: 'dashboard',
      secretRef: 'MY_SECRET_VAR',
      inlineSecret: undefined,
    });
    const env = makeEnv({ MY_SECRET_VAR: 'env-resolved-secret' } as unknown as Partial<Env>);
    const result = buildKeymap(makeConfig([entry]), env);

    expect(result).not.toBeNull();
    expect(result!.get('k2')!.secret).toBe('env-resolved-secret');
  });

  it('skips disabled entries', () => {
    const enabled = makeEntry({ kid: 'e1', inlineSecret: 'yes' });
    const disabled = makeEntry({ kid: 'e2', inlineSecret: 'no', enabled: false });
    const result = buildKeymap(makeConfig([enabled, disabled]), makeEnv());

    expect(result!.size).toBe(1);
    expect(result!.has('e1')).toBe(true);
    expect(result!.has('e2')).toBe(false);
  });

  it('skips entries with no resolvable secret', () => {
    const noSecret = makeEntry({
      kid: 'k3',
      secretSource: 'dashboard',
      secretRef: 'MISSING_VAR',
      inlineSecret: undefined,
    });
    const result = buildKeymap(makeConfig([noSecret]), makeEnv());
    expect(result).toBeNull(); // single entry has no secret → empty map → null
  });

  it('returns null when all entries resolve to no secret', () => {
    const entries = [
      makeEntry({ kid: 'a', secretSource: 'dashboard', secretRef: undefined, inlineSecret: undefined }),
      makeEntry({ kid: 'b', secretSource: 'inline', inlineSecret: '' }),
    ];
    const result = buildKeymap(makeConfig(entries), makeEnv());
    expect(result).toBeNull();
  });

  it('skips dashboard entries without secretRef', () => {
    const entry = makeEntry({
      kid: 'noref',
      secretSource: 'dashboard',
      secretRef: undefined, // no ref
      inlineSecret: undefined,
    });
    const result = buildKeymap(makeConfig([entry]), makeEnv());
    expect(result).toBeNull();
  });

  it('handles multiple entries with mixed secret sources', () => {
    const entries = [
      makeEntry({ kid: 'inline1', secretSource: 'inline', inlineSecret: 'sec-a' }),
      makeEntry({ kid: 'dash1', secretSource: 'dashboard', secretRef: 'REF_1', inlineSecret: undefined }),
      makeEntry({ kid: 'inline2', secretSource: 'inline', inlineSecret: 'sec-b' }),
    ];
    const env = makeEnv({ REF_1: 'sec-from-env' } as unknown as Partial<Env>);
    const result = buildKeymap(makeConfig(entries), env);

    expect(result!.size).toBe(3);
    expect(result!.get('inline1')!.secret).toBe('sec-a');
    expect(result!.get('dash1')!.secret).toBe('sec-from-env');
    expect(result!.get('inline2')!.secret).toBe('sec-b');
  });
});

// ─── resolveRootServiceKey ───

describe('resolveRootServiceKey', () => {
  it('prefers the canonical SERVICE_KEY root when multiple usable root keys exist', () => {
    const config = makeConfig([
      makeEntry({ kid: 'fallback', inlineSecret: 'fallback-secret' }),
      makeEntry({
        kid: 'default',
        secretSource: 'dashboard',
        secretRef: 'SERVICE_KEY',
        inlineSecret: undefined,
      }),
    ]);

    const env = makeEnv({ SERVICE_KEY: 'canonical-secret' });
    expect(resolveRootServiceKey(config, env)).toBe('canonical-secret');
  });

  it('skips root keys that require request-scoped constraints', () => {
    const config = makeConfig([
      makeEntry({
        kid: 'tenant-root',
        inlineSecret: 'tenant-secret',
        constraints: { tenant: 'workspace-123' },
      }),
      makeEntry({
        kid: 'default',
        secretSource: 'dashboard',
        secretRef: 'SERVICE_KEY',
        inlineSecret: undefined,
      }),
    ]);

    const env = makeEnv({ SERVICE_KEY: 'canonical-secret', ENVIRONMENT: 'prod' });
    expect(resolveRootServiceKey(config, env)).toBe('canonical-secret');
  });

  it('skips env-constrained roots that do not match the current worker environment', () => {
    const config = makeConfig([
      makeEntry({
        kid: 'prod-only',
        inlineSecret: 'prod-secret',
        constraints: { env: ['prod'] },
      }),
      makeEntry({
        kid: 'default',
        secretSource: 'dashboard',
        secretRef: 'SERVICE_KEY',
        inlineSecret: undefined,
      }),
    ]);

    const env = makeEnv({ SERVICE_KEY: 'canonical-secret', ENVIRONMENT: 'staging' });
    expect(resolveRootServiceKey(config, env)).toBe('canonical-secret');
  });
});

// ─── validateKey ───

describe('validateKey', () => {
  it('uses scoped path when config has serviceKeys', () => {
    const entry = makeEntry({ kid: 'k1', inlineSecret: 'jb_k1_payload', tier: 'root' });
    const config = makeConfig([entry]);
    const env = makeEnv();

    const { result, keymap } = validateKey('jb_k1_payload', 'db:table:users:read', config, env);
    expect(result).toBe('valid');
    expect(keymap).not.toBeNull();
  });

  it('returns missing when no serviceKeys are configured', () => {
    const config = {} as EdgeBaseConfig;
    const env = makeEnv({ SERVICE_KEY: 'legacy-key' });

    const { result, keymap } = validateKey('legacy-key', 'any:scope', config, env);
    expect(result).toBe('missing');
    expect(keymap).toBeNull();
  });

  it('returns missing when no service key config exists', () => {
    const config = {} as EdgeBaseConfig;
    const env = makeEnv();

    const { result } = validateKey('some-key', 'any:scope', config, env);
    expect(result).toBe('missing');
  });

  it('does not validate env-only keys without serviceKeys config', () => {
    const config = {} as EdgeBaseConfig;
    const env = makeEnv({ SERVICE_KEY: 'correct-key' });

    const { result } = validateKey('wrong-key', 'any:scope', config, env);
    expect(result).toBe('missing');
  });

  it('uses provided keymapCache instead of rebuilding', () => {
    const entry = makeEntry({ kid: 'cached', inlineSecret: 'jb_cached_secret', tier: 'root' });
    const cachedKeymap = new Map([['cached', { entry, secret: 'jb_cached_secret' }]]);
    const config = {} as EdgeBaseConfig; // no serviceKeys — but cache is provided
    const env = makeEnv();

    const { result, keymap } = validateKey('jb_cached_secret', 'any:scope', config, env, cachedKeymap);
    expect(result).toBe('valid');
    expect(keymap).toBe(cachedKeymap);
  });

  it('keymapCache = null preserves missing result without serviceKeys config', () => {
    const config = {} as EdgeBaseConfig;
    const env = makeEnv({ SERVICE_KEY: 'leg' });

    const { result, keymap } = validateKey('leg', 'scope', config, env, null);
    expect(result).toBe('missing');
    expect(keymap).toBeNull();
  });

  it('scoped path: invalid key returns invalid', () => {
    const entry = makeEntry({ kid: 'k1', inlineSecret: 'jb_k1_real', tier: 'root' });
    const config = makeConfig([entry]);
    const env = makeEnv();

    const { result } = validateKey('jb_k1_wrong', 'any:scope', config, env);
    expect(result).toBe('invalid');
  });

  it('scoped path: null provided returns missing', () => {
    const entry = makeEntry({ kid: 'k1', inlineSecret: 'jb_k1_real', tier: 'root' });
    const config = makeConfig([entry]);
    const env = makeEnv();

    const { result } = validateKey(null, 'any:scope', config, env);
    expect(result).toBe('missing');
  });

  it('passes constraint context through to scoped validation', () => {
    const entry = makeEntry({
      kid: 'env1',
      inlineSecret: 'jb_env1_payload',
      tier: 'root',
      constraints: { env: ['production'] },
    });
    const config = makeConfig([entry]);
    const env = makeEnv();

    // Correct env constraint
    const { result: r1 } = validateKey(
      'jb_env1_payload', 'any:scope', config, env, undefined, { env: 'production' },
    );
    expect(r1).toBe('valid');

    // Wrong env constraint
    const { result: r2 } = validateKey(
      'jb_env1_payload', 'any:scope', config, env, undefined, { env: 'staging' },
    );
    expect(r2).toBe('invalid');
  });
});

// ─── matchesScope (additional edge cases) ───

describe('matchesScope', () => {
  it('root tier always returns true', () => {
    const entry = makeEntry({ kid: 'r', tier: 'root', scopes: [] });
    expect(matchesScope('db:table:users:read', entry)).toBe(true);
  });

  it('global wildcard "*" matches everything', () => {
    const entry = makeEntry({ kid: 's', tier: 'scoped', scopes: ['*'] });
    expect(matchesScope('storage:bucket:avatars:write', entry)).toBe(true);
  });

  it('exact scope match', () => {
    const entry = makeEntry({ kid: 's', tier: 'scoped', scopes: ['db:table:users:read'] });
    expect(matchesScope('db:table:users:read', entry)).toBe(true);
  });

  it('partial wildcard in scope', () => {
    const entry = makeEntry({ kid: 's', tier: 'scoped', scopes: ['db:table:*:read'] });
    expect(matchesScope('db:table:users:read', entry)).toBe(true);
    expect(matchesScope('db:table:posts:read', entry)).toBe(true);
    expect(matchesScope('db:table:users:write', entry)).toBe(false);
  });

  it('segment count mismatch → no match', () => {
    const entry = makeEntry({ kid: 's', tier: 'scoped', scopes: ['db:table:users'] });
    expect(matchesScope('db:table:users:read', entry)).toBe(false);
  });

  it('multiple scopes — first mismatch, second matches', () => {
    const entry = makeEntry({
      kid: 's',
      tier: 'scoped',
      scopes: ['storage:bucket:photos:write', 'db:table:*:read'],
    });
    expect(matchesScope('db:table:users:read', entry)).toBe(true);
    expect(matchesScope('storage:bucket:photos:write', entry)).toBe(true);
    expect(matchesScope('kv:namespace:cache:read', entry)).toBe(false);
  });

  it('empty scopes on scoped tier → no match', () => {
    const entry = makeEntry({ kid: 's', tier: 'scoped', scopes: [] });
    expect(matchesScope('db:table:users:read', entry)).toBe(false);
  });

  it('domain-level wildcard matches all under domain', () => {
    const entry = makeEntry({ kid: 's', tier: 'scoped', scopes: ['storage:*:*:*'] });
    expect(matchesScope('storage:bucket:avatars:write', entry)).toBe(true);
    expect(matchesScope('db:table:users:read', entry)).toBe(false);
  });
});

// ─── validateScopedKey ───

describe('validateScopedKey', () => {
  it('returns missing for null/undefined and invalid for empty string', () => {
    const keymap = new Map();
    expect(validateScopedKey(null, 'scope', keymap)).toBe('missing');
    expect(validateScopedKey(undefined, 'scope', keymap)).toBe('missing');
    expect(validateScopedKey('', 'scope', keymap)).toBe('invalid');
  });

  it('returns missing for empty keymap', () => {
    const keymap = new Map();
    expect(validateScopedKey('some-key', 'scope', keymap)).toBe('missing');
  });

  it('jb_ format: valid key with matching kid', () => {
    const entry = makeEntry({ kid: 'abc', inlineSecret: 'jb_abc_secretpayload', tier: 'root' });
    const keymap = new Map([['abc', { entry, secret: 'jb_abc_secretpayload' }]]);

    expect(validateScopedKey('jb_abc_secretpayload', 'any:scope', keymap)).toBe('valid');
  });

  it('jb_ format: invalid when kid not found', () => {
    const entry = makeEntry({ kid: 'abc', inlineSecret: 'jb_abc_secret', tier: 'root' });
    const keymap = new Map([['abc', { entry, secret: 'jb_abc_secret' }]]);

    expect(validateScopedKey('jb_xyz_secret', 'any:scope', keymap)).toBe('invalid');
  });

  it('jb_ format: invalid when secret mismatch', () => {
    const entry = makeEntry({ kid: 'abc', inlineSecret: 'jb_abc_correct', tier: 'root' });
    const keymap = new Map([['abc', { entry, secret: 'jb_abc_correct' }]]);

    expect(validateScopedKey('jb_abc_wronggg', 'any:scope', keymap)).toBe('invalid');
  });

  it('jb_ format: invalid when scope not matched (scoped tier)', () => {
    const entry = makeEntry({
      kid: 'sc',
      inlineSecret: 'jb_sc_payload',
      tier: 'scoped',
      scopes: ['db:table:users:read'],
    });
    const keymap = new Map([['sc', { entry, secret: 'jb_sc_payload' }]]);

    expect(validateScopedKey('jb_sc_payload', 'storage:bucket:avatars:write', keymap)).toBe('invalid');
  });

  it('plain key format: matches root-tier entry', () => {
    const entry = makeEntry({ kid: 'root1', inlineSecret: 'plain-secret', tier: 'root' });
    const keymap = new Map([['root1', { entry, secret: 'plain-secret' }]]);

    expect(validateScopedKey('plain-secret', 'any:scope', keymap)).toBe('valid');
  });

  it('plain key format: returns invalid when no root entry matches', () => {
    const entry = makeEntry({ kid: 'root1', inlineSecret: 'correct-secret', tier: 'root' });
    const keymap = new Map([['root1', { entry, secret: 'correct-secret' }]]);

    expect(validateScopedKey('wrong-secret', 'any:scope', keymap)).toBe('invalid');
  });

  it('plain key format: returns missing when no root-tier entries exist', () => {
    const entry = makeEntry({
      kid: 'sc1',
      inlineSecret: 'jb_sc1_something',
      tier: 'scoped',
      scopes: ['*'],
    });
    const keymap = new Map([['sc1', { entry, secret: 'jb_sc1_something' }]]);

    // This is a plain key (no jb_ prefix), and only scoped entries exist
    expect(validateScopedKey('some-plain-key', 'any:scope', keymap)).toBe('missing');
  });

  it('jb_ format: constraint failure returns invalid', () => {
    const entry = makeEntry({
      kid: 'cx',
      inlineSecret: 'jb_cx_payload',
      tier: 'root',
      constraints: { expiresAt: '2020-01-01T00:00:00Z' }, // expired
    });
    const keymap = new Map([['cx', { entry, secret: 'jb_cx_payload' }]]);

    expect(validateScopedKey('jb_cx_payload', 'any:scope', keymap)).toBe('invalid');
  });

  // ─── checkConstraints detailed paths ───

  it('expiresAt: future date passes', () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const entry = makeEntry({
      kid: 'exp',
      inlineSecret: 'jb_exp_payload',
      tier: 'root',
      constraints: { expiresAt: future },
    });
    const keymap = new Map([['exp', { entry, secret: 'jb_exp_payload' }]]);
    expect(validateScopedKey('jb_exp_payload', 'any:scope', keymap)).toBe('valid');
  });

  it('expiresAt: exact now boundary → invalid (>= check)', () => {
    // Use a date in the past by 1ms to ensure Date.now() >= expiresAt
    const justPast = new Date(Date.now() - 1).toISOString();
    const entry = makeEntry({
      kid: 'expb',
      inlineSecret: 'jb_expb_payload',
      tier: 'root',
      constraints: { expiresAt: justPast },
    });
    const keymap = new Map([['expb', { entry, secret: 'jb_expb_payload' }]]);
    expect(validateScopedKey('jb_expb_payload', 'any:scope', keymap)).toBe('invalid');
  });

  it('expiresAt: invalid date string passes (NaN check)', () => {
    const entry = makeEntry({
      kid: 'expn',
      inlineSecret: 'jb_expn_payload',
      tier: 'root',
      constraints: { expiresAt: 'not-a-date' },
    });
    const keymap = new Map([['expn', { entry, secret: 'jb_expn_payload' }]]);
    expect(validateScopedKey('jb_expn_payload', 'any:scope', keymap)).toBe('valid');
  });

  it('env constraint: matching env passes', () => {
    const entry = makeEntry({
      kid: 'env1',
      inlineSecret: 'jb_env1_payload',
      tier: 'root',
      constraints: { env: ['production', 'staging'] },
    });
    const keymap = new Map([['env1', { entry, secret: 'jb_env1_payload' }]]);
    expect(validateScopedKey('jb_env1_payload', 'any:scope', keymap, { env: 'staging' })).toBe('valid');
  });

  it('env constraint: non-matching env fails', () => {
    const entry = makeEntry({
      kid: 'env2',
      inlineSecret: 'jb_env2_payload',
      tier: 'root',
      constraints: { env: ['production'] },
    });
    const keymap = new Map([['env2', { entry, secret: 'jb_env2_payload' }]]);
    expect(validateScopedKey('jb_env2_payload', 'any:scope', keymap, { env: 'development' })).toBe('invalid');
  });

  it('env constraint: no ctx.env → denied (fail-closed)', () => {
    const entry = makeEntry({
      kid: 'env3',
      inlineSecret: 'jb_env3_payload',
      tier: 'root',
      constraints: { env: ['production'] },
    });
    const keymap = new Map([['env3', { entry, secret: 'jb_env3_payload' }]]);
    // No env in context — constraint fails (fail-closed)
    expect(validateScopedKey('jb_env3_payload', 'any:scope', keymap, {})).toBe('invalid');
  });

  it('ipCidr constraint: matching IP passes', () => {
    const entry = makeEntry({
      kid: 'ip1',
      inlineSecret: 'jb_ip1_payload',
      tier: 'root',
      constraints: { ipCidr: ['10.0.0.0/8'] },
    });
    const keymap = new Map([['ip1', { entry, secret: 'jb_ip1_payload' }]]);
    expect(validateScopedKey('jb_ip1_payload', 'any:scope', keymap, { ip: '10.1.2.3' })).toBe('valid');
  });

  it('ipCidr constraint: non-matching IP fails', () => {
    const entry = makeEntry({
      kid: 'ip2',
      inlineSecret: 'jb_ip2_payload',
      tier: 'root',
      constraints: { ipCidr: ['10.0.0.0/8'] },
    });
    const keymap = new Map([['ip2', { entry, secret: 'jb_ip2_payload' }]]);
    expect(validateScopedKey('jb_ip2_payload', 'any:scope', keymap, { ip: '192.168.1.1' })).toBe('invalid');
  });

  it('ipCidr constraint: no ctx.ip → denied (fail-closed)', () => {
    const entry = makeEntry({
      kid: 'ip3',
      inlineSecret: 'jb_ip3_payload',
      tier: 'root',
      constraints: { ipCidr: ['10.0.0.0/8'] },
    });
    const keymap = new Map([['ip3', { entry, secret: 'jb_ip3_payload' }]]);
    expect(validateScopedKey('jb_ip3_payload', 'any:scope', keymap, {})).toBe('invalid');
  });

  it('tenant constraint: matching tenantId passes', () => {
    const entry = makeEntry({
      kid: 'tn1',
      inlineSecret: 'jb_tn1_payload',
      tier: 'root',
      constraints: { tenant: 'tenant-abc' },
    });
    const keymap = new Map([['tn1', { entry, secret: 'jb_tn1_payload' }]]);
    expect(validateScopedKey('jb_tn1_payload', 'any:scope', keymap, { tenantId: 'tenant-abc' })).toBe('valid');
  });

  it('tenant constraint: non-matching tenantId fails', () => {
    const entry = makeEntry({
      kid: 'tn2',
      inlineSecret: 'jb_tn2_payload',
      tier: 'root',
      constraints: { tenant: 'tenant-abc' },
    });
    const keymap = new Map([['tn2', { entry, secret: 'jb_tn2_payload' }]]);
    expect(validateScopedKey('jb_tn2_payload', 'any:scope', keymap, { tenantId: 'tenant-xyz' })).toBe('invalid');
  });

  it('tenant constraint: no ctx.tenantId → denied (fail-closed)', () => {
    const entry = makeEntry({
      kid: 'tn3',
      inlineSecret: 'jb_tn3_payload',
      tier: 'root',
      constraints: { tenant: 'tenant-abc' },
    });
    const keymap = new Map([['tn3', { entry, secret: 'jb_tn3_payload' }]]);
    expect(validateScopedKey('jb_tn3_payload', 'any:scope', keymap, {})).toBe('invalid');
  });

  it('no constraints defined → passes', () => {
    const entry = makeEntry({
      kid: 'nc',
      inlineSecret: 'jb_nc_payload',
      tier: 'root',
      // No constraints
    });
    const keymap = new Map([['nc', { entry, secret: 'jb_nc_payload' }]]);
    expect(validateScopedKey('jb_nc_payload', 'any:scope', keymap)).toBe('valid');
  });

  // ─── validateScopedKey additional edge cases ───

  it('empty string with non-empty keymap returns invalid', () => {
    const entry = makeEntry({ kid: 'k1', inlineSecret: 'jb_k1_sec', tier: 'root' });
    const keymap = new Map([['k1', { entry, secret: 'jb_k1_sec' }]]);
    expect(validateScopedKey('', 'any:scope', keymap)).toBe('invalid');
  });

  it('jb_ prefix without second underscore falls through to plain key path', () => {
    // "jb_abc" has no second underscore → treated as plain key
    const entry = makeEntry({ kid: 'root', inlineSecret: 'jb_abc', tier: 'root' });
    const keymap = new Map([['root', { entry, secret: 'jb_abc' }]]);
    expect(validateScopedKey('jb_abc', 'any:scope', keymap)).toBe('valid');
  });

  it('jb_ with underscore at position 3 exactly falls through', () => {
    // "jb__rest" → secondUnderscore === 3, which is NOT > 3
    const entry = makeEntry({ kid: 'root', inlineSecret: 'jb__rest', tier: 'root' });
    const keymap = new Map([['root', { entry, secret: 'jb__rest' }]]);
    expect(validateScopedKey('jb__rest', 'any:scope', keymap)).toBe('valid');
  });

  it('plain key: root-tier constraint failure returns invalid', () => {
    const entry = makeEntry({
      kid: 'root1',
      inlineSecret: 'plain-secret',
      tier: 'root',
      constraints: { expiresAt: '2020-01-01T00:00:00Z' }, // expired
    });
    const keymap = new Map([['root1', { entry, secret: 'plain-secret' }]]);
    expect(validateScopedKey('plain-secret', 'any:scope', keymap)).toBe('invalid');
  });
});

// ─── buildConstraintCtx ───

describe('buildConstraintCtx', () => {
  it('getTrustedClientIp prefers cf-connecting-ip even when trustSelfHostedProxy is enabled', () => {
    const req = {
      header: (name: string) => {
        if (name === 'cf-connecting-ip') return '1.1.1.1';
        if (name === 'x-forwarded-for') return '10.0.0.1';
        return undefined;
      },
    };
    expect(getTrustedClientIp({ EDGEBASE_CONFIG: JSON.stringify({ trustSelfHostedProxy: true }) }, req)).toBe('1.1.1.1');
  });

  it('sets env from ENVIRONMENT', () => {
    const ctx = buildConstraintCtx({ ENVIRONMENT: 'production' });
    expect(ctx.env).toBe('production');
  });

  it('extracts IP from cf-connecting-ip', () => {
    const req = { header: (name: string) => name === 'cf-connecting-ip' ? '1.2.3.4' : undefined };
    const ctx = buildConstraintCtx({ EDGEBASE_CONFIG: '{}' }, req);
    expect(ctx.ip).toBe('1.2.3.4');
  });

  it('ignores x-forwarded-for unless trustSelfHostedProxy is enabled', () => {
    const req = {
      header: (name: string) => name === 'x-forwarded-for' ? '10.0.0.1, 10.0.0.2' : undefined,
    };
    const ctx = buildConstraintCtx({ EDGEBASE_CONFIG: '{}' }, req);
    expect(ctx.ip).toBeUndefined();
  });

  it('uses x-forwarded-for first IP when trustSelfHostedProxy is enabled', () => {
    const req = {
      header: (name: string) => name === 'x-forwarded-for' ? '10.0.0.1, 10.0.0.2' : undefined,
    };
    const ctx = buildConstraintCtx({ EDGEBASE_CONFIG: JSON.stringify({ trustSelfHostedProxy: true }) }, req);
    expect(ctx.ip).toBe('10.0.0.1');
  });

  it('trims whitespace from x-forwarded-for IP', () => {
    const req = {
      header: (name: string) => name === 'x-forwarded-for' ? '  10.0.0.1 , 10.0.0.2' : undefined,
    };
    const ctx = buildConstraintCtx({ EDGEBASE_CONFIG: JSON.stringify({ trustSelfHostedProxy: true }) }, req);
    expect(ctx.ip).toBe('10.0.0.1');
  });

  it('handles x-forwarded-for with single IP (no comma)', () => {
    const req = {
      header: (name: string) => name === 'x-forwarded-for' ? '10.0.0.1' : undefined,
    };
    const ctx = buildConstraintCtx({ EDGEBASE_CONFIG: JSON.stringify({ trustSelfHostedProxy: true }) }, req);
    expect(ctx.ip).toBe('10.0.0.1');
  });

  it('no req → ip is undefined', () => {
    const ctx = buildConstraintCtx({});
    expect(ctx.ip).toBeUndefined();
  });

  it('no headers at all → ip is undefined', () => {
    const req = { header: () => undefined };
    const ctx = buildConstraintCtx({}, req);
    expect(ctx.ip).toBeUndefined();
  });
});

describe('service key header helpers', () => {
  it('extractServiceKeyHeader preserves explicitly empty header values', () => {
    const req = {
      header: (name: string) => (name === 'X-EdgeBase-Service-Key' ? '' : undefined),
    };
    expect(extractServiceKeyHeader(req)).toBe('');
  });

  it('resolveServiceKeyCandidate prefers header presence over fallback token', () => {
    const req = {
      header: (name: string) => (name === 'X-EdgeBase-Service-Key' ? '' : undefined),
    };
    expect(resolveServiceKeyCandidate(req, 'fallback-token')).toBe('');
  });

  it('extractBearerToken preserves empty Bearer payloads', () => {
    const req = {
      header: (name: string) => (name === 'authorization' ? 'Bearer ' : undefined),
    };
    expect(extractBearerToken(req)).toBe('');
  });

  it('extractServiceKeyHeader falls back to raw request headers when Hono header lookup misses', () => {
    const req = {
      header: () => undefined,
      raw: new Request('http://localhost/api/test', {
        headers: { 'X-EdgeBase-Service-Key': 'raw-secret' },
      }),
    };
    expect(extractServiceKeyHeader(req)).toBe('raw-secret');
  });

  it('resolveServiceKeyCandidate prefers raw service key header over bearer fallback', () => {
    const req = {
      header: () => undefined,
      raw: new Request('http://localhost/api/test', {
        headers: { 'X-EdgeBase-Service-Key': 'raw-secret' },
      }),
    };
    expect(resolveServiceKeyCandidate(req, 'fallback-token')).toBe('raw-secret');
  });
});

describe('validateConfiguredKey', () => {
  it('validates configured secrets exactly', () => {
    const entry = makeEntry({ kid: 'cfg', inlineSecret: 'my-secret-key' });
    const keymap = new Map([['cfg', { entry, secret: 'my-secret-key' }]]);

    expect(validateConfiguredKey('my-secret-key', keymap, {})).toBe('valid');
    expect(validateConfiguredKey('wrong-key', keymap, {})).toBe('invalid');
  });

  it('treats empty configured key as invalid and nullish as missing', () => {
    const entry = makeEntry({ kid: 'cfg', inlineSecret: 'my-secret-key' });
    const keymap = new Map([['cfg', { entry, secret: 'my-secret-key' }]]);

    expect(validateConfiguredKey('', keymap, {})).toBe('invalid');
    expect(validateConfiguredKey(null, keymap, {})).toBe('missing');
    expect(validateConfiguredKey(undefined, keymap, {})).toBe('missing');
  });

  it('matchesConfiguredSecret only accepts exact configured values', () => {
    const entry = makeEntry({ kid: 'cfg', inlineSecret: 'my-secret-key' });
    const keymap = new Map([['cfg', { entry, secret: 'my-secret-key' }]]);

    expect(matchesConfiguredSecret('my-secret-key', keymap)).toBe(true);
    expect(matchesConfiguredSecret('my-secret-key ', keymap)).toBe(false);
    expect(matchesConfiguredSecret('', keymap)).toBe(false);
  });
});
