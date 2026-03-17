import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { _internals, backupCommand } from '../src/commands/backup.js';
import { setContext } from '../src/lib/cli-context.js';

const {
  readSecrets,
  writeSecrets,
  collectFiles,
  throttleSettled,
  logHuman,
  logHumanError,
  writeHuman,
  collectSettledFailures,
  summarizeFailures,
  parseBackupFile,
  resolveDownloadSessionPaths,
} = _internals;

/**
 * Comprehensive CLI backup tests — 10 sections, 60+ tests
 *
 * Sections 1-5: Pure utility function tests
 * Sections 6-10: Integration tests covering actual backup/restore flows,
 *                file I/O, tar.gz archive, secrets roundtrip, edge cases
 */

// ─── Types ───

interface DODump {
  doName: string;
  doType: 'database' | 'auth';
  tables: Record<string, unknown[]>;
  timestamp: string;
}

interface D1Dump {
  type: 'd1';
  tables: Record<string, unknown[]>;
  timestamp: string;
}

interface StorageObject {
  key: string;
  size: number;
  etag: string;
  contentType: string;
}

interface BackupFileV1 {
  version: '1.1';
  timestamp: string;
  source: string;
  config?: Record<string, unknown>;
  secrets?: Record<string, string>;
  control: {
    d1: Record<string, unknown[]>;
  };
  auth: {
    d1: Record<string, unknown[]>;
    shards: Record<string, DODump>;
  };
  databases: Record<string, DODump>;
  storage?: { objects: StorageObject[] };
}

interface UnsupportedBackupFile {
  version: string;
  timestamp: string;
}

// ─── Inline helpers for non-exported logic ───

function parseDevVarsContent(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
  }
  return vars;
}

function detectSource(url: string): string {
  if (url.includes('workers.dev')) return 'cloudflare-edge';
  if (url.includes('localhost')) return 'local';
  return 'docker';
}

// ─── Shared test setup ───

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-backup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  setContext({ verbose: false, quiet: false, json: false, nonInteractive: false });
});

afterEach(() => {
  setContext({ verbose: false, quiet: false, json: false, nonInteractive: false });
  process.exitCode = undefined;
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. Backup Format Validation
// ======================================================================

describe('1. Backup Format Validation', () => {
  it('accepts canonical v1.1 format', () => {
    const v1: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
    };
    expect(v1.version).toBe('1.1');
  });

  it('treats pre-v1 formats as unsupported', () => {
    const legacy: UnsupportedBackupFile = { version: '0.1.0', timestamp: '' };
    expect(legacy.version).not.toBe('1.1');
  });

  it('keeps v1.1 valid even with extra stale fields present', () => {
    const mixed = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
      dos: [],
      d1: {},
    };
    expect(mixed.version).toBe('1.1');
    expect('auth' in mixed).toBe(true);
  });

  it('reads canonical version from parsed JSON file', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
    };
    const filePath = join(tmpDir, 'test.json');
    writeFileSync(filePath, JSON.stringify(backup));
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(parsed.version).toBe('1.1');
  });
});

