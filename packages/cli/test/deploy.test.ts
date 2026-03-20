/**
 * Tests for CLI deploy command — validateConfig, scanFunctions, generateFunctionRegistry, mergePluginTables, extractDatabases.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateConfig, _internals } from '../src/commands/deploy.js';
import { resolveRateLimitBindings } from '../src/lib/rate-limit-bindings.js';

const {
  scanFunctions,
  generateFunctionRegistry,
  mergePluginTables,
  extractDatabases,
  inspectAuthEnv,
  collectAuthEnvWarnings,
  copyDevelopmentAuthProviderToRelease,
  isPostgresProvider,
  isHyperdriveAlreadyExistsError,
  parseHyperdriveListOutput,
  resolveAdminUrlFromRuntime,
  resolveReleaseSecretVars,
  resolveExistingR2BucketRecord,
} = _internals;

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-deploy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. validateConfig — Edge cases
// ======================================================================

describe('validateConfig — Edge cases', () => {
  it('empty tables object', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        databases: { shared: { tables: {} } },
      },
      warnings,
      errors,
    );
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('config without tables key', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
      },
      warnings,
      errors,
    );
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('does not warn for non-view tables with write rules', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        databases: {
          shared: {
            tables: {
              posts: {
                access: { insert: 'true', update: 'true', delete: 'true' },
              },
            },
          },
        },
      },
      warnings,
      errors,
    );

    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

describe('provider classification', () => {
  it('treats only neon/postgres as Hyperdrive-backed providers', () => {
    expect(isPostgresProvider('neon')).toBe(true);
    expect(isPostgresProvider('postgres')).toBe(true);
    expect(isPostgresProvider('d1')).toBe(false);
    expect(isPostgresProvider('do')).toBe(false);
    expect(isPostgresProvider(undefined)).toBe(false);
  });

  it('recognizes wrangler hyperdrive create idempotency errors', () => {
    expect(
      isHyperdriveAlreadyExistsError(
        'A Hyperdrive config with the given name already exists [code: 2017]',
      ),
    ).toBe(true);
    expect(isHyperdriveAlreadyExistsError('network timeout')).toBe(false);
  });

  it('parses wrangler hyperdrive list table output', () => {
    const output = `
┌────┬────┐
│ id                               │ name                │
├────┼────┤
│ 9def174e0c9c444685b8c773d076ce4b │ edgebase-db-shared  │
│ 0ee0b621f3ab4b9dae1734f95c27ef8a │ edgebase-auth       │
└────┴────┘
`;

    expect(parseHyperdriveListOutput(output)).toEqual([
      { id: '9def174e0c9c444685b8c773d076ce4b', name: 'edgebase-db-shared' },
      { id: '0ee0b621f3ab4b9dae1734f95c27ef8a', name: 'edgebase-auth' },
    ]);
  });
});

describe('resolveExistingR2BucketRecord', () => {
  it('normalizes stale existing buckets back to unmanaged ownership', () => {
    expect(
      resolveExistingR2BucketRecord({
        type: 'r2_bucket',
        name: 'edgebase-storage',
        binding: 'STORAGE',
        id: 'edgebase-storage',
        managed: true,
        source: 'existing',
      }),
    ).toEqual({
      managed: false,
      source: 'existing',
    });
  });

  it('preserves ownership for buckets the suite originally created', () => {
    expect(
      resolveExistingR2BucketRecord({
        type: 'r2_bucket',
        name: 'suite-storage',
        binding: 'STORAGE',
        id: 'suite-storage',
        managed: true,
        source: 'created',
      }),
    ).toEqual({
      managed: true,
      source: 'created',
    });
  });
});

describe('resolveAdminUrlFromRuntime', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns null when runtime reports no admin dashboard', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ name: 'EdgeBase API', docs: '/openapi.json', admin: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    await expect(resolveAdminUrlFromRuntime('https://example.workers.dev')).resolves.toBeNull();
  });

  it('resolves relative admin URL from runtime payload', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ admin: '/admin' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    await expect(resolveAdminUrlFromRuntime('https://example.workers.dev')).resolves.toBe(
      'https://example.workers.dev/admin',
    );
  });

  it('uses redirect location when runtime sends one', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: {
          location: 'https://admin.example.com',
        },
      })) as typeof fetch;

    await expect(resolveAdminUrlFromRuntime('https://example.workers.dev')).resolves.toBe(
      'https://admin.example.com/',
    );
  });
});

describe('resolveReleaseSecretVars', () => {
  it('prefers explicit shell env over .env.release values for matching keys', () => {
    const envPath = join(tmpDir, '.env.release');
    writeFileSync(envPath, [
      'MOCK_SERVER_URL=https://old-tunnel.example.com',
      'EDGEBASE_EMAIL_API_URL=https://old-tunnel.example.com/email',
      'UNCHANGED=value-from-file',
    ].join('\n'));

    const previousMock = process.env.MOCK_SERVER_URL;
    const previousEmail = process.env.EDGEBASE_EMAIL_API_URL;
    process.env.MOCK_SERVER_URL = 'https://new-tunnel.example.com';
    process.env.EDGEBASE_EMAIL_API_URL = 'https://new-tunnel.example.com/email';

    try {
      expect(resolveReleaseSecretVars(tmpDir)).toEqual({
        MOCK_SERVER_URL: 'https://new-tunnel.example.com',
        EDGEBASE_EMAIL_API_URL: 'https://new-tunnel.example.com/email',
        UNCHANGED: 'value-from-file',
      });
    } finally {
      if (previousMock === undefined) delete process.env.MOCK_SERVER_URL;
      else process.env.MOCK_SERVER_URL = previousMock;
      if (previousEmail === undefined) delete process.env.EDGEBASE_EMAIL_API_URL;
      else process.env.EDGEBASE_EMAIL_API_URL = previousEmail;
    }
  });
});

describe('collectAuthEnvWarnings', () => {
  it('warns when a provider is enabled only in development', () => {
    writeFileSync(join(tmpDir, '.env.development'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google,discord',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=gid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=gsecret',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_ID=did',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_SECRET=dsecret',
      '',
    ].join('\n'));
    writeFileSync(join(tmpDir, '.env.release'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=rgid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=rgsecret',
      '',
    ].join('\n'));

    expect(collectAuthEnvWarnings(tmpDir)).toEqual(expect.arrayContaining([
      expect.stringContaining('OAuth provider(s) enabled in Development but not Release: discord'),
    ]));
  });

  it('warns when a release-enabled provider is missing required secrets', () => {
    writeFileSync(join(tmpDir, '.env.release'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google,discord,oidc:custom',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=rgid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=rgsecret',
      'EDGEBASE_OIDC_CUSTOM_CLIENT_ID=oidc-id',
      'EDGEBASE_OIDC_CUSTOM_CLIENT_SECRET=oidc-secret',
      '',
    ].join('\n'));

    expect(collectAuthEnvWarnings(tmpDir)).toEqual(expect.arrayContaining([
      expect.stringContaining(
        'Release OAuth provider(s) are enabled but missing required secrets in .env.release: discord (clientId, clientSecret); oidc:custom (issuer).',
      ),
    ]));
  });
});

describe('auth release sync helpers', () => {
  it('inspects provider mismatches and marks copyable ones', () => {
    writeFileSync(join(tmpDir, '.env.development'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google,discord',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=gid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=gsecret',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_ID=did',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_SECRET=dsecret',
      '',
    ].join('\n'));
    writeFileSync(join(tmpDir, '.env.release'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=rgid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=rgsecret',
      '',
    ].join('\n'));

    expect(inspectAuthEnv(tmpDir)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'discord',
        devEnabled: true,
        releaseEnabled: false,
        canCopyToRelease: true,
      }),
    ]));
  });

  it('copies a development-only provider into .env.release without overwriting existing release values', () => {
    writeFileSync(join(tmpDir, '.env.development'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=discord',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_ID=did',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_SECRET=dsecret',
      '',
    ].join('\n'));
    writeFileSync(join(tmpDir, '.env.release'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_ID=release-did',
      '',
    ].join('\n'));

    const discordInspection = inspectAuthEnv(tmpDir).find((entry) => entry.provider === 'discord');
    expect(discordInspection).toBeTruthy();

    const result = copyDevelopmentAuthProviderToRelease(tmpDir, discordInspection!);
    expect(result).toEqual({
      enabledInRelease: true,
      copiedFields: ['clientSecret'],
    });

    const releaseEnv = readFileSync(join(tmpDir, '.env.release'), 'utf-8');
    expect(releaseEnv).toContain('EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=discord');
    expect(releaseEnv).toContain('EDGEBASE_OAUTH_DISCORD_CLIENT_ID=release-did');
    expect(releaseEnv).toContain('EDGEBASE_OAUTH_DISCORD_CLIENT_SECRET=dsecret');
  });
});

// ======================================================================
// 2. validateConfig — Inline Service Key warning
// ======================================================================

describe('validateConfig — Inline Service Key warning', () => {
  it('warns when config has inline secretSource keys', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'local-dev',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'inline',
              inlineSecret: 'sk_test',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('local-dev');
    expect(warnings[0]).toContain("secretSource: 'inline'");
    expect(warnings[0]).toContain('dashboard');
    expect(errors).toHaveLength(0);
  });

  it('no warning when all keys use dashboard secretSource', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'prod-key',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_PROD',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('warns for multiple inline keys — lists all kids', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'dev1',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'inline',
              inlineSecret: 'sk1',
            },
            {
              kid: 'prod',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SK_PROD',
            },
            {
              kid: 'dev2',
              tier: 'scoped',
              scopes: ['kv:*'],
              secretSource: 'inline',
              inlineSecret: 'sk2',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('dev1');
    expect(warnings[0]).toContain('dev2');
    // 'prod' key should not be listed (it uses 'dashboard')
    // Note: we check for the kid format '[dev1, dev2]' to avoid matching 'production' in the message
    expect(warnings[0]).toMatch(/\[dev1, dev2\]/);
    expect(warnings[0]).not.toMatch(/\bprod\b/);
  });

  it('no warning when serviceKeys is absent', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
      },
      warnings,
      errors,
    );

    expect(warnings).toHaveLength(0);
  });

  it('no warning when serviceKeys.keys is empty', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: { keys: [] },
      },
      warnings,
      errors,
    );

    expect(warnings).toHaveLength(0);
  });

  it('errors when a service key kid contains underscores', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'local_dev',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_LOCAL',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('local_dev');
    expect(errors[0]).toContain('Underscore is reserved');
  });

  it('errors when service key kids are duplicated', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'backend',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_BACKEND',
            },
            {
              kid: 'backend',
              tier: 'scoped',
              scopes: ['db:table:posts:read'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_ANALYTICS',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Duplicate Service Key kid 'backend'");
  });

  it('errors when dashboard keys omit secretRef', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'backend',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('requires a non-empty secretRef');
  });

  it('warns when every root-tier key is request-scoped', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'tenant-root',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_TENANT',
              constraints: { tenant: 'workspace-123' },
            },
            {
              kid: 'ip-root',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_IP',
              constraints: { ipCidr: ['10.0.0.0/8'] },
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(errors).toHaveLength(0);
    expect(warnings.some((warning) => warning.includes('All root-tier Service Keys are request-scoped'))).toBe(true);
  });
});

// ======================================================================
// 3. scanFunctions
// ======================================================================

describe('scanFunctions', () => {
  it('finds .ts files in flat directory', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, 'onUserCreated.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'onPostPublished.ts'), 'export default {}');

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name).sort()).toEqual(['onPostPublished', 'onUserCreated']);
  });

  it('finds .ts files in nested directories', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, 'auth'), { recursive: true });
    writeFileSync(join(functionsDir, 'auth', 'onLogin.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'setup.ts'), 'export default {}');

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.name === 'auth/onLogin')?.relativePath).toBe('auth/onLogin.ts');
  });

  it('skips files starting with underscore', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, '_helper.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'onEvent.ts'), 'export default {}');

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('onEvent');
  });

  it('skips non-.ts files', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, 'readme.md'), '# README');
    writeFileSync(join(functionsDir, 'config.json'), '{}');
    writeFileSync(join(functionsDir, 'onEvent.ts'), 'export default {}');

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(1);
  });

  it('returns empty array for empty directory', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(0);
  });

  it('uses forward slashes in relative paths (cross-platform)', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, 'deep', 'nested'), { recursive: true });
    writeFileSync(join(functionsDir, 'deep', 'nested', 'handler.ts'), 'export default {}');

    const results = scanFunctions(functionsDir);
    expect(results[0].relativePath).toBe('deep/nested/handler.ts');
    expect(results[0].relativePath).not.toContain('\\');
  });
});

// ======================================================================
// 4. generateFunctionRegistry
// ======================================================================

describe('generateFunctionRegistry', () => {
  it('generates registry file with imports and registrations', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const functions = [
      {
        name: 'onUserCreated',
        relativePath: 'onUserCreated.ts',
        methods: [],
        hasDefaultExport: true,
        isMiddleware: false,
      },
      {
        name: 'onPostPublished',
        relativePath: 'onPostPublished.ts',
        methods: [],
        hasDefaultExport: true,
        isMiddleware: false,
      },
    ];

    generateFunctionRegistry(functions, outputPath);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, 'utf-8');

    expect(content).toContain('Auto-generated function registry');
    expect(content).toMatch(
      /import onUserCreated_module from '\.\.\/(?:\.\.\/)*functions\/onUserCreated\.ts'/,
    );
    expect(content).toMatch(
      /import onPostPublished_module from '\.\.\/(?:\.\.\/)*functions\/onPostPublished\.ts'/,
    );
    expect(content).toContain("registerFunction('onUserCreated', wrapMethodExport(onUserCreated_module, '*'));");
    expect(content).toContain("registerFunction('onPostPublished', wrapMethodExport(onPostPublished_module, '*'));");
    expect(content).toContain("import { parseConfig } from './lib/do-router.js'");
    expect(content).toContain('const keepBundled = [config, registerMiddleware, RoomsDO];');
    expect(content).toContain('const resolvedConfig = parseConfig();');
    expect(content).toContain('export function initFunctionRegistry()');
  });

  it('generates empty registry for no functions', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    generateFunctionRegistry([], outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('initFunctionRegistry');
    // No user function imports — only plugin registration boilerplate
    expect(content).not.toMatch(/from '\.\.\/(?:\.\.\/)*functions\//);
  });

  it('wires module-level trigger metadata for method exports', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const functions = [
      {
        name: 'custom-alias',
        relativePath: 'custom-alias.ts',
        methods: ['GET'],
        hasDefaultExport: false,
        hasTriggerExport: true,
        isMiddleware: false,
      },
    ];

    generateFunctionRegistry(functions, outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toMatch(
      /import \* as custom_alias_module from '\.\.\/(?:\.\.\/)*functions\/custom-alias\.ts'/,
    );
    expect(content).toContain(
      "registerFunction('custom-alias', wrapMethodExport(custom_alias_module.GET, 'GET', custom_alias_module.trigger));",
    );
  });

  it('does not reference module.trigger when a file has no trigger export', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const functions = [
      {
        name: 'echo',
        relativePath: 'echo.ts',
        methods: ['GET'],
        hasDefaultExport: false,
        hasTriggerExport: false,
        isMiddleware: false,
      },
    ];

    generateFunctionRegistry(functions, outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain("registerFunction('echo', wrapMethodExport(echo_module.GET, 'GET'));");
    expect(content).not.toContain("echo_module.trigger");
  });

  it('handles nested function paths', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const functions = [
      {
        name: 'auth/onLogin',
        relativePath: 'auth/onLogin.ts',
        methods: [],
        hasDefaultExport: true,
        isMiddleware: false,
      },
    ];

    generateFunctionRegistry(functions, outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toMatch(
      /import auth_onLogin_module from '\.\.\/(?:\.\.\/)*functions\/auth\/onLogin\.ts'/,
    );
  });

  it('sanitizes function names with special characters', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const functions = [
      {
        name: 'on-user-created',
        relativePath: 'on-user-created.ts',
        methods: [],
        hasDefaultExport: true,
        isMiddleware: false,
      },
    ];

    generateFunctionRegistry(functions, outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('import on_user_created_module');
    expect(content).toContain("registerFunction('on-user-created'");
  });

  it('creates output directory if it does not exist', () => {
    const outputPath = join(tmpDir, 'deep', 'nested', 'src', '_functions-registry.ts');

    generateFunctionRegistry([], outputPath);

    expect(existsSync(outputPath)).toBe(true);
  });

  it('emits blocking storage hook events in the storage trigger set', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    generateFunctionRegistry([], outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain("'beforeUpload'");
    expect(content).toContain("'beforeDownload'");
    expect(content).toContain("'beforeDelete'");
  });

  it('supports runtime-scaffold config imports for deploy/dev registries', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    generateFunctionRegistry([], outputPath, { configImportPath: './generated-config.js' });

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain("import config from './generated-config.js'");
  });
});

// ======================================================================
// 5. mergePluginTables (Explicit Import Pattern)
// ======================================================================

describe('mergePluginTables', () => {
  it('merges plugin tables into shared db block by default', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: { posts: { schema: {} } } },
    };
    const plugins = [
      {
        name: 'plugin-stripe',
        config: {},
        tables: { customers: { schema: { userId: { type: 'string' } } } },
      },
    ];

    mergePluginTables(databases, plugins as any);

    expect(databases.shared.tables).toHaveProperty('plugin-stripe/customers');
    expect(databases.shared.tables!['plugin-stripe/customers']).toEqual({
      schema: { userId: { type: 'string' } },
    });
    // Original tables preserved
    expect(databases.shared.tables).toHaveProperty('posts');
  });

  it('uses custom dbBlock when specified', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: {} },
    };
    const plugins = [
      {
        name: 'plugin-analytics',
        config: {},
        dbBlock: 'analytics',
        tables: { events: { schema: {} } },
      },
    ];

    mergePluginTables(databases, plugins as any);

    expect(databases).toHaveProperty('analytics');
    expect(databases.analytics.tables).toHaveProperty('plugin-analytics/events');
    // shared untouched
    expect(Object.keys(databases.shared.tables!)).toHaveLength(0);
  });

  it('creates db block if it does not exist', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {};
    const plugins = [{ name: 'plugin-cache', config: {}, tables: { entries: { schema: {} } } }];

    mergePluginTables(databases, plugins as any);

    expect(databases).toHaveProperty('shared');
    expect(databases.shared.tables).toHaveProperty('plugin-cache/entries');
  });

  it('handles multiple plugins', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: {} },
    };
    const plugins = [
      {
        name: 'plugin-stripe',
        config: {},
        tables: { customers: { schema: {} }, subscriptions: { schema: {} } },
      },
      { name: 'plugin-analytics', config: {}, tables: { events: { schema: {} } } },
    ];

    mergePluginTables(databases, plugins as any);

    expect(databases.shared.tables).toHaveProperty('plugin-stripe/customers');
    expect(databases.shared.tables).toHaveProperty('plugin-stripe/subscriptions');
    expect(databases.shared.tables).toHaveProperty('plugin-analytics/events');
  });

  it('does nothing for plugins without tables', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: { posts: {} } },
    };
    const plugins = [{ name: 'plugin-no-tables', config: {} }];

    mergePluginTables(databases, plugins as any);

    expect(Object.keys(databases.shared.tables!)).toEqual(['posts']);
  });

  it('does nothing for empty plugins array', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: { posts: {} } },
    };

    mergePluginTables(databases, []);

    expect(Object.keys(databases.shared.tables!)).toEqual(['posts']);
  });

  it('extractDatabases includes plugin tables even when only plugins define them', () => {
    const databases = extractDatabases({
      plugins: [
        {
          name: 'plugin-analytics',
          pluginApiVersion: 1,
          config: {},
          tables: {
            events: {
              access: { read: 'true' },
              handlers: { hooks: { beforeInsert: 'return data;' } },
            },
          },
        },
      ],
    });

    expect(databases.shared.tables).toHaveProperty('plugin-analytics/events');
    expect(databases.shared.tables!['plugin-analytics/events']).toMatchObject({
      access: { read: 'true' },
      handlers: { hooks: { beforeInsert: 'return data;' } },
    });
  });
});

// ======================================================================
// 6. generateTempWranglerToml
// ======================================================================

const {
  generateTempWranglerToml,
  collectManagedCronSchedules,
  buildMergedKvConfig,
  buildMergedD1Config,
  parseWranglerJsonOutput,
  dedupeManifestResources,
} = _internals;

describe('generateTempWranglerToml', () => {
  it('injects EdgeBase assets when no assets block is present', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, { bindings: [] });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[assets]');
    expect(content).toContain('directory = ".edgebase/runtime/server/admin-build"');
    expect(content).toContain('binding = "ASSETS"');
    expect(content).toContain('run_worker_first = true');

    rmSync(result!);
  });

  it('leaves unrelated custom assets blocks untouched when no other changes are needed', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[assets]',
        'directory = "./public"',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, { bindings: [] });

    expect(result).toBeNull();
  });

  it('forces worker-first routing for EdgeBase assets blocks even without extra bindings', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[assets]',
        'directory = ".edgebase/runtime/server/admin-build"',
        'binding = "ASSETS"',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, { bindings: [] });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[assets]');
    expect(content).toContain('run_worker_first = true');

    rmSync(result!);
  });

  it('rewrites disabled worker-first routing for EdgeBase assets blocks', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[assets]',
        'directory = ".edgebase/runtime/server/admin-build"',
        'binding = "ASSETS"',
        'run_worker_first = false',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, { bindings: [] });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('run_worker_first = true');
    expect(content).not.toContain('run_worker_first = false');

    rmSync(result!);
  });

  it('generates temp toml with KV binding', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'abc123' },
      ],
    });

    expect(result).not.toBeNull();
    expect(result).toContain(join(tmpDir, '.wrangler.generated.'));
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('name = "my-worker"');
    expect(content).toContain('[[kv_namespaces]]');
    expect(content).toContain('binding = "CACHE_KV"');
    expect(content).toContain('id = "abc123"');

    // Clean up
    rmSync(result!);
  });

  it('generates temp toml with D1 binding', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'd1_database', name: 'analytics', binding: 'ANALYTICS_DB', id: 'db-uuid-123' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[[d1_databases]]');
    expect(content).toContain('binding = "ANALYTICS_DB"');
    expect(content).toContain('database_name = "my-worker-analytics"');
    expect(content).toContain('database_id = "db-uuid-123"');

    rmSync(result!);
  });

  it('generates temp toml with Vectorize binding', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        {
          type: 'vectorize',
          name: 'embeddings',
          binding: 'VECTORIZE_EMBEDDINGS',
          id: 'edgebase-embeddings',
        },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[[vectorize]]');
    expect(content).toContain('binding = "VECTORIZE_EMBEDDINGS"');
    expect(content).toContain('index_name = "edgebase-embeddings"');

    rmSync(result!);
  });

  it('generates temp toml with mixed KV + D1 + Vectorize bindings', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'kv-id' },
        { type: 'd1_database', name: 'analytics', binding: 'ANALYTICS_DB', id: 'db-id' },
        { type: 'vectorize', name: 'embeddings', binding: 'VEC_EMB', id: 'edgebase-embeddings' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[[kv_namespaces]]');
    expect(content).toContain('[[d1_databases]]');
    expect(content).toContain('[[vectorize]]');
    // All three bindings present
    expect(content).toContain('binding = "CACHE_KV"');
    expect(content).toContain('binding = "ANALYTICS_DB"');
    expect(content).toContain('binding = "VEC_EMB"');

    rmSync(result!);
  });

  it('replaces existing KV bindings when the same binding is reprovisioned', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[[kv_namespaces]]',
        'binding = "CACHE_KV"',
        'id = "existing-id"',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'new-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('binding = "CACHE_KV"');
    expect(content).toContain('id = "new-id"');
    expect(content).not.toContain('id = "existing-id"');

    rmSync(result!);
  });

  it('replaces existing D1 bindings when the same binding is reprovisioned', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[[d1_databases]]',
        'binding = "AUTH_DB"',
        'database_name = "edgebase-auth"',
        'database_id = "local"',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'd1_database', name: 'auth', binding: 'AUTH_DB', id: 'cloud-auth-id' },
        { type: 'd1_database', name: 'control', binding: 'CONTROL_DB', id: 'cloud-control-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('database_id = "cloud-auth-id"');
    expect(content).toContain('binding = "CONTROL_DB"');
    expect(content).not.toContain('database_id = "local"');

    rmSync(result!);
  });

  it('preserves original wrangler.toml content', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    const original = [
      'name = "edgebase-worker"',
      'compatibility_date = "2024-01-01"',
      '',
      '[[kv_namespaces]]',
      'binding = "KV"',
      'id = "internal-kv-id"',
    ].join('\n');
    writeFileSync(wranglerPath, original);

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'USER_CACHE', id: 'user-cache-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    // Original content preserved at the top
    expect(content).toContain('name = "edgebase-worker"');
    expect(content).toContain('binding = "KV"');
    expect(content).toContain('id = "internal-kv-id"');
    // New binding appended
    expect(content).toContain('binding = "USER_CACHE"');
    expect(content).toContain('id = "user-cache-id"');
    // Auto-provisioned comment
    expect(content).toContain('Auto-provisioned bindings');

    rmSync(result!);
  });

  it('handles multiple KV bindings', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'cache-id' },
        { type: 'kv_namespace', name: 'sessions', binding: 'SESSIONS_KV', id: 'sessions-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    // Both KV namespaces present
    const kvCount = (content.match(/\[\[kv_namespaces\]\]/g) || []).length;
    expect(kvCount).toBe(2);
    expect(content).toContain('binding = "CACHE_KV"');
    expect(content).toContain('binding = "SESSIONS_KV"');

    rmSync(result!);
  });

  it('handles multiple D1 databases', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'd1_database', name: 'analytics', binding: 'ANALYTICS_DB', id: 'db1' },
        { type: 'd1_database', name: 'logs', binding: 'LOGS_DB', id: 'db2' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    const d1Count = (content.match(/\[\[d1_databases\]\]/g) || []).length;
    expect(d1Count).toBe(2);
    expect(content).toContain('database_name = "my-worker-analytics"');
    expect(content).toContain('database_name = "my-worker-logs"');

    rmSync(result!);
  });

  it('generates temp toml with rate-limit bindings only', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [],
      rateLimitBindings: [
        { binding: 'DB_RATE_LIMITER', namespaceId: '2002', limit: 250, period: 60 },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[[unsafe.bindings]]');
    expect(content).toContain('name = "DB_RATE_LIMITER"');
    expect(content).toContain('namespace_id = "2002"');
    expect(content).toContain('simple = { limit = 250, period = 60 }');

    rmSync(result!);
  });

  it('replaces existing built-in rate-limit bindings with generated values', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[[unsafe.bindings]]',
        'name = "DB_RATE_LIMITER"',
        'type = "ratelimit"',
        'namespace_id = "1002"',
        'simple = { limit = 10000000, period = 60 }',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [],
      rateLimitBindings: [
        { binding: 'DB_RATE_LIMITER', namespaceId: '9999', limit: 25, period: 10 },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('namespace_id = "9999"');
    expect(content).toContain('simple = { limit = 25, period = 10 }');
    expect(content).not.toContain('simple = { limit = 10000000, period = 60 }');

    rmSync(result!);
  });

  it('replaces existing triggers with the generated cron schedules', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[triggers]',
        'crons = ["0 * * * *"]',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [],
      triggerMode: 'replace',
      managedCrons: ['*/5 * * * *'],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('crons = ["*/5 * * * *"]');
    expect(content).not.toContain('crons = ["0 * * * *"]');

    rmSync(result!);
  });

  it('preserves existing triggers by default when only bindings are appended', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[triggers]',
        'crons = ["0 * * * *"]',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'cache-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('crons = ["0 * * * *"]');
    expect(content).toContain('binding = "CACHE_KV"');

    rmSync(result!);
  });

  it('rewrites triggers only when explicitly replacing the managed cron set', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[triggers]',
        'crons = ["0 * * * *"]',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [],
      triggerMode: 'replace',
      managedCrons: [],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[triggers]');
    expect(content).toContain('crons = []');
    expect(content).not.toContain('crons = ["0 * * * *"]');

    rmSync(result!);
  });

  it('dedupes duplicate KV bindings by binding name', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'lab', binding: 'KV', id: 'kv-id' },
        { type: 'kv_namespace', name: 'test', binding: 'KV', id: 'kv-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect((content.match(/\[\[kv_namespaces\]\]/g) || []).length).toBe(1);

    rmSync(result!);
  });

  it('dedupes duplicate D1 bindings by binding name', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'd1_database', name: 'analytics', binding: 'DB_D1_SHARED', id: 'db-id' },
        { type: 'd1_database', name: 'test', binding: 'DB_D1_SHARED', id: 'db-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect((content.match(/\[\[d1_databases\]\]/g) || []).length).toBe(1);

    rmSync(result!);
  });
});

