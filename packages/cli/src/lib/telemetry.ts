/**
 * Telemetry — opt-in local usage statistics.
 *
 * Currently stores events locally in ~/.edgebase/telemetry.json.
 * No remote transmission — reserved for future analytics endpoint.
 *
 * Data collected (when enabled):
 * - Command name (e.g., "deploy", "backup create")
 * - Success/failure boolean
 * - Duration in milliseconds
 * - Timestamp
 *
 * No PII, no code content, no file paths.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MAX_EVENTS = 1000;

// Lazy path resolution — allows tests to mock homedir()
function telemetryDir(): string { return join(homedir(), '.edgebase'); }
function telemetryFile(): string { return join(telemetryDir(), 'telemetry.json'); }

interface TelemetryEvent {
  command: string;
  success: boolean;
  durationMs: number;
  timestamp: string;
}

interface TelemetryData {
  enabled: boolean;
  noticeShown?: boolean;
  events: TelemetryEvent[];
}

function loadData(): TelemetryData {
  try {
    if (existsSync(telemetryFile())) {
      return JSON.parse(readFileSync(telemetryFile(), 'utf-8'));
    }
  } catch { /* corrupted file — treat as disabled */ }
  return { enabled: false, events: [] };
}

function saveData(data: TelemetryData): void {
  if (!existsSync(telemetryDir())) mkdirSync(telemetryDir(), { recursive: true });
  writeFileSync(telemetryFile(), JSON.stringify(data, null, 2));
}

/** Check if telemetry is enabled. */
export function isTelemetryEnabled(): boolean {
  return loadData().enabled;
}

/** Record a command execution event (no-op if disabled). */
export function recordEvent(
  command: string,
  success: boolean,
  durationMs: number,
): void {
  const data = loadData();
  if (!data.enabled) return;

  data.events.push({
    command,
    success,
    durationMs,
    timestamp: new Date().toISOString(),
  });

  // Keep only the most recent events
  if (data.events.length > MAX_EVENTS) {
    data.events = data.events.slice(-MAX_EVENTS);
  }

  try {
    saveData(data);
  } catch { /* non-fatal */ }
}

/** Enable telemetry collection. */
export function enableTelemetry(): void {
  const data = loadData();
  data.enabled = true;
  saveData(data);
}

/** Disable telemetry collection. Preserves existing events. */
export function disableTelemetry(): void {
  const data = loadData();
  data.enabled = false;
  saveData(data);
}

interface TelemetryNoticeOptions {
  suppressOutput?: boolean;
}

/**
 * Show a one-time privacy notice on first CLI run.
 * No-op if the notice has already been shown.
 */
export function showTelemetryNoticeOnce(options?: TelemetryNoticeOptions): void {
  const data = loadData();
  if (data.noticeShown) return;
  if (options?.suppressOutput) return;

  console.log();
  console.log('\u{1F4CA} EdgeBase supports optional anonymous CLI telemetry.');
  console.log('   Telemetry is disabled by default.');
  console.log('   Run \'npx edgebase telemetry enable\' to opt in.');
  console.log();

  data.noticeShown = true;
  try {
    saveData(data);
  } catch { /* non-fatal */ }
}

/** Get telemetry status for display. */
export function getTelemetryStatus(): { enabled: boolean; eventCount: number } {
  const data = loadData();
  return { enabled: data.enabled, eventCount: data.events.length };
}