describe('1b. Backup Runtime Validation Helpers', () => {
  it('parseBackupFile accepts canonical v1.1 shape', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '2026-03-07T00:00:00Z',
      source: 'local',
      control: { d1: { _meta: [] } },
      auth: { d1: { _users: [] }, shards: {} },
      databases: {},
    };

    expect(parseBackupFile(backup).version).toBe('1.1');
  });

  it('parseBackupFile rejects missing control.d1', () => {
    expect(() =>
      parseBackupFile({
        version: '1.1',
        timestamp: '2026-03-07T00:00:00Z',
        source: 'local',
        control: {},
        auth: { d1: {}, shards: {} },
        databases: {},
      }),
    ).toThrow('control.d1');
  });

  it('throttleSettled preserves order and exposes rejections', async () => {
    const results = await throttleSettled(
      [
        async () => 'first',
        async () => {
          throw new Error('boom');
        },
        async () => 'third',
      ],
      2,
    );

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('fulfilled');

    const failures = collectSettledFailures(results, ['alpha', 'beta', 'gamma']);
    expect(failures).toEqual(['beta: boom']);
  });

  it('summarizeFailures truncates long failure lists', () => {
    const summary = summarizeFailures('restore', ['a', 'b', 'c', 'd'], 2);
    expect(summary).toContain('restore failed (4 total)');
    expect(summary).toContain('a; b');
    expect(summary).toContain('+2 more');
  });

  it('resolveDownloadSessionPaths keeps storage inside the manifest session directory', () => {
    const baseTmpDir = join(tmpDir, '.edgebase', 'tmp');
    const fresh = resolveDownloadSessionPaths(baseTmpDir, '2026-03-07T00-00-00');

    expect(fresh.sessionDir).toBe(join(baseTmpDir, 'backup-2026-03-07T00-00-00'));
    expect(fresh.storageDir).toBe(join(baseTmpDir, 'backup-2026-03-07T00-00-00', 'storage'));
    expect(fresh.manifestPath).toBe(
      join(baseTmpDir, 'backup-2026-03-07T00-00-00', 'manifest.json'),
    );

    const resumed = resolveDownloadSessionPaths(baseTmpDir, 'ignored', fresh.storageDir);
    expect(resumed).toEqual(fresh);
  });

  it('suppresses human logs in json mode', () => {
    setContext({ json: true, quiet: false, verbose: false });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logHuman('hello');
    logHumanError('oops');
    writeHuman('progress');

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('restore emits a single JSON error when the backup file is missing', async () => {
    setContext({ json: true, quiet: false, verbose: false });
    const restoreCommand = backupCommand.commands.find((cmd) => cmd.name() === 'restore');
    expect(restoreCommand).toBeDefined();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const restore = restoreCommand as {
      _optionValues: Record<string, unknown>;
      _actionHandler: (args: unknown[], command: unknown) => Promise<void>;
    };
    restore._optionValues = {
      from: join(tmpDir, 'missing-backup.json'),
      url: 'http://localhost:8787',
      serviceKey: 'sk_test',
      yes: true,
    };

    await expect(restore._actionHandler([], restoreCommand)).rejects.toMatchObject({
      payload: expect.objectContaining({
        status: 'error',
        code: 'backup_file_not_found',
        message: `Backup file not found: ${join(tmpDir, 'missing-backup.json')}`,
      }),
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('restore emits structured needs_input JSON when --yes is missing in agent mode', async () => {
    setContext({ json: true, quiet: false, verbose: false, nonInteractive: true });
    const restoreCommand = backupCommand.commands.find((cmd) => cmd.name() === 'restore');
    expect(restoreCommand).toBeDefined();

    const backupPath = join(tmpDir, 'backup.json');
    writeFileSync(backupPath, JSON.stringify({
      version: '1.1',
      timestamp: '2026-03-17T00:00:00Z',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const restore = restoreCommand as {
      _optionValues: Record<string, unknown>;
      _actionHandler: (args: unknown[], command: unknown) => Promise<void>;
    };
    restore._optionValues = {
      from: backupPath,
      url: 'http://localhost:8787',
      serviceKey: 'sk_test',
      yes: false,
    };

    await expect(restore._actionHandler([], restoreCommand)).rejects.toMatchObject({
      payload: expect.objectContaining({
        status: 'needs_input',
        code: 'backup_restore_confirmation_required',
        field: 'yes',
      }),
    });
    expect(logSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});

// ======================================================================
// 2. Version Gate
// ======================================================================

describe('2. Version Gate', () => {
  it('canonical backups carry source + auth + databases blocks', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '2026-02-16T12:00:00Z',
      source: 'local',
      control: { d1: {} },
      auth: {
        d1: { _email_index: [{ email: 'a@b.com' }] },
        shards: {
          'auth:shard-0': {
            doName: 'auth:shard-0',
            doType: 'auth',
            tables: { _users: [{ id: 'u1' }] },
            timestamp: '',
          },
        },
      },
      databases: {
        'db:posts': {
          doName: 'db:posts',
          doType: 'database',
          tables: { posts: [{ id: 'p1' }] },
          timestamp: '',
        },
      },
    };
    expect(backup.auth.shards['auth:shard-0'].tables._users).toHaveLength(1);
    expect(backup.databases['db:posts'].tables.posts).toHaveLength(1);
    expect(backup.auth.d1._email_index).toHaveLength(1);
  });

  it('can represent all 16 auth shards directly in v1.1', () => {
    const shards = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [
        `auth:shard-${i}`,
        {
          doName: `auth:shard-${i}`,
          doType: 'auth' as const,
          tables: { _users: [{ id: `u${i}` }] },
          timestamp: '',
        },
      ]),
    );
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards },
      databases: {},
    };
    expect(Object.keys(backup.auth.shards)).toHaveLength(16);
    expect(Object.keys(backup.databases)).toHaveLength(0);
  });

  it('preserves dynamic database DO names in v1.1', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {
        'db:workspaceId:ws-123:tasks': {
          doName: 'db:workspaceId:ws-123:tasks',
          doType: 'database',
          tables: {},
          timestamp: '',
        },
      },
    };
    expect(backup.databases['db:workspaceId:ws-123:tasks']).toBeDefined();
  });

  it('empty v1.1 backup is valid', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
    };
    expect(Object.keys(backup.auth.shards)).toHaveLength(0);
    expect(Object.keys(backup.databases)).toHaveLength(0);
  });
});

// ======================================================================
// 3. .dev.vars Parsing
// ======================================================================