describe('collectManagedCronSchedules', () => {
  it('combines schedule triggers, cloudflare.extraCrons, and the system cron without duplicates', () => {
    const crons = collectManagedCronSchedules({
      functions: {
        nightly: { trigger: { type: 'schedule', cron: '0 2 * * *' } },
        duplicate: { trigger: { type: 'schedule', cron: '0 2 * * *' } },
        httpHandler: { trigger: { type: 'http' } },
      },
      cloudflare: {
        extraCrons: ['15 * * * *', '0 2 * * *', '15 * * * *'],
      },
    });

    expect(crons).toEqual(['0 2 * * *', '15 * * * *', '0 3 * * *']);
  });

  it('returns the system cron when no config-defined schedules exist', () => {
    expect(collectManagedCronSchedules(undefined)).toEqual(['0 3 * * *']);
  });
});

describe('dedupeManifestResources', () => {
  it('keeps only the latest logical resource for the same binding', () => {
    const resources = dedupeManifestResources([
      { type: 'd1_database', name: 'db-shared', binding: 'DB_D1_SHARED', id: 'stale-id' },
      { type: 'd1_database', name: 'db-shared', binding: 'DB_D1_SHARED', id: 'fresh-id' },
    ]);

    expect(resources).toEqual([
      { type: 'd1_database', name: 'db-shared', binding: 'DB_D1_SHARED', id: 'fresh-id' },
    ]);
  });
});

