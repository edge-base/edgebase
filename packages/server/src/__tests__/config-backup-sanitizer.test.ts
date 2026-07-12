import { afterEach, describe, expect, it } from 'vitest';
import type { EdgeBaseConfig } from '@edge-base/shared';
import {
  REDACTED_CONFIG_VALUE,
  sanitizeConfigForBackup,
} from '../lib/config-backup-sanitizer.js';
import { setConfig } from '../lib/do-router.js';
import { backupRoute } from '../routes/backup.js';
import { adminRoute } from '../routes/admin.js';

const ROOT_SERVICE_KEY = 'synthetic-root-service-key';
const SECRET_SENTINELS = [
  'oauth-client-secret-sentinel',
  'email-api-key-sentinel',
  'email-account-sentinel',
  'postgres-password-sentinel',
  'plugin-private-key-sentinel',
  'plugin-generic-key-sentinel',
  ROOT_SERVICE_KEY,
];

function sensitiveConfig(): EdgeBaseConfig {
  return {
    release: true,
    serviceKeys: {
      keys: [{
        kid: 'root',
        tier: 'root',
        scopes: ['*'],
        secretSource: 'inline',
        inlineSecret: ROOT_SERVICE_KEY,
      }],
    },
    auth: {
      oauth: {
        google: {
          clientId: 'public-client-id',
          clientSecret: 'oauth-client-secret-sentinel',
        },
      },
    },
    email: {
      provider: 'resend',
      from: 'noreply@example.com',
      apiKey: 'email-api-key-sentinel',
      accountId: 'email-account-sentinel',
    },
    databases: {
      primary: {
        provider: 'postgres',
        connectionString: 'postgres://user:postgres-password-sentinel@db.example.test/app',
        tables: {
          users: {
            schema: {
              password: { type: 'string', default: 'schema-default-secret' },
              API_KEY: { type: 'string' },
              displayName: { type: 'string' },
            },
          },
        },
      },
    },
    plugins: [{
      name: 'synthetic-plugin',
      config: {
        key: 'plugin-generic-key-sentinel',
        opaque: 'random-provider-secret-sentinel',
        webhookUrl: 'https://hooks.example.test/services/T/B/path-secret-sentinel',
        nested: [{ 'PrIvAtE-k_e.y': 'plugin-private-key-sentinel' }],
      },
    }],
  } as unknown as EdgeBaseConfig;
}

function expectNoSecretSentinel(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  for (const sentinel of SECRET_SENTINELS) expect(serialized).not.toContain(sentinel);
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
      continue;
    }
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

afterEach(() => {
  setConfig({} as EdgeBaseConfig);
});

describe('config backup sanitizer', () => {
  it('redacts normalized nested credential keys and credential-bearing URLs while preserving schema', () => {
    const sanitized = sanitizeConfigForBackup({
      ...sensitiveConfig(),
      bypasses: {
        'C-l_i.e n t S e c r e t': 'case-bypass-sentinel',
        databaseUrl: 'postgres://user:embedded-password@db.example.test/app',
        pluginEndpoint: 'https://plugin.example.test/callback?api_key=query-secret-sentinel',
        webhookPath: 'https://hooks.example.test/services/T/B/path-secret-sentinel',
        fragmentEndpoint: 'https://plugin.example.test/callback#access_token=fragment-secret-sentinel',
        credentials: [{ token: 'nested-token-sentinel' }],
      },
    });

    expect(readPath(sanitized, ['auth', 'oauth', 'google', 'clientId'])).toBe('public-client-id');
    expect(readPath(sanitized, ['auth', 'oauth', 'google', 'clientSecret']))
      .toBe(REDACTED_CONFIG_VALUE);
    expect(readPath(sanitized, ['databases', 'primary', 'provider'])).toBe('postgres');
    expect(readPath(sanitized, ['databases', 'primary', 'connectionString']))
      .toBe(REDACTED_CONFIG_VALUE);
    expect(readPath(sanitized, ['databases', 'primary', 'tables', 'users', 'schema', 'password', 'type']))
      .toBe('string');
    expect(readPath(sanitized, ['databases', 'primary', 'tables', 'users', 'schema', 'password', 'default']))
      .toBe(REDACTED_CONFIG_VALUE);
    expect(readPath(sanitized, ['databases', 'primary', 'tables', 'users', 'schema', 'API_KEY', 'type']))
      .toBe('string');
    expect(readPath(sanitized, ['bypasses', 'C-l_i.e n t S e c r e t']))
      .toBe(REDACTED_CONFIG_VALUE);
    expect(readPath(sanitized, ['bypasses', 'databaseUrl'])).toBe(REDACTED_CONFIG_VALUE);
    expect(readPath(sanitized, ['bypasses', 'pluginEndpoint'])).toBe(REDACTED_CONFIG_VALUE);
    expect(readPath(sanitized, ['bypasses', 'webhookPath'])).toBe(REDACTED_CONFIG_VALUE);
    expect(readPath(sanitized, ['bypasses', 'fragmentEndpoint'])).toBe(REDACTED_CONFIG_VALUE);
    expect(readPath(sanitized, ['bypasses', 'credentials'])).toBe(REDACTED_CONFIG_VALUE);
    expect(readPath(sanitized, ['plugins', '0', 'config'])).toBe(REDACTED_CONFIG_VALUE);
    expectNoSecretSentinel(sanitized);
    expect(JSON.stringify(sanitized)).not.toContain('case-bypass-sentinel');
    expect(JSON.stringify(sanitized)).not.toContain('embedded-password');
    expect(JSON.stringify(sanitized)).not.toContain('query-secret-sentinel');
    expect(JSON.stringify(sanitized)).not.toContain('fragment-secret-sentinel');
    expect(JSON.stringify(sanitized)).not.toContain('random-provider-secret-sentinel');
    expect(JSON.stringify(sanitized)).not.toContain('path-secret-sentinel');
  });

  it('sanitizes the Service-Key protected backup config route', async () => {
    setConfig(sensitiveConfig());
    const response = await backupRoute.fetch(
      new Request('https://api.example.test/config', {
        headers: { 'X-EdgeBase-Service-Key': ROOT_SERVICE_KEY },
      }),
      {} as never,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(readPath(payload, ['databases', 'primary', 'tables', 'users', 'schema', 'displayName', 'type']))
      .toBe('string');
    expect(readPath(payload, ['auth', 'oauth', 'google', 'clientSecret']))
      .toBe(REDACTED_CONFIG_VALUE);
    expectNoSecretSentinel(payload);
  });

  it('sanitizes the admin-session/Service-Key backup config route', async () => {
    setConfig(sensitiveConfig());
    const response = await adminRoute.fetch(
      new Request('https://api.example.test/data/backup/config', {
        headers: { 'X-EdgeBase-Service-Key': ROOT_SERVICE_KEY },
      }),
      {} as never,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(readPath(payload, ['databases', 'primary', 'tables', 'users', 'schema', 'displayName', 'type']))
      .toBe('string');
    expect(readPath(payload, ['email', 'apiKey'])).toBe(REDACTED_CONFIG_VALUE);
    expectNoSecretSentinel(payload);
  });
});