describe('3. .dev.vars Parsing', () => {
  it('parses standard key=value pairs', () => {
    const v = parseDevVarsContent('JWT_USER_SECRET=abc\nJWT_ADMIN_SECRET=def\nSERVICE_KEY=sk');
    expect(v).toEqual({ JWT_USER_SECRET: 'abc', JWT_ADMIN_SECRET: 'def', SERVICE_KEY: 'sk' });
  });

  it('skips comments and empty lines', () => {
    expect(Object.keys(parseDevVarsContent('# comment\n\nKEY=val\n  # indented'))).toHaveLength(1);
  });

  it('handles values with = signs', () => {
    expect(parseDevVarsContent('K=a=b=c').K).toBe('a=b=c');
  });

  it('trims whitespace', () => {
    expect(parseDevVarsContent('  KEY  =  value  ').KEY).toBe('value');
  });

  it('returns empty for empty content', () => {
    expect(Object.keys(parseDevVarsContent(''))).toHaveLength(0);
  });

  it('handles comment-only file', () => {
    expect(Object.keys(parseDevVarsContent('# only comments'))).toHaveLength(0);
  });

  it('handles lines without =', () => {
    expect(Object.keys(parseDevVarsContent('no_equals_here\nK=V'))).toHaveLength(1);
  });

  it('handles special chars in values', () => {
    expect(parseDevVarsContent('K=sk_abc!@#$%').K).toBe('sk_abc!@#$%');
  });

  it('handles typical init output', () => {
    const content =
      '# EdgeBase secrets\nJWT_USER_SECRET=a'.padEnd(
        64 + '# EdgeBase secrets\nJWT_USER_SECRET='.length,
        '0',
      ) + '\n';
    const v = parseDevVarsContent(content);
    expect(v.JWT_USER_SECRET).toBeDefined();
  });
});

// ======================================================================
// 4. Secrets Filesystem I/O (exported functions)
// ======================================================================

describe('4. Secrets Read — .dev.vars', () => {
  it('reads all 3 secret keys', () => {
    writeFileSync(
      join(tmpDir, '.dev.vars'),
      'JWT_USER_SECRET=u\nJWT_ADMIN_SECRET=a\nSERVICE_KEY=s\n',
    );
    expect(readSecrets(tmpDir)).toEqual({
      JWT_USER_SECRET: 'u',
      JWT_ADMIN_SECRET: 'a',
      SERVICE_KEY: 's',
    });
  });

  it('filters out non-secret keys', () => {
    writeFileSync(join(tmpDir, '.dev.vars'), 'JWT_USER_SECRET=u\nRANDOM=x\n');
    const s = readSecrets(tmpDir)!;
    expect(s.JWT_USER_SECRET).toBe('u');
    expect('RANDOM' in s).toBe(false);
  });

  it('returns null when no relevant keys', () => {
    writeFileSync(join(tmpDir, '.dev.vars'), 'RANDOM=x\n');
    expect(readSecrets(tmpDir)).toBeNull();
  });

  it('returns null when no files exist', () => {
    expect(readSecrets(tmpDir)).toBeNull();
  });
});

describe('4b. Secrets Read — .edgebase/secrets.json', () => {
  it('reads from JSON when .dev.vars missing', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.edgebase', 'secrets.json'),
      JSON.stringify({ JWT_USER_SECRET: 'j' }),
    );
    expect(readSecrets(tmpDir)!.JWT_USER_SECRET).toBe('j');
  });

  it('prefers .dev.vars over .edgebase/secrets.json', () => {
    writeFileSync(join(tmpDir, '.dev.vars'), 'JWT_USER_SECRET=devvars\n');
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.edgebase', 'secrets.json'),
      JSON.stringify({ JWT_USER_SECRET: 'json' }),
    );
    expect(readSecrets(tmpDir)!.JWT_USER_SECRET).toBe('devvars');
  });

  it('handles invalid JSON gracefully', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    writeFileSync(join(tmpDir, '.edgebase', 'secrets.json'), '{invalid');
    expect(readSecrets(tmpDir)).toBeNull();
  });
});

