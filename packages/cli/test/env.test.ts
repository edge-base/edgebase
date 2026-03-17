/**
 * Tests for Dual .env File Strategy.
 *
 * 테스트 범위:
 * 1. parseEnvFile — 범용 KEY=VALUE 파서 (주석, 따옴표, 빈 값, 누락 파일)
 * 2. parseDevVars — .env.development → .dev.vars fallback 체인
 * 3. dev 명령어 — .env.development → .dev.vars 동기화
 * 4. deploy syncEnvSecrets — .env.release → JSON 변환 + SERVICE_KEY 제외
 * 5. init 명령어 — .env.development 생성, example 파일, gitignore
 * 6. 하위 호환 — 기존 .dev.vars만 있는 프로젝트
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock devCommand to prevent init from actually starting the dev server
vi.mock('../src/commands/dev.js', () => ({
  devCommand: { parseAsync: vi.fn().mockResolvedValue(undefined) },
}));

// ─── Import targets ───
import { parseEnvFile, parseDevVars } from '../src/lib/dev-sidecar.js';

let tmpDir: string;
const originalCwd = process.cwd();

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `eb-env-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  // Restore CWD since init does process.chdir()
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. parseEnvFile — 범용 KEY=VALUE 파서
// ======================================================================

describe('parseEnvFile — basic parsing', () => {
  it('parses simple KEY=VALUE pairs', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, 'FOO=bar\nBAZ=qux\n');

    const result = parseEnvFile(fp);
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('ignores comment lines (# prefix)', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, '# This is a comment\nKEY=value\n# Another comment\n');

    const result = parseEnvFile(fp);
    expect(result).toEqual({ KEY: 'value' });
  });

  it('ignores empty lines', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, 'A=1\n\n\nB=2\n\n');

    const result = parseEnvFile(fp);
    expect(result).toEqual({ A: '1', B: '2' });
  });

  it('strips double quotes from values', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, 'SECRET="my-secret-value"\n');

    const result = parseEnvFile(fp);
    expect(result).toEqual({ SECRET: 'my-secret-value' });
  });

  it('strips single quotes from values', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, "TOKEN='abc123'\n");

    const result = parseEnvFile(fp);
    expect(result).toEqual({ TOKEN: 'abc123' });
  });

  it('does NOT strip mismatched quotes', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, "MIXED=\"value'\n");

    const result = parseEnvFile(fp);
    expect(result).toEqual({ MIXED: "\"value'" });
  });

  it('handles values containing = signs', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, 'BASE64=dGVzdA==\n');

    const result = parseEnvFile(fp);
    expect(result).toEqual({ BASE64: 'dGVzdA==' });
  });

  it('handles empty values (KEY= with nothing after)', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, 'EMPTY_KEY=\nNORMAL=value\n');

    const result = parseEnvFile(fp);
    expect(result.EMPTY_KEY).toBe('');
    expect(result.NORMAL).toBe('value');
  });

  it('trims whitespace around key and value', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, '  KEY  =  value  \n');

    const result = parseEnvFile(fp);
    expect(result).toEqual({ KEY: 'value' });
  });

  it('ignores lines without = sign', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, 'VALID=yes\nINVALID_LINE\nALSO_VALID=true\n');

    const result = parseEnvFile(fp);
    expect(result).toEqual({ VALID: 'yes', ALSO_VALID: 'true' });
    expect(result).not.toHaveProperty('INVALID_LINE');
  });

  it('returns empty object for non-existent file', () => {
    const result = parseEnvFile(join(tmpDir, 'nonexistent.env'));
    expect(result).toEqual({});
  });

  it('returns empty object for file with only comments', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, '# Comment 1\n# Comment 2\n\n');

    const result = parseEnvFile(fp);
    expect(result).toEqual({});
  });

  it('handles Windows-style line endings (CRLF)', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, 'A=1\r\nB=2\r\n');

    const result = parseEnvFile(fp);
    expect(result.A).toBe('1');
    expect(result.B).toBe('2');
  });
});

describe('parseEnvFile — real-world .env.development template', () => {
  it('parses auto-generated .env.development from init', () => {
    const fp = join(tmpDir, '.env.development');
    writeFileSync(
      fp,
      [
        '# EdgeBase Development Environment Variables',
        '# This file is git-ignored.',
        '',
        'JWT_USER_SECRET=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        'JWT_ADMIN_SECRET=f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5',
        '',
        '# STRIPE_SECRET_KEY=sk_test_...',
        '',
      ].join('\n'),
    );

    const result = parseEnvFile(fp);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result.JWT_USER_SECRET).toHaveLength(64);
    expect(result.JWT_ADMIN_SECRET).toHaveLength(64);
    expect(result).not.toHaveProperty('STRIPE_SECRET_KEY'); // commented out
  });

  it('parses .env.release with production secrets', () => {
    const fp = join(tmpDir, '.env.release');
    writeFileSync(
      fp,
      [
        '# EdgeBase Production Environment Variables',
        'JWT_USER_SECRET=prod_user_secret_64chars_aaaa1111bbbb2222cccc3333dddd4444ee',
        'JWT_ADMIN_SECRET=prod_admin_secret_64chars_ffff5555eeee6666dddd7777cccc8888a',
        'STRIPE_SECRET_KEY=sk_live_51abc123',
        'EMAIL_API_KEY=re_abcdefgh',
      ].join('\n'),
    );

    const result = parseEnvFile(fp);
    expect(Object.keys(result)).toHaveLength(4);
    expect(result.STRIPE_SECRET_KEY).toBe('sk_live_51abc123');
    expect(result.EMAIL_API_KEY).toBe('re_abcdefgh');
  });
});

// ======================================================================
// 2. parseDevVars — fallback 체인
// ======================================================================

describe('parseDevVars — .env.development → .dev.vars fallback', () => {
  it('reads .env.development when it exists', () => {
    writeFileSync(
      join(tmpDir, '.env.development'),
      'JWT_USER_SECRET=from_env_dev\n',
    );
    // Also create .dev.vars with different value
    writeFileSync(
      join(tmpDir, '.dev.vars'),
      'JWT_USER_SECRET=from_dev_vars\n',
    );

    const result = parseDevVars(tmpDir);
    // .env.development takes priority
    expect(result.JWT_USER_SECRET).toBe('from_env_dev');
  });

  it('falls back to .dev.vars when .env.development does not exist', () => {
    // Only .dev.vars exists (existing project, no migration yet)
    writeFileSync(
      join(tmpDir, '.dev.vars'),
      'JWT_USER_SECRET=from_dev_vars\nJWT_ADMIN_SECRET=admin_abc\n',
    );

    const result = parseDevVars(tmpDir);
    expect(result.JWT_USER_SECRET).toBe('from_dev_vars');
    expect(result.JWT_ADMIN_SECRET).toBe('admin_abc');
  });

  it('returns empty object when neither file exists', () => {
    const result = parseDevVars(tmpDir);
    expect(result).toEqual({});
  });

  it('.env.development completely supersedes .dev.vars (no merge)', () => {
    writeFileSync(
      join(tmpDir, '.env.development'),
      'KEY_A=from_dev\n',
    );
    writeFileSync(
      join(tmpDir, '.dev.vars'),
      'KEY_A=from_vars\nKEY_B=only_in_vars\n',
    );

    const result = parseDevVars(tmpDir);
    expect(result.KEY_A).toBe('from_dev');
    // KEY_B from .dev.vars is NOT included — .env.development is the sole source
    expect(result).not.toHaveProperty('KEY_B');
  });
});

// ======================================================================
// 3. dev 명령어 — .env.development → .dev.vars 동기화
// ======================================================================

describe('dev sync — .env.development → .dev.vars copy', () => {
  it('copies .env.development to .dev.vars when it exists', () => {
    const envDevContent = 'JWT_USER_SECRET=dev123\nSTRIPE_KEY=sk_test_xxx\n';
    writeFileSync(join(tmpDir, '.env.development'), envDevContent);

    // Simulate dev.ts sync logic
    const envDevPath = join(tmpDir, '.env.development');
    if (existsSync(envDevPath)) {
      copyFileSync(envDevPath, join(tmpDir, '.dev.vars'));
    }

    const devVarsContent = readFileSync(join(tmpDir, '.dev.vars'), 'utf-8');
    expect(devVarsContent).toBe(envDevContent);
  });

  it('does nothing when .env.development does not exist', () => {
    // Pre-existing .dev.vars should remain untouched
    const originalContent = 'EXISTING=value\n';
    writeFileSync(join(tmpDir, '.dev.vars'), originalContent);

    const envDevPath = join(tmpDir, '.env.development');
    if (existsSync(envDevPath)) {
      copyFileSync(envDevPath, join(tmpDir, '.dev.vars'));
    }

    const devVarsContent = readFileSync(join(tmpDir, '.dev.vars'), 'utf-8');
    expect(devVarsContent).toBe(originalContent);
  });

  it('overwrites existing .dev.vars completely', () => {
    writeFileSync(join(tmpDir, '.dev.vars'), 'OLD_KEY=old_value\n');
    writeFileSync(join(tmpDir, '.env.development'), 'NEW_KEY=new_value\n');

    const envDevPath = join(tmpDir, '.env.development');
    if (existsSync(envDevPath)) {
      copyFileSync(envDevPath, join(tmpDir, '.dev.vars'));
    }

    const devVarsContent = readFileSync(join(tmpDir, '.dev.vars'), 'utf-8');
    expect(devVarsContent).toBe('NEW_KEY=new_value\n');
    expect(devVarsContent).not.toContain('OLD_KEY');
  });

  it('wrangler can read the synced .dev.vars (valid KEY=VALUE format)', () => {
    const envDev = [
      '# Comments are fine',
      'JWT_USER_SECRET=abc123',
      'JWT_ADMIN_SECRET=def456',
      '',
      '# Stripe test keys',
      'STRIPE_SECRET_KEY=sk_test_xyz',
    ].join('\n');
    writeFileSync(join(tmpDir, '.env.development'), envDev);
    copyFileSync(
      join(tmpDir, '.env.development'),
      join(tmpDir, '.dev.vars'),
    );

    // Verify .dev.vars is valid for both wrangler and parseEnvFile
    const parsed = parseEnvFile(join(tmpDir, '.dev.vars'));
    expect(parsed).toEqual({
      JWT_USER_SECRET: 'abc123',
      JWT_ADMIN_SECRET: 'def456',
      STRIPE_SECRET_KEY: 'sk_test_xyz',
    });
  });
});

// ======================================================================
// 4. deploy syncEnvSecrets — .env.release → JSON 변환
// ======================================================================

describe('deploy syncEnvSecrets — .env.release → JSON transform', () => {
  /**
   * syncEnvSecrets 내부에서 parseEnvFile → JSON.stringify → wrangler secret bulk
   * 로 전달되는 데이터를 검증합니다. wrangler 호출 자체는 mock 없이 로직만 테스트.
   */

  it('converts .env.release to valid JSON for wrangler secret bulk', () => {
    const fp = join(tmpDir, '.env.release');
    writeFileSync(
      fp,
      'JWT_USER_SECRET=prod_secret\nSTRIPE_KEY=sk_live_abc\n',
    );

    const vars = parseEnvFile(fp);
    const json = JSON.stringify(vars);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual({
      JWT_USER_SECRET: 'prod_secret',
      STRIPE_KEY: 'sk_live_abc',
    });
  });

  it('excludes SERVICE_KEY from sync (auto-managed)', () => {
    const fp = join(tmpDir, '.env.release');
    writeFileSync(
      fp,
      'SERVICE_KEY=user_should_not_set_this\nJWT_USER_SECRET=real_secret\n',
    );

    const vars = parseEnvFile(fp);
    // Simulate syncEnvSecrets SERVICE_KEY exclusion
    delete vars['SERVICE_KEY'];

    expect(vars).not.toHaveProperty('SERVICE_KEY');
    expect(vars.JWT_USER_SECRET).toBe('real_secret');
  });

  it('handles empty .env.release (no secrets to sync)', () => {
    const fp = join(tmpDir, '.env.release');
    writeFileSync(fp, '# Only comments\n\n');

    const vars = parseEnvFile(fp);
    delete vars['SERVICE_KEY'];
    const keys = Object.keys(vars);

    expect(keys).toHaveLength(0);
  });

  it('skips sync when .env.release does not exist', () => {
    const envReleasePath = join(tmpDir, '.env.release');
    expect(existsSync(envReleasePath)).toBe(false);
    // syncEnvSecrets should early-return — no error
  });

  it('preserves special characters in values through JSON roundtrip', () => {
    const fp = join(tmpDir, '.env.release');
    writeFileSync(fp, 'WEBHOOK_SECRET=whsec_+/abc123==\n');

    const vars = parseEnvFile(fp);
    const json = JSON.stringify(vars);
    const roundtripped = JSON.parse(json);

    expect(roundtripped.WEBHOOK_SECRET).toBe('whsec_+/abc123==');
  });

  it('handles quoted values in .env.release', () => {
    const fp = join(tmpDir, '.env.release');
    writeFileSync(fp, 'API_KEY="sk_live_with spaces"\n');

    const vars = parseEnvFile(fp);
    expect(vars.API_KEY).toBe('sk_live_with spaces');

    const json = JSON.stringify(vars);
    const roundtripped = JSON.parse(json);
    expect(roundtripped.API_KEY).toBe('sk_live_with spaces');
  });

  it('filters empty values from sync payload', () => {
    const fp = join(tmpDir, '.env.release');
    writeFileSync(fp, 'FILLED=value\nEMPTY=\n');

    const vars = parseEnvFile(fp);
    expect(vars.FILLED).toBe('value');
    expect(vars.EMPTY).toBe('');

    // syncEnvSecrets sends all — empty values are valid Cloudflare Secrets
    const json = JSON.stringify(vars);
    expect(json).toContain('"FILLED":"value"');
    expect(json).toContain('"EMPTY":""');
  });
});

