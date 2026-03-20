/**
 * Tests for Cloudflare authentication helper module (cf-auth.ts).
 * Covers: parseWhoamiOutput, loadCachedAccountId, saveCachedAccountId, ensureWranglerToml.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseWhoamiOutput,
  loadCachedAccountId,
  saveCachedAccountId,
  ensureWranglerToml,
} from '../src/lib/cf-auth.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-cfauth-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. parseWhoamiOutput — Wrangler whoami table parsing
// ======================================================================

describe('parseWhoamiOutput', () => {
  it('parses single account from wrangler whoami table output', () => {
    const output = `
 ⛅ wrangler 3.99.0
-------------------

 Getting User settings...
 👋 You are logged in with an OAuth Token, associated with the email user@example.com!
┌──────────────────────────────────────┬──────────────────────────────────┐
│ Account Name                         │ Account ID                       │
├──────────────────────────────────────┼──────────────────────────────────┤
│ John's Account                       │ abcdef1234567890abcdef1234567890 │
└──────────────────────────────────────┴──────────────────────────────────┘
`;
    const accounts = parseWhoamiOutput(output);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe('abcdef1234567890abcdef1234567890');
    expect(accounts[0].name).toContain('John');
  });

  it('parses multiple accounts', () => {
    const output = `
┌──────────────────────────────────────┬──────────────────────────────────┐
│ Account Name                         │ Account ID                       │
├──────────────────────────────────────┼──────────────────────────────────┤
│ Personal Account                     │ aaaa1111bbbb2222cccc3333dddd4444 │
├──────────────────────────────────────┼──────────────────────────────────┤
│ Work Account                         │ 11112222333344445555666677778888 │
└──────────────────────────────────────┴──────────────────────────────────┘
`;
    const accounts = parseWhoamiOutput(output);
    expect(accounts).toHaveLength(2);
    expect(accounts[0].id).toBe('aaaa1111bbbb2222cccc3333dddd4444');
    expect(accounts[0].name).toContain('Personal');
    expect(accounts[1].id).toBe('11112222333344445555666677778888');
    expect(accounts[1].name).toContain('Work');
  });

  it('returns empty array for unauthenticated output', () => {
    const output = 'You are not authenticated. Please run `wrangler login`.';
    const accounts = parseWhoamiOutput(output);
    expect(accounts).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    const accounts = parseWhoamiOutput('');
    expect(accounts).toHaveLength(0);
  });

  it('handles malformed output gracefully', () => {
    const output = `
⛅ wrangler 3.99.0
-------------------
Some random output without any account table
Error: No OAuth token found
`;
    const accounts = parseWhoamiOutput(output);
    expect(accounts).toHaveLength(0);
  });

  it('does not match non-account hex strings (e.g., shorter than 32 chars)', () => {
    const output = 'Some hash: abcdef12345 is not a full account ID';
    const accounts = parseWhoamiOutput(output);
    expect(accounts).toHaveLength(0);
  });
});

// ======================================================================
// 2. loadCachedAccountId / saveCachedAccountId — .edgebase/cloudflare.json
// ======================================================================

describe('cached account ID', () => {
  it('returns null when .edgebase/cloudflare.json does not exist', () => {
    const result = loadCachedAccountId(tmpDir);
    expect(result).toBeNull();
  });

  it('saves and loads account_id correctly', () => {
    const accountId = 'abcdef1234567890abcdef1234567890';
    const accountName = 'Test Account';
    saveCachedAccountId(tmpDir, accountId, accountName);

    const loaded = loadCachedAccountId(tmpDir);
    expect(loaded).toBe(accountId);

    // Verify file contents
    const cachePath = join(tmpDir, '.edgebase', 'cloudflare.json');
    expect(existsSync(cachePath)).toBe(true);
    const data = JSON.parse(readFileSync(cachePath, 'utf-8'));
    expect(data.accountId).toBe(accountId);
    expect(data.accountName).toBe(accountName);
    expect(data.updatedAt).toBeTruthy();
  });

  it('creates .edgebase directory if missing', () => {
    expect(existsSync(join(tmpDir, '.edgebase'))).toBe(false);
    saveCachedAccountId(tmpDir, 'test', 'Test');
    expect(existsSync(join(tmpDir, '.edgebase'))).toBe(true);
  });

  it('handles corrupted JSON gracefully', () => {
    const edgebaseDir = join(tmpDir, '.edgebase');
    mkdirSync(edgebaseDir, { recursive: true });
    writeFileSync(join(edgebaseDir, 'cloudflare.json'), 'not valid json {{{', 'utf-8');

    const result = loadCachedAccountId(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null for JSON without accountId field', () => {
    const edgebaseDir = join(tmpDir, '.edgebase');
    mkdirSync(edgebaseDir, { recursive: true });
    writeFileSync(join(edgebaseDir, 'cloudflare.json'), '{"other": "data"}', 'utf-8');

    const result = loadCachedAccountId(tmpDir);
    expect(result).toBeNull();
  });
});

// ======================================================================
// 3. ensureWranglerToml — wrangler.toml creation/update
// ======================================================================

describe('ensureWranglerToml', () => {
  const testAccountId = 'abcdef1234567890abcdef1234567890';

  it('creates wrangler.toml from template when missing', () => {
    expect(existsSync(join(tmpDir, 'wrangler.toml'))).toBe(false);

    ensureWranglerToml(tmpDir, testAccountId);

    const wranglerPath = join(tmpDir, 'wrangler.toml');
    expect(existsSync(wranglerPath)).toBe(true);

    const content = readFileSync(wranglerPath, 'utf-8');
    expect(content).toContain(`account_id = "${testAccountId}"`);
    expect(content).toContain(`name = "${basename(tmpDir)}"`);
    expect(content).toContain('main = ".edgebase/runtime/server/src/index.ts"');
    expect(content).toContain('directory = ".edgebase/runtime/server/admin-build"');
    expect(content).toContain('compatibility_date');
    expect(content).toContain('[durable_objects]');
    expect(content).toContain('DatabaseDO');
    expect(content).toContain('AuthDO');
    expect(content).toContain('{ name = "ROOMS", class_name = "RoomsDO" }');
    expect(content).toContain('new_sqlite_classes = ["DatabaseDO", "AuthDO", "DatabaseLiveDO", "RoomsDO"]');
  });

  it('injects account_id into existing wrangler.toml without account_id', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, `name = "my-project"\nmain = ".edgebase/runtime/server/src/index.ts"\ncompatibility_date = "2025-02-10"\n`, 'utf-8');

    ensureWranglerToml(tmpDir, testAccountId);

    const content = readFileSync(wranglerPath, 'utf-8');
    expect(content).toContain(`account_id = "${testAccountId}"`);
    expect(content).toContain('name = "my-project"');
    expect(content).toContain('main = ".edgebase/runtime/server/src/index.ts"');
  });

  it('inserts account_id after the name line', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, `name = "my-project"\nmain = ".edgebase/runtime/server/src/index.ts"\n`, 'utf-8');

    ensureWranglerToml(tmpDir, testAccountId);

    const content = readFileSync(wranglerPath, 'utf-8');
    const lines = content.split('\n');
    const nameIdx = lines.findIndex(l => l.startsWith('name ='));
    const accountIdx = lines.findIndex(l => l.startsWith('account_id ='));
    expect(accountIdx).toBe(nameIdx + 1);
  });

  it('updates existing account_id in wrangler.toml', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, `name = "my-project"\naccount_id = "old_id_00000000000000000000"\nmain = ".edgebase/runtime/server/src/index.ts"\n`, 'utf-8');

    ensureWranglerToml(tmpDir, testAccountId);

    const content = readFileSync(wranglerPath, 'utf-8');
    expect(content).toContain(`account_id = "${testAccountId}"`);
    expect(content).not.toContain('old_id');
  });

  it('preserves all other wrangler.toml content', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    const original = `name = "my-project"
main = ".edgebase/runtime/server/src/index.ts"
compatibility_date = "2025-02-10"

[durable_objects]
bindings = [
  { name = "DATABASE", class_name = "DatabaseDO" },
]

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "my-storage"
`;
    writeFileSync(wranglerPath, original, 'utf-8');

    ensureWranglerToml(tmpDir, testAccountId);

    const content = readFileSync(wranglerPath, 'utf-8');
    expect(content).toContain(`account_id = "${testAccountId}"`);
    expect(content).toContain('[durable_objects]');
    expect(content).toContain('DatabaseDO');
    expect(content).toContain('[[r2_buckets]]');
    expect(content).toContain('my-storage');
  });

  it('returns the path to wrangler.toml', () => {
    const result = ensureWranglerToml(tmpDir, testAccountId);
    expect(result).toBe(join(tmpDir, 'wrangler.toml'));
  });

  it('derives a unique worker name for generic edgebase folders', () => {
    const projectDir = join(tmpDir, 'collab-board', 'edgebase');
    mkdirSync(projectDir, { recursive: true });

    ensureWranglerToml(projectDir, testAccountId);

    const content = readFileSync(join(projectDir, 'wrangler.toml'), 'utf-8');
    expect(content).toContain('name = "collab-board-edgebase"');
  });

  it('handles wrangler.toml without name field', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, `main = ".edgebase/runtime/server/src/index.ts"\ncompatibility_date = "2025-02-10"\n`, 'utf-8');

    ensureWranglerToml(tmpDir, testAccountId);

    const content = readFileSync(wranglerPath, 'utf-8');
    // account_id should be inserted at the top
    expect(content.startsWith(`account_id = "${testAccountId}"`)).toBe(true);
  });
});
