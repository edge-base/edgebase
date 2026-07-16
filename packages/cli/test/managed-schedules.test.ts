import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanFunctions } from '../src/lib/function-registry.js';
import {
  buildManagedScheduleManifest,
  extractFileScheduleTriggers,
} from '../src/lib/managed-schedules.js';

let projectDir: string;
let functionsDir: string;

beforeEach(() => {
  projectDir = join(tmpdir(), `edgebase-managed-schedules-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  functionsDir = join(projectDir, 'functions');
  mkdirSync(functionsDir, { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function writeFunction(relativePath: string, source: string): string {
  const filePath = join(functionsDir, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, source);
  return filePath;
}

describe('managed schedule source extraction', () => {
  it('does not reject ordinary function-declaration and imported HTTP handlers', () => {
    writeFunction('default-handler.ts', `
async function handler() { return new Response('ok'); }
export default handler;
`);
    writeFunction('imported-method.ts', `
import { handler } from './support.js';
export const GET = handler;
`);

    expect(scanFunctions(functionsDir)).toHaveLength(2);
  });

  it('collects default and named filesystem schedules from static declarations', () => {
    const filePath = writeFunction('jobs.ts', `
import { defineFunction as job } from '@edge-base/shared';
const NIGHTLY = ' 0 2 * * * ';
const nightly = job({
  trigger: { type: 'schedule', cron: NIGHTLY },
  handler: async () => undefined,
});
export default nightly;
export const hourly = job({
  trigger: { type: 'schedule', cron: '15 * * * *' },
  handler: async () => undefined,
});
export const onInsert = job({
  trigger: { type: 'db', table: 'items', event: 'insert' },
  handler: async () => undefined,
});
`);

    expect(extractFileScheduleTriggers(filePath)).toEqual([
      { exportName: 'default', cron: '0 2 * * *' },
      { exportName: 'hourly', cron: '15 * * * *' },
    ]);
    expect(scanFunctions(functionsDir)[0].definedFunctionExports).toEqual(['hourly', 'onInsert']);
  });

  it('fails closed for dynamic, unsupported, or unregistered schedule declarations', () => {
    const dynamic = writeFunction('dynamic.ts', `
import { defineFunction } from '@edge-base/shared';
export default defineFunction({
  trigger: { type: 'schedule', cron: process.env.CRON! },
  handler: async () => undefined,
});
`);
    expect(() => extractFileScheduleTriggers(dynamic)).toThrow(/static string literal/i);

    const unsupported = writeFunction('unsupported.ts', `
import { defineFunction } from '@edge-base/shared';
export default defineFunction({
  trigger: { type: 'schedule', cron: '0 3 L * *' },
  handler: async () => undefined,
});
`);
    expect(() => extractFileScheduleTriggers(unsupported)).toThrow(/portable EdgeBase cron/i);

    const hidden = writeFunction('hidden.ts', `
import { defineFunction } from '@edge-base/shared';
const hidden = defineFunction({
  trigger: { type: 'schedule', cron: '0 4 * * *' },
  handler: async () => undefined,
});
void hidden;
`);
    expect(() => extractFileScheduleTriggers(hidden)).toThrow(/not an exported default or named function/i);

    const method = writeFunction('method.ts', `
import { defineFunction } from '@edge-base/shared';
export const GET = defineFunction({
  trigger: { type: 'schedule', cron: '0 5 * * *' },
  handler: async () => undefined,
});
`);
    expect(() => extractFileScheduleTriggers(method)).toThrow(/HTTP method export.*cannot declare a schedule/i);
  });
});

describe('managed schedule manifest', () => {
  it('preserves source identities while deduping provider expressions deterministically', () => {
    writeFunction('jobs.ts', `
import { defineFunction } from '@edge-base/shared';
export default defineFunction({
  trigger: { type: 'schedule', cron: '0 2 * * *' },
  handler: async () => undefined,
});
export const second = defineFunction({
  trigger: { type: 'schedule', cron: '0 2 * * *' },
  handler: async () => undefined,
});
`);
    const functions = scanFunctions(functionsDir);
    const config = {
      plugins: [{
        name: 'synthetic-plugin',
        functions: {
          cleanup: { trigger: { type: 'schedule', cron: '0 2 * * *' }, handler: '__EDGEBASE_FUNCTION__' },
        },
      }],
      cloudflare: { extraCrons: ['15 * * * *', ' 15   * * * * ', '0 2 * * *'] },
    };

    const first = buildManagedScheduleManifest(functions, config);
    const second = buildManagedScheduleManifest([...functions].reverse(), config);

    expect(first).toEqual(second);
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.entries.map((entry) => entry.id)).toEqual([
      'app-function:jobs#default',
      'app-function:jobs#second',
      'extra-cron:0 2 * * *',
      'extra-cron:15 * * * *',
      'plugin-function:synthetic-plugin/cleanup',
      'system:maintenance',
    ]);
    expect(first.crons).toEqual(['0 2 * * *', '0 3 * * *', '15 * * * *']);
    expect(first.entries.filter((entry) => entry.cron === '0 2 * * *')).toHaveLength(4);
  });

  it('discovers a future schedule file and rejects duplicate stable identities', () => {
    writeFunction('existing.ts', 'export const GET = async () => new Response("ok");\n');
    const before = buildManagedScheduleManifest(scanFunctions(functionsDir), {});
    expect(before.entries.map((entry) => entry.id)).toEqual(['system:maintenance']);

    writeFunction('future.ts', `
import { defineFunction } from '@edge-base/shared';
export default defineFunction({
  trigger: { type: 'schedule', cron: '5 6 * * *' },
  handler: async () => undefined,
});
`);
    const after = buildManagedScheduleManifest(scanFunctions(functionsDir), {});
    expect(after.entries.map((entry) => entry.id)).toContain('app-function:future#default');
    expect(after.digest).not.toBe(before.digest);

    expect(() => buildManagedScheduleManifest([
      { name: 'future', relativePath: 'future.ts', scheduleTriggers: [{ exportName: 'default', cron: '5 6 * * *' }] },
      { name: 'future', relativePath: 'duplicate.ts', scheduleTriggers: [{ exportName: 'default', cron: '5 6 * * *' }] },
    ], {})).toThrow(/Duplicate managed schedule identity/);
  });
});
