import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};

describe('describe command', () => {
  it('returns the live CLI surface as JSON', () => {
    const result = spawnSync(
      tsxCommand.command,
      [...tsxCommand.argsPrefix, 'src/index.ts', '--json', 'describe'],
      {
        cwd: packageDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          NO_COLOR: '1',
        },
        stdio: 'pipe',
        ...tsxExecOptions,
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      status: 'success',
      cli: {
        name: 'edgebase',
        commands: expect.arrayContaining([
          expect.objectContaining({
            name: 'backup',
            subcommands: expect.arrayContaining([
              expect.objectContaining({ name: 'restore', path: 'backup restore' }),
            ]),
          }),
          expect.objectContaining({
            name: 'describe',
          }),
        ]),
        globalOptions: expect.arrayContaining([
          expect.objectContaining({ long: '--json' }),
          expect.objectContaining({ long: '--non-interactive' }),
        ]),
      },
    });
    expect(result.stderr).toBe('');
  });

  it('can limit the output to a specific command path', () => {
    const result = spawnSync(
      tsxCommand.command,
      [
        ...tsxCommand.argsPrefix,
        'src/index.ts',
        '--json',
        'describe',
        '--command',
        'backup restore',
      ],
      {
        cwd: packageDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          NO_COLOR: '1',
        },
        stdio: 'pipe',
        ...tsxExecOptions,
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      status: 'success',
      command: expect.objectContaining({
        name: 'restore',
        path: 'backup restore',
      }),
    });
    expect(result.stderr).toBe('');
  });
});
