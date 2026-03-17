import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setContext } from '../src/lib/cli-context.js';

const execFileSync = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync,
}));

let tmpDir: string;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  tmpDir = join(tmpdir(), `eb-cfauth-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  setContext({ verbose: false, quiet: false, json: true, nonInteractive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  setContext({ verbose: false, quiet: false, json: false, nonInteractive: false });
});

describe('ensureCloudflareAuth agent mode', () => {
  it('returns a structured user-action requirement when browser login would be needed', async () => {
    execFileSync.mockImplementation(() => {
      throw new Error('not authenticated');
    });

    const { ensureCloudflareAuth } = await import('../src/lib/cf-auth.js');

    await expect(ensureCloudflareAuth(tmpDir, false)).rejects.toMatchObject({
      payload: expect.objectContaining({
        status: 'needs_user_action',
        code: 'cloudflare_login_required',
        action: expect.objectContaining({
          type: 'open_browser',
        }),
      }),
    });
  });
});