describe('buildMergedD1Config', () => {
  it('prefers internal and single-instance bindings over duplicate explicit d1 bindings', () => {
    const merged = buildMergedD1Config(
      {
        analytics: { binding: 'DB_D1_SHARED' },
        test: { binding: 'DB_D1_SHARED' },
      },
      {
        shared: {},
      },
    );

    expect(merged).toHaveProperty('auth');
    expect(merged).toHaveProperty('control');
    expect(merged).toHaveProperty('db-shared');
    expect(merged['db-shared']).toEqual({ binding: 'DB_D1_SHARED' });
    expect(merged).not.toHaveProperty('analytics');
    expect(merged).not.toHaveProperty('test');
  });
});

describe('buildMergedKvConfig', () => {
  it('always includes the internal KV binding and dedupes explicit duplicates', () => {
    const merged = buildMergedKvConfig({
      cache: { binding: 'CACHE_KV' },
      duplicateInternal: { binding: 'KV' },
      duplicateCache: { binding: 'CACHE_KV' },
    });

    expect(merged).toHaveProperty('internal');
    expect(merged.internal).toEqual({ binding: 'KV' });
    expect(merged).toHaveProperty('cache');
    expect(merged.cache).toEqual({ binding: 'CACHE_KV' });
    expect(merged).not.toHaveProperty('duplicateInternal');
    expect(merged).not.toHaveProperty('duplicateCache');
  });
});