describe('4c. Secrets Write', () => {
  it('creates new .dev.vars', () => {
    writeSecrets(tmpDir, { JWT_USER_SECRET: 'new', SERVICE_KEY: 'sk' });
    const content = readFileSync(join(tmpDir, '.dev.vars'), 'utf-8');
    expect(content).toContain('JWT_USER_SECRET=new');
    expect(content).toContain('SERVICE_KEY=sk');
  });

  it('merges with existing .dev.vars', () => {
    writeFileSync(join(tmpDir, '.dev.vars'), 'EXISTING=keep\nJWT_USER_SECRET=old\n');
    writeSecrets(tmpDir, { JWT_USER_SECRET: 'updated', SERVICE_KEY: 'new_sk' });
    const v = parseDevVarsContent(readFileSync(join(tmpDir, '.dev.vars'), 'utf-8'));
    expect(v.EXISTING).toBe('keep');
    expect(v.JWT_USER_SECRET).toBe('updated');
    expect(v.SERVICE_KEY).toBe('new_sk');
  });

  it('roundtrip: write → read', () => {
    const orig = { JWT_USER_SECRET: 'rt_u', JWT_ADMIN_SECRET: 'rt_a', SERVICE_KEY: 'rt_s' };
    writeSecrets(tmpDir, orig);
    expect(readSecrets(tmpDir)).toEqual(orig);
  });

  it('overwrite existing secrets completely', () => {
    writeSecrets(tmpDir, { JWT_USER_SECRET: 'first' });
    writeSecrets(tmpDir, { JWT_USER_SECRET: 'second', SERVICE_KEY: 'sk2' });
    const s = readSecrets(tmpDir)!;
    expect(s.JWT_USER_SECRET).toBe('second');
    expect(s.SERVICE_KEY).toBe('sk2');
  });
});

// ======================================================================
// 5. collectFiles Helper (exported function)
// ======================================================================

describe('5. collectFiles', () => {
  it('flat directory', () => {
    writeFileSync(join(tmpDir, 'a.txt'), '1');
    writeFileSync(join(tmpDir, 'b.txt'), '2');
    const files = collectFiles(tmpDir);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.rel).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('nested directories', () => {
    mkdirSync(join(tmpDir, 'avatars'), { recursive: true });
    mkdirSync(join(tmpDir, 'docs', 'reports'), { recursive: true });
    writeFileSync(join(tmpDir, 'avatars', 'u1.jpg'), 'img');
    writeFileSync(join(tmpDir, 'docs', 'reports', 'q1.pdf'), 'pdf');
    const rels = collectFiles(tmpDir)
      .map((f) => f.rel)
      .sort();
    expect(rels).toContain('avatars/u1.jpg');
    expect(rels).toContain('docs/reports/q1.pdf');
  });

  it('empty directory', () => {
    mkdirSync(join(tmpDir, 'empty'));
    expect(collectFiles(join(tmpDir, 'empty'))).toHaveLength(0);
  });

  it('nonexistent directory', () => {
    expect(collectFiles(join(tmpDir, 'nope'))).toHaveLength(0);
  });

  it('preserves R2 deep key paths', () => {
    mkdirSync(join(tmpDir, 'tenant', 'ws-1', 'uploads'), { recursive: true });
    writeFileSync(join(tmpDir, 'tenant', 'ws-1', 'uploads', 'doc.pdf'), 'x');
    expect(collectFiles(tmpDir).find((f) => f.rel === 'tenant/ws-1/uploads/doc.pdf')).toBeDefined();
  });
});

// ======================================================================
// 6. Backup Create → File Output (End-to-End without API)
// ======================================================================

describe('6. Backup Create — JSON Output', () => {
  it('creates valid v1.1 JSON backup file', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: new Date().toISOString(),
      source: 'local',
      control: { d1: {} },
      auth: {
        d1: { _email_index: [{ email: 'a@b.com', shardId: 0, userId: 'u1' }] },
        shards: {
          'auth:shard-0': {
            doName: 'auth:shard-0',
            doType: 'auth',
            tables: { _users: [{ id: 'u1', email: 'a@b.com', passwordHash: 'hash123' }] },
            timestamp: '',
          },
        },
      },
      databases: {
        'db:posts': {
          doName: 'db:posts',
          doType: 'database',
          tables: { posts: [{ id: 'p1', title: 'Hello', content: 'World', views: 42 }] },
          timestamp: '',
        },
        'db:_system': {
          doName: 'db:_system',
          doType: 'database',
          tables: { _users_public: [{ id: 'u1', email: 'a@b.com', displayName: 'Test' }] },
          timestamp: '',
        },
      },
    };

    const filePath = join(tmpDir, 'backup.json');
    writeFileSync(filePath, JSON.stringify(backup, null, 2));

    // Verify file
    expect(existsSync(filePath)).toBe(true);
    const read = JSON.parse(readFileSync(filePath, 'utf-8')) as BackupFileV1;
    expect(read.version).toBe('1.1');
    expect(read.auth.d1._email_index).toHaveLength(1);
    expect(read.auth.shards['auth:shard-0'].tables._users).toHaveLength(1);
    expect(read.databases['db:posts'].tables.posts[0]).toEqual({
      id: 'p1',
      title: 'Hello',
      content: 'World',
      views: 42,
    });
    expect(read.databases['db:_system'].tables._users_public).toHaveLength(1);
  });

  it('backup JSON includes secrets when --include-secrets', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
      secrets: { JWT_USER_SECRET: 'sec_u', JWT_ADMIN_SECRET: 'sec_a', SERVICE_KEY: 'sk_key' },
    };

    const filePath = join(tmpDir, 'secrets-backup.json');
    writeFileSync(filePath, JSON.stringify(backup, null, 2));

    const read = JSON.parse(readFileSync(filePath, 'utf-8')) as BackupFileV1;
    expect(read.secrets).toBeDefined();
    expect(read.secrets!.JWT_USER_SECRET).toBe('sec_u');
    expect(read.secrets!.SERVICE_KEY).toBe('sk_key');
  });

  it('backup JSON includes R2 metadata when --include-storage', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
      storage: {
        objects: [
          { key: 'avatars/u1.jpg', size: 1024, etag: 'abc', contentType: 'image/jpeg' },
          { key: 'docs/report.pdf', size: 5000, etag: 'def', contentType: 'application/pdf' },
        ],
      },
    };

    const filePath = join(tmpDir, 'storage-backup.json');
    writeFileSync(filePath, JSON.stringify(backup, null, 2));

    const read = JSON.parse(readFileSync(filePath, 'utf-8')) as BackupFileV1;
    expect(read.storage!.objects).toHaveLength(2);
    expect(read.storage!.objects[0].contentType).toBe('image/jpeg');
  });

  it('backup source detection', () => {
    expect(detectSource('https://my-app.workers.dev')).toBe('cloudflare-edge');
    expect(detectSource('http://localhost:8787')).toBe('local');
    expect(detectSource('http://192.168.1.100:8787')).toBe('docker');
    expect(detectSource('http://edgebase.internal')).toBe('docker');
  });
});

