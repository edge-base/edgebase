import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};

function createHomeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edgebase-cli-telemetry-'));
  tempDirs.push(dir);
  return dir;
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCliResult(
  homeDir: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxCommand.command, [...tsxCommand.argsPrefix, 'src/index.ts', ...args], {
      cwd: packageDir,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        NO_COLOR: '1',
        ...extraEnv,
      },
      stdio: 'pipe',
      ...tsxExecOptions,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

async function runCli(homeDir: string, args: string[]): Promise<string> {
  const result = await runCliResult(homeDir, args);
  if (result.status !== 0) {
    throw new Error(`CLI exited with ${result.status}: ${result.stderr}`);
  }
  return result.stdout;
}

function readTelemetry(homeDir: string): {
  enabled: boolean;
  noticeShown?: boolean;
  events: Array<{ command: string; success: boolean; durationMs: number; timestamp: string }>;
} {
  const filePath = join(homeDir, '.edgebase', 'telemetry.json');
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

describe('CLI entrypoint telemetry', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records the full subcommand path for successful commands', async () => {
    const homeDir = createHomeDir();

    await runCli(homeDir, ['telemetry', 'enable']);
    await runCli(homeDir, ['telemetry', 'status']);

    const data = readTelemetry(homeDir);
    expect(data.enabled).toBe(true);
    expect(data.events).toEqual([
      expect.objectContaining({
        command: 'edgebase telemetry enable',
        success: true,
      }),
      expect.objectContaining({
        command: 'edgebase telemetry status',
        success: true,
      }),
    ]);
  });

  it('records failed commands with their requested path', async () => {
    const homeDir = createHomeDir();

    await runCli(homeDir, ['telemetry', 'enable']);

    const result = await runCliResult(homeDir, ['definitely-missing']);

    expect(result.status).toBe(1);

    const data = readTelemetry(homeDir);
    expect(data.events).toEqual([
      expect.objectContaining({
        command: 'edgebase telemetry enable',
        success: true,
      }),
      expect.objectContaining({
        command: 'edgebase definitely-missing',
        success: false,
      }),
    ]);
  });

  it('keeps first-run JSON mode output machine-readable', async () => {
    const homeDir = createHomeDir();

    const output = await runCli(homeDir, ['--json', 'telemetry', 'status']);

    expect(JSON.parse(output)).toEqual({
      enabled: false,
      eventCount: 0,
    });
  });

  it('fails fast with a clear error when Node.js is too old', async () => {
    const homeDir = createHomeDir();

    const result = await runCliResult(
      homeDir,
      ['telemetry', 'status'],
      { EDGEBASE_NODE_VERSION_OVERRIDE: '21.99.0' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Node.js >= 22.0.0');
    expect(result.stderr).toContain('Install Node.js 22.0.0 or newer');
  });
});