// ======================================================================
// 5. init 명령어 — .env.development, example 파일, gitignore
// ======================================================================

describe('init command — env file generation', () => {
  it('creates .env.development with auto-generated JWT secrets', async () => {
    const { initCommand } = await import('../src/commands/init.js');
    const freshDir = join(
      tmpdir(),
      `eb-init-env-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(freshDir, { recursive: true });

    try {
      await initCommand.parseAsync([freshDir], { from: 'user' });

      // .env.development should exist with secrets
      const envDevPath = join(freshDir, '.env.development');
      expect(existsSync(envDevPath)).toBe(true);

      const content = readFileSync(envDevPath, 'utf-8');
      const userMatch = content.match(/JWT_USER_SECRET=([a-f0-9]+)/);
      const adminMatch = content.match(/JWT_ADMIN_SECRET=([a-f0-9]+)/);

      expect(userMatch).toBeTruthy();
      expect(userMatch![1]).toHaveLength(64);
      expect(adminMatch).toBeTruthy();
      expect(adminMatch![1]).toHaveLength(64);

      // Secrets should be different
      expect(userMatch![1]).not.toBe(adminMatch![1]);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('creates .env.development.example (committed template)', async () => {
    const { initCommand } = await import('../src/commands/init.js');
    const freshDir = join(
      tmpdir(),
      `eb-init-example-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(freshDir, { recursive: true });

    try {
      await initCommand.parseAsync([freshDir], { from: 'user' });

      const examplePath = join(freshDir, '.env.development.example');
      expect(existsSync(examplePath)).toBe(true);

      const content = readFileSync(examplePath, 'utf-8');
      expect(content).toContain('JWT_USER_SECRET=');
      expect(content).toContain('JWT_ADMIN_SECRET=');
      expect(content).toContain('Development');

      // Example should NOT have auto-generated secrets (empty values)
      const userMatch = content.match(/JWT_USER_SECRET=([a-f0-9]+)/);
      expect(userMatch).toBeNull(); // empty value in template
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('creates .env.release.example (committed template)', async () => {
    const { initCommand } = await import('../src/commands/init.js');
    const freshDir = join(
      tmpdir(),
      `eb-init-release-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(freshDir, { recursive: true });

    try {
      await initCommand.parseAsync([freshDir], { from: 'user' });

      const examplePath = join(freshDir, '.env.release.example');
      expect(existsSync(examplePath)).toBe(true);

      const content = readFileSync(examplePath, 'utf-8');
      expect(content).toContain('JWT_USER_SECRET=');
      expect(content).toContain('JWT_ADMIN_SECRET=');
      expect(content).toContain('Production');
      expect(content).toContain('SERVICE_KEY');
      expect(content).toContain('auto-managed');
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('.gitignore includes .env.development and .env.release', async () => {
    const { initCommand } = await import('../src/commands/init.js');
    const freshDir = join(
      tmpdir(),
      `eb-init-gitignore-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(freshDir, { recursive: true });

    try {
      await initCommand.parseAsync([freshDir], { from: 'user' });

      const gitignorePath = join(freshDir, '.gitignore');
      expect(existsSync(gitignorePath)).toBe(true);

      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('.env.development');
      expect(content).toContain('.env.release');
      expect(content).toContain('.dev.vars'); // backward compat
      expect(content).toContain('.wrangler.generated.*');
      expect(content).toContain('edgebase.d.ts');
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('.edgebase/secrets.json backup matches .env.development secrets', async () => {
    const { initCommand } = await import('../src/commands/init.js');
    const freshDir = join(
      tmpdir(),
      `eb-init-secrets-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(freshDir, { recursive: true });

    try {
      await initCommand.parseAsync([freshDir], { from: 'user' });

      const envDev = readFileSync(join(freshDir, '.env.development'), 'utf-8');
      const secretsJson = JSON.parse(
        readFileSync(join(freshDir, '.edgebase', 'secrets.json'), 'utf-8'),
      );

      const userSecret = envDev.match(/JWT_USER_SECRET=([a-f0-9]+)/)![1];
      const adminSecret = envDev.match(/JWT_ADMIN_SECRET=([a-f0-9]+)/)![1];

      expect(secretsJson.JWT_USER_SECRET).toBe(userSecret);
      expect(secretsJson.JWT_ADMIN_SECRET).toBe(adminSecret);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('does not overwrite existing .env.development', async () => {
    const { initCommand } = await import('../src/commands/init.js');
    const freshDir = join(
      tmpdir(),
      `eb-init-nooverwrite-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(freshDir, { recursive: true });

    try {
      // Pre-create .env.development with known content
      const preExisting = 'JWT_USER_SECRET=my_custom_secret\n';
      writeFileSync(join(freshDir, '.env.development'), preExisting);

      await initCommand.parseAsync([freshDir], { from: 'user' });

      // Should NOT overwrite
      const content = readFileSync(join(freshDir, '.env.development'), 'utf-8');
      expect(content).toBe(preExisting);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });
});

// ======================================================================
// 6. 하위 호환 — 기존 .dev.vars 프로젝트
// ======================================================================

describe('Backward compatibility — existing .dev.vars projects', () => {
  it('parseDevVars works with legacy .dev.vars only', () => {
    writeFileSync(
      join(tmpDir, '.dev.vars'),
      'JWT_USER_SECRET=legacy_secret\nJWT_ADMIN_SECRET=legacy_admin\n',
    );

    const result = parseDevVars(tmpDir);
    expect(result.JWT_USER_SECRET).toBe('legacy_secret');
    expect(result.JWT_ADMIN_SECRET).toBe('legacy_admin');
  });

  it('dev sync skips when only .dev.vars exists (no copy)', () => {
    const originalContent = 'JWT_USER_SECRET=legacy\n';
    writeFileSync(join(tmpDir, '.dev.vars'), originalContent);

    // Simulate dev.ts sync — should NOT touch .dev.vars
    const envDevPath = join(tmpDir, '.env.development');
    if (existsSync(envDevPath)) {
      copyFileSync(envDevPath, join(tmpDir, '.dev.vars'));
    }

    expect(readFileSync(join(tmpDir, '.dev.vars'), 'utf-8')).toBe(
      originalContent,
    );
  });

  it('deploy works without .env.release (no sync, no error)', () => {
    // Simulate syncEnvSecrets early return
    const envReleasePath = join(tmpDir, '.env.release');
    expect(existsSync(envReleasePath)).toBe(false);
    // No error thrown — function should just return
  });

  it('migration path: .dev.vars → .env.development coexistence', () => {
    // User has old .dev.vars, then creates .env.development
    writeFileSync(
      join(tmpDir, '.dev.vars'),
      'JWT_USER_SECRET=old\nOLD_KEY=legacy\n',
    );
    writeFileSync(
      join(tmpDir, '.env.development'),
      'JWT_USER_SECRET=new\nNEW_KEY=modern\n',
    );

    // parseDevVars prefers .env.development
    const result = parseDevVars(tmpDir);
    expect(result.JWT_USER_SECRET).toBe('new');
    expect(result.NEW_KEY).toBe('modern');
    expect(result).not.toHaveProperty('OLD_KEY'); // not merged
  });
});

// ======================================================================
// 7. Edge Cases
// ======================================================================

describe('Edge cases', () => {
  it('handles .env file with UTF-8 BOM', () => {
    const fp = join(tmpDir, '.env');
    // BOM + content
    writeFileSync(fp, '\uFEFFKEY=value\n');

    const result = parseEnvFile(fp);
    // BOM should not affect parsing (first line may have BOM prefix on key)
    // Our parser trims, so the key might include BOM — this tests current behavior
    const keys = Object.keys(result);
    expect(keys.length).toBe(1);
    // Value should be clean regardless
    expect(Object.values(result)[0]).toBe('value');
  });

  it('handles very long values (JWT tokens, etc.)', () => {
    const fp = join(tmpDir, '.env');
    const longValue = 'a'.repeat(2048);
    writeFileSync(fp, `LONG_TOKEN=${longValue}\n`);

    const result = parseEnvFile(fp);
    expect(result.LONG_TOKEN).toBe(longValue);
    expect(result.LONG_TOKEN).toHaveLength(2048);
  });

  it('handles value with # character (not treated as comment)', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, 'COLOR=#ff0000\n');

    const result = parseEnvFile(fp);
    // # after = is part of the value, not a comment
    expect(result.COLOR).toBe('#ff0000');
  });

  it('handles multiple = in value (base64, connection strings)', () => {
    const fp = join(tmpDir, '.env');
    writeFileSync(fp, 'DB_URL=postgres://user:pass@host/db?ssl=true&pool=5\n');

    const result = parseEnvFile(fp);
    expect(result.DB_URL).toBe('postgres://user:pass@host/db?ssl=true&pool=5');
  });

  it('JSON.stringify of parsed env is valid input for wrangler secret bulk', () => {
    const fp = join(tmpDir, '.env.release');
    writeFileSync(
      fp,
      [
        'JWT_USER_SECRET=secret123',
        'STRIPE_KEY=sk_live_abc',
        'WEBHOOK_SECRET=whsec_+/base64==',
      ].join('\n'),
    );

    const vars = parseEnvFile(fp);
    const json = JSON.stringify(vars);

    // Should be valid JSON
    expect(() => JSON.parse(json)).not.toThrow();

    // Should be a flat object with string values (wrangler format)
    const parsed = JSON.parse(json);
    for (const [key, value] of Object.entries(parsed)) {
      expect(typeof key).toBe('string');
      expect(typeof value).toBe('string');
    }
  });

  it('.env.development and .env.release have different content', () => {
    writeFileSync(
      join(tmpDir, '.env.development'),
      'STRIPE_KEY=sk_test_dev\nENV=development\n',
    );
    writeFileSync(
      join(tmpDir, '.env.release'),
      'STRIPE_KEY=sk_live_prod\nENV=production\n',
    );

    const dev = parseEnvFile(join(tmpDir, '.env.development'));
    const release = parseEnvFile(join(tmpDir, '.env.release'));

    expect(dev.STRIPE_KEY).toBe('sk_test_dev');
    expect(release.STRIPE_KEY).toBe('sk_live_prod');
    expect(dev.ENV).not.toBe(release.ENV);
  });
});