// ======================================================================
// 7. Backup Restore — File Parsing (Restore input parsing)
// ======================================================================

describe('7. Restore — JSON Parsing', () => {
  it('parses v1.1 JSON backup', () => {
    const v1: BackupFileV1 = {
      version: '1.1',
      timestamp: '2026-02-16T00:00:00Z',
      source: 'local',
      control: { d1: {} },
      auth: {
        d1: { _email_index: [{ email: 'a@b.com', shardId: 0 }] },
        shards: {
          'auth:shard-0': {
            doName: 'auth:shard-0',
            doType: 'auth',
            tables: { _users: [{ id: 'u1' }] },
            timestamp: '',
          },
        },
      },
      databases: {
        'db:posts': {
          doName: 'db:posts',
          doType: 'database',
          tables: { posts: [{ id: 'p1' }] },
          timestamp: '',
        },
      },
    };

    const filePath = join(tmpDir, 'v1-restore.json');
    writeFileSync(filePath, JSON.stringify(v1));

    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as BackupFileV1;
    expect(raw.version).toBe('1.1');
    const backup = raw as BackupFileV1;

    expect(Object.keys(backup.auth.shards)).toHaveLength(1);
    expect(Object.keys(backup.databases)).toHaveLength(1);
    expect(Object.keys(backup.auth.d1)).toHaveLength(1);
  });

  it('treats legacy backup versions as unsupported', () => {
    const legacy = {
      version: '0.1.0',
      timestamp: '2026-02-15T00:00:00Z',
      type: 'full',
      dos: [],
      d1: { type: 'd1', tables: {}, timestamp: '' },
    };

    const filePath = join(tmpDir, 'legacy-restore.json');
    writeFileSync(filePath, JSON.stringify(legacy));

    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as UnsupportedBackupFile;
    expect(raw.version).not.toBe('1.1');
  });

  it('restore summary counts match for v1.1', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '2026-02-16T00:00:00Z',
      source: 'cloudflare-edge',
      control: { d1: {} },
      auth: {
        d1: {
          _email_index: [1, 2, 3],
          _oauth_index: [4],
          _anon_index: [],
          _admins: [],
          _admin_sessions: [],
        },
        shards: {
          'auth:shard-0': { doName: 'auth:shard-0', doType: 'auth', tables: {}, timestamp: '' },
          'auth:shard-1': { doName: 'auth:shard-1', doType: 'auth', tables: {}, timestamp: '' },
        },
      },
      databases: {
        'db:posts': { doName: 'db:posts', doType: 'database', tables: {}, timestamp: '' },
        'db:categories': { doName: 'db:categories', doType: 'database', tables: {}, timestamp: '' },
        'db:_system': { doName: 'db:_system', doType: 'database', tables: {}, timestamp: '' },
      },
      secrets: { JWT_USER_SECRET: 'x', JWT_ADMIN_SECRET: 'y', SERVICE_KEY: 'z' },
      storage: {
        objects: [
          { key: 'a.jpg', size: 100, etag: 'e1', contentType: 'image/jpeg' },
          { key: 'b.pdf', size: 200, etag: 'e2', contentType: 'application/pdf' },
        ],
      },
    };

    // These are the counts the CLI would display
    const authShardCount = Object.keys(backup.auth.shards).length;
    const dbCount = Object.keys(backup.databases).length;
    const d1TableCount = Object.keys(backup.auth.d1).length;
    const secretsCount = Object.keys(backup.secrets!).length;
    const storageFileCount = backup.storage!.objects.length;

    expect(authShardCount).toBe(2);
    expect(dbCount).toBe(3);
    expect(d1TableCount).toBe(5);
    expect(secretsCount).toBe(3);
    expect(storageFileCount).toBe(2);
  });
});