describe('parseWranglerJsonOutput', () => {
  it('parses pure JSON output', () => {
    expect(parseWranglerJsonOutput('[{"name":"edgebase-embeddings"}]')).toEqual([
      { name: 'edgebase-embeddings' },
    ]);
  });

  it('parses JSON output with Wrangler banner lines before the payload', () => {
    const output = [
      '📋 Listing Vectorize indexes...',
      '[{"name":"edgebase-embeddings","config":{"dimensions":1536}}]',
    ].join('\n');

    expect(parseWranglerJsonOutput(output)).toEqual([
      { name: 'edgebase-embeddings', config: { dimensions: 1536 } },
    ]);
  });
});

describe('resolveRateLimitBindings', () => {
  it('returns built-in defaults when config is absent', () => {
    const bindings = resolveRateLimitBindings();
    expect(bindings).toHaveLength(8);
    expect(bindings.find((binding) => binding.group === 'db')).toMatchObject({
      binding: 'DB_RATE_LIMITER',
      namespaceId: '1002',
      limit: 10000000,
      period: 60,
    });
  });

  it('applies binding overrides from config', () => {
    const bindings = resolveRateLimitBindings({
      rateLimiting: {
        db: {
          requests: 100,
          window: '60s',
          binding: {
            limit: 250,
            period: 10,
            namespaceId: '4242',
          },
        },
      },
    });

    expect(bindings.find((binding) => binding.group === 'db')).toMatchObject({
      namespaceId: '4242',
      limit: 250,
      period: 10,
    });
  });

  it('omits bindings that are explicitly disabled', () => {
    const bindings = resolveRateLimitBindings({
      rateLimiting: {
        authSignin: {
          requests: 10,
          window: '60s',
          binding: {
            enabled: false,
          },
        },
      },
    });

    expect(bindings.find((binding) => binding.group === 'authSignin')).toBeUndefined();
    expect(bindings.find((binding) => binding.group === 'db')).toBeDefined();
  });
});
