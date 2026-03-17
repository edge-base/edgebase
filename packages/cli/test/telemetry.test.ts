/**
 * Tests for telemetry module (telemetry.ts).
 * Uses a global variable to redirect homedir() to a temp directory.
 * The telemetry module uses lazy path resolution (homedir() called per-function).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;

// Mock homedir() to use a global pointer — set per test
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    homedir: () => (global as Record<string, unknown>).__testHomeDir as string ?? original.homedir(),
  };
});

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-telemetry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  (global as Record<string, unknown>).__testHomeDir = tmpDir;
});

afterEach(() => {
  delete (global as Record<string, unknown>).__testHomeDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('telemetry', () => {
  it('isTelemetryEnabled returns false when no file exists', async () => {
    const { isTelemetryEnabled } = await import('../src/lib/telemetry.js');
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('enableTelemetry creates telemetry file', async () => {
    const { enableTelemetry, isTelemetryEnabled } = await import('../src/lib/telemetry.js');
    enableTelemetry();
    expect(isTelemetryEnabled()).toBe(true);
    const filePath = join(tmpDir, '.edgebase', 'telemetry.json');
    expect(existsSync(filePath)).toBe(true);
  });

  it('disableTelemetry sets enabled to false', async () => {
    const { enableTelemetry, disableTelemetry, isTelemetryEnabled } = await import('../src/lib/telemetry.js');
    enableTelemetry();
    expect(isTelemetryEnabled()).toBe(true);
    disableTelemetry();
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('recordEvent does nothing when disabled', async () => {
    const { recordEvent, getTelemetryStatus } = await import('../src/lib/telemetry.js');
    recordEvent('deploy', true, 1234);
    const status = getTelemetryStatus();
    expect(status.eventCount).toBe(0);
  });

  it('recordEvent stores events when enabled', async () => {
    const { enableTelemetry, recordEvent } = await import('../src/lib/telemetry.js');
    enableTelemetry();
    recordEvent('deploy', true, 1234);
    recordEvent('backup', false, 5678);

    const filePath = join(tmpDir, '.edgebase', 'telemetry.json');
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.enabled).toBe(true);
    // Because all tests share the same module instance, events may accumulate.
    // Check that our events are present:
    const deployEvent = data.events.find((e: { command: string }) => e.command === 'deploy');
    const backupEvent = data.events.find((e: { command: string }) => e.command === 'backup');
    expect(deployEvent).toBeTruthy();
    expect(deployEvent.success).toBe(true);
    expect(deployEvent.durationMs).toBe(1234);
    expect(backupEvent).toBeTruthy();
    expect(backupEvent.success).toBe(false);
  });

  it('handles corrupted telemetry file gracefully', async () => {
    const { isTelemetryEnabled } = await import('../src/lib/telemetry.js');
    const dir = join(tmpDir, '.edgebase');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'telemetry.json'), 'not valid json {{{');
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('getTelemetryStatus returns enabled state', async () => {
    const { enableTelemetry, getTelemetryStatus } = await import('../src/lib/telemetry.js');
    enableTelemetry();
    const status = getTelemetryStatus();
    expect(status.enabled).toBe(true);
    expect(status.eventCount).toBeGreaterThanOrEqual(0);
  });

  it('showTelemetryNoticeOnce describes opt-in telemetry accurately', async () => {
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { showTelemetryNoticeOnce } = await import('../src/lib/telemetry.js');

    showTelemetryNoticeOnce();

    const output = infoSpy.mock.calls.flat().join('\n');
    expect(output).toContain('supports optional anonymous CLI telemetry');
    expect(output).toContain('disabled by default');
    expect(output).toContain('telemetry enable');
    expect(output).not.toContain('telemetry disable');

    const filePath = join(tmpDir, '.edgebase', 'telemetry.json');
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.noticeShown).toBe(true);
  });
});