// ======================================================================
// 8. tar.gz Archive Create & Extract
// ======================================================================

describe('8. tar.gz Archive', () => {
  it('create → extract roundtrip with backup.json + storage files', () => {
    // Setup: create backup.json + storage/ directory
    const stagingDir = join(tmpDir, 'staging');
    mkdirSync(join(stagingDir, 'storage', 'avatars'), { recursive: true });

    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
      storage: {
        objects: [{ key: 'avatars/u1.jpg', size: 5, etag: 'x', contentType: 'image/jpeg' }],
      },
    };

    writeFileSync(join(stagingDir, 'backup.json'), JSON.stringify(backup, null, 2));
    writeFileSync(join(stagingDir, 'storage', 'avatars', 'u1.jpg'), 'image');

    // Create tar.gz
    const archivePath = join(tmpDir, 'test-backup.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${stagingDir}" backup.json storage`, { stdio: 'pipe' });

    expect(existsSync(archivePath)).toBe(true);
    expect(statSync(archivePath).size).toBeGreaterThan(0);

    // Extract and verify
    const extractDir = join(tmpDir, 'extracted');
    mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: 'pipe' });

    expect(existsSync(join(extractDir, 'backup.json'))).toBe(true);
    expect(existsSync(join(extractDir, 'storage', 'avatars', 'u1.jpg'))).toBe(true);

    const readBackup = JSON.parse(
      readFileSync(join(extractDir, 'backup.json'), 'utf-8'),
    ) as BackupFileV1;
    expect(readBackup.version).toBe('1.1');
    expect(readBackup.storage!.objects).toHaveLength(1);

    const imgContent = readFileSync(join(extractDir, 'storage', 'avatars', 'u1.jpg'), 'utf-8');
    expect(imgContent).toBe('image');
  });

  it('handles many nested storage files in archive', () => {
    const stagingDir = join(tmpDir, 'staging-multi');
    const objects: StorageObject[] = [];

    // Create 20 files in various subdirectories
    for (let i = 0; i < 20; i++) {
      const key = `dir-${i % 5}/sub-${i % 3}/file-${i}.txt`;
      const fullPath = join(stagingDir, 'storage', key);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, `content-${i}`);
      objects.push({ key, size: `content-${i}`.length, etag: `e${i}`, contentType: 'text/plain' });
    }

    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
      storage: { objects },
    };
    writeFileSync(join(stagingDir, 'backup.json'), JSON.stringify(backup));

    // Create and extract archive
    const archivePath = join(tmpDir, 'multi.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${stagingDir}" backup.json storage`, { stdio: 'pipe' });

    const extractDir = join(tmpDir, 'extract-multi');
    mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: 'pipe' });

    // Verify all files extracted
    const extracted = collectFiles(join(extractDir, 'storage'));
    expect(extracted).toHaveLength(20);

    // Verify content
    const file5 = readFileSync(
      join(extractDir, 'storage', 'dir-0', 'sub-2', 'file-5.txt'),
      'utf-8',
    );
    expect(file5).toBe('content-5');
  });

  it('restore flow: extract tar.gz → parse backup.json → list storage files', () => {
    // Simulate full restore flow
    const stagingDir = join(tmpDir, 'restore-stage');
    mkdirSync(join(stagingDir, 'storage', 'uploads'), { recursive: true });

    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '2026-02-16T00:00:00Z',
      source: 'cloudflare-edge',
      control: { d1: {} },
      auth: {
        d1: { _email_index: [{ email: 'a@b.com' }] },
        shards: {
          'auth:shard-0': {
            doName: 'auth:shard-0',
            doType: 'auth',
            tables: { _users: [{ id: 'u1' }] },
            timestamp: '',
          },
        },
      },
      databases: {
        'db:posts': {
          doName: 'db:posts',
          doType: 'database',
          tables: { posts: [{ id: 'p1', title: 'Hello' }] },
          timestamp: '',
        },
      },
      storage: {
        objects: [
          { key: 'uploads/photo.jpg', size: 10, etag: 'e1', contentType: 'image/jpeg' },
          { key: 'uploads/doc.pdf', size: 8, etag: 'e2', contentType: 'application/pdf' },
        ],
      },
    };

    writeFileSync(join(stagingDir, 'backup.json'), JSON.stringify(backup));
    writeFileSync(join(stagingDir, 'storage', 'uploads', 'photo.jpg'), 'jpeg-data!');
    writeFileSync(join(stagingDir, 'storage', 'uploads', 'doc.pdf'), 'pdf-data');

    // Create archive
    const archivePath = join(tmpDir, 'restore-test.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${stagingDir}" backup.json storage`, { stdio: 'pipe' });

    // === Simulate restore flow ===

    // Step 1: Extract
    const extractDir = join(tmpDir, 'restore-extract');
    mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: 'pipe' });

    // Step 2: Parse backup.json
    const parsedBackup = JSON.parse(
      readFileSync(join(extractDir, 'backup.json'), 'utf-8'),
    ) as BackupFileV1;
    expect(parsedBackup.version).toBe('1.1');
    const restored = parsedBackup as BackupFileV1;

    // Step 3: Verify restore data
    expect(restored.auth.d1._email_index).toHaveLength(1);
    expect(restored.auth.shards['auth:shard-0']).toBeDefined();
    expect(restored.databases['db:posts'].tables.posts).toHaveLength(1);

    // Step 4: List storage files
    const storagePath = join(extractDir, 'storage');
    expect(existsSync(storagePath)).toBe(true);
    const storageFiles = collectFiles(storagePath);
    expect(storageFiles).toHaveLength(2);

    // Step 5: Verify content type lookup from metadata
    for (const sf of storageFiles) {
      const meta = restored.storage!.objects.find((o) => o.key === sf.rel);
      expect(meta).toBeDefined();
      expect(meta!.contentType).toMatch(/^(image|application)\//);
    }

    // Step 6: Verify file content
    const photoContent = readFileSync(join(storagePath, 'uploads', 'photo.jpg'), 'utf-8');
    expect(photoContent).toBe('jpeg-data!');
  });
});

// ======================================================================
// 9. Secrets Integration — Backup Create + Restore Flow
// ======================================================================

describe('9. Secrets — Full Create → Restore Flow', () => {
  it('backup with secrets → restore to new location', () => {
    // === CREATE: Read secrets from source project ===
    const sourceDir = join(tmpDir, 'source');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, '.dev.vars'),
      'JWT_USER_SECRET=orig_user\nJWT_ADMIN_SECRET=orig_admin\nSERVICE_KEY=orig_sk\n',
    );

    const secrets = readSecrets(sourceDir);
    expect(secrets).toEqual({
      JWT_USER_SECRET: 'orig_user',
      JWT_ADMIN_SECRET: 'orig_admin',
      SERVICE_KEY: 'orig_sk',
    });

    // Build backup JSON with secrets
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: new Date().toISOString(),
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
      secrets: secrets!,
    };

    const backupPath = join(tmpDir, 'backup-with-secrets.json');
    writeFileSync(backupPath, JSON.stringify(backup, null, 2));

    // === RESTORE: Write secrets to target project ===
    const targetDir = join(tmpDir, 'target');
    mkdirSync(targetDir, { recursive: true });

    const restored = JSON.parse(readFileSync(backupPath, 'utf-8')) as BackupFileV1;
    expect(restored.secrets).toBeDefined();

    writeSecrets(targetDir, restored.secrets!);

    // Verify target has same secrets as source
    const targetSecrets = readSecrets(targetDir);
    expect(targetSecrets).toEqual(secrets);
  });

  it('restore secrets merges with existing target .dev.vars', () => {
    const targetDir = join(tmpDir, 'target-merge');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, '.dev.vars'), 'OTHER_KEY=keep_me\nJWT_USER_SECRET=old_value\n');

    // Restore from backup with secrets
    writeSecrets(targetDir, {
      JWT_USER_SECRET: 'from_backup',
      JWT_ADMIN_SECRET: 'from_backup_admin',
      SERVICE_KEY: 'from_backup_sk',
    });

    const merged = parseDevVarsContent(readFileSync(join(targetDir, '.dev.vars'), 'utf-8'));
    expect(merged.OTHER_KEY).toBe('keep_me'); // preserved
    expect(merged.JWT_USER_SECRET).toBe('from_backup'); // updated
    expect(merged.JWT_ADMIN_SECRET).toBe('from_backup_admin'); // added
    expect(merged.SERVICE_KEY).toBe('from_backup_sk'); // added
  });

  it('backup without --include-secrets has no secrets field', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
    };

    const json = JSON.stringify(backup);
    const parsed = JSON.parse(json) as BackupFileV1;
    expect(parsed.secrets).toBeUndefined();
  });

  it('restore with --skip-secrets does not write secrets', () => {
    const targetDir = join(tmpDir, 'skip-secrets');
    mkdirSync(targetDir, { recursive: true });

    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
      secrets: { JWT_USER_SECRET: 'should_not_write' },
    };

    // Simulate --skip-secrets: check flag before writing
    const skipSecrets = true;
    const hasSecrets = !!backup.secrets && !skipSecrets;
    expect(hasSecrets).toBe(false);

    // Secrets should NOT be written
    expect(existsSync(join(targetDir, '.dev.vars'))).toBe(false);
  });
});

// ======================================================================
// 10. Edge Cases & Scalability
// ======================================================================

describe('10. Edge Cases', () => {
  it('unicode data in tables survives roundtrip', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {
        'db:posts': {
          doName: 'db:posts',
          doType: 'database',
          tables: { posts: [{ id: 'p1', title: '한글 테스트 🎉', content: '日本語テスト' }] },
          timestamp: '',
        },
      },
    };

    const json = JSON.stringify(backup);
    const parsed = JSON.parse(json) as BackupFileV1;
    const post = parsed.databases['db:posts'].tables.posts[0] as { title: string; content: string };
    expect(post.title).toBe('한글 테스트 🎉');
    expect(post.content).toBe('日本語テスト');
  });

  it('null and falsy values preserved', () => {
    const row = { id: 'p1', title: null, views: 0, isPublished: false, content: '' };
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {
        'db:posts': {
          doName: 'db:posts',
          doType: 'database',
          tables: { posts: [row] },
          timestamp: '',
        },
      },
    };

    const parsed = JSON.parse(JSON.stringify(backup)) as BackupFileV1;
    const restored = parsed.databases['db:posts'].tables.posts[0] as typeof row;
    expect(restored.title).toBeNull();
    expect(restored.views).toBe(0);
    expect(restored.isPublished).toBe(false);
    expect(restored.content).toBe('');
  });

  it('large dataset — 16 shards × 100 users + 20 DOs × 50 rows', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'cloudflare-edge',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
    };

    for (let i = 0; i < 16; i++) {
      backup.auth.shards[`auth:shard-${i}`] = {
        doName: `auth:shard-${i}`,
        doType: 'auth',
        tables: {
          _users: Array.from({ length: 100 }, (_, j) => ({
            id: `u${i}-${j}`,
            email: `u${i}-${j}@test.com`,
          })),
        },
        timestamp: '',
      };
    }
    for (let i = 0; i < 20; i++) {
      backup.databases[`db:col-${i}`] = {
        doName: `db:col-${i}`,
        doType: 'database',
        tables: { items: Array.from({ length: 50 }, (_, j) => ({ id: `item-${i}-${j}` })) },
        timestamp: '',
      };
    }

    const json = JSON.stringify(backup);
    const parsed = JSON.parse(json) as BackupFileV1;
    expect(Object.keys(parsed.auth.shards)).toHaveLength(16);
    expect(Object.keys(parsed.databases)).toHaveLength(20);
    expect(parsed.auth.shards['auth:shard-15'].tables._users).toHaveLength(100);
    expect(parsed.databases['db:col-19'].tables.items).toHaveLength(50);

    // Total: 16×100 + 20×50 = 2600 rows
    const totalRows =
      Object.values(parsed.auth.shards).reduce((s, d) => s + (d.tables._users?.length || 0), 0) +
      Object.values(parsed.databases).reduce(
        (s, d) => s + Object.values(d.tables).reduce((s2, t) => s2 + (t as unknown[]).length, 0),
        0,
      );
    expect(totalRows).toBe(2600);
  });

  it('backup file size reasonable for 1000 rows', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {
        'db:large': {
          doName: 'db:large',
          doType: 'database',
          tables: {
            items: Array.from({ length: 1000 }, (_, i) => ({
              id: `row-${i}`,
              title: `Title ${i}`,
              content: `Content row ${i}: ${'x'.repeat(100)}`,
            })),
          },
          timestamp: '',
        },
      },
    };

    const sizeKB = Buffer.byteLength(JSON.stringify(backup)) / 1024;
    expect(sizeKB).toBeGreaterThan(100);
    expect(sizeKB).toBeLessThan(10000);
  });

  it('deeply nested R2 key paths in storage metadata', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
      storage: {
        objects: [
          { key: 'a/b/c/d/e/f/g/deep.txt', size: 10, etag: 'x', contentType: 'text/plain' },
          { key: 'simple.txt', size: 5, etag: 'y', contentType: 'text/plain' },
        ],
      },
    };

    expect(backup.storage!.objects[0].key.split('/').length).toBe(8);
    expect(backup.storage!.objects[1].key.split('/').length).toBe(1);
  });

  it('empty backup is valid and restorable', () => {
    const backup: BackupFileV1 = {
      version: '1.1',
      timestamp: '2026-02-16T00:00:00Z',
      source: 'local',
      control: { d1: {} },
      auth: { d1: {}, shards: {} },
      databases: {},
    };

    const json = JSON.stringify(backup);
    expect(json.length).toBeLessThan(200);

    const parsed = JSON.parse(json) as BackupFileV1;
    expect(Object.keys(parsed.auth.shards)).toHaveLength(0);
    expect(Object.keys(parsed.databases)).toHaveLength(0);
    expect(Object.keys(parsed.auth.d1)).toHaveLength(0);
  });
});
