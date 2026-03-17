/**
 * Update notifier — checks npm registry for newer versions.
 *
 * - Caches results in ~/.edgebase/update-check.json (24h TTL)
 * - Non-blocking: failures are silently ignored
 * - Skipped in quiet/json mode and CI environments
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { parseSemver, semverDiff } from '../commands/upgrade.js';
import { isQuiet } from './cli-context.js';
import { npmCommand } from './npm.js';

const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

interface UpdateCache {
  latest: string;
  checkedAt: number;
}

function updateCheckDir(): string {
  return join(homedir(), '.edgebase');
}

function updateCheckFile(): string {
  return join(updateCheckDir(), 'update-check.json');
}

function loadCachedUpdate(): UpdateCache | null {
  try {
    const cacheFile = updateCheckFile();
    if (!existsSync(cacheFile)) return null;

    const cache = JSON.parse(readFileSync(cacheFile, 'utf-8')) as Partial<UpdateCache>;
    if (typeof cache.latest !== 'string' || typeof cache.checkedAt !== 'number') return null;

    return {
      latest: cache.latest,
      checkedAt: cache.checkedAt,
    };
  } catch {
    return null;
  }
}

function saveCachedUpdate(latest: string): void {
  try {
    const cacheFile = updateCheckFile();
    const cacheDir = dirname(cacheFile);
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      cacheFile,
      JSON.stringify({ latest, checkedAt: Date.now() } satisfies UpdateCache),
    );
  } catch {
    // Cache writes are best-effort only.
  }
}

function isNewerVersion(current: string, candidate: string): boolean {
  const [cMajor, cMinor, cPatch] = parseSemver(current);
  const [nMajor, nMinor, nPatch] = parseSemver(candidate);

  if (nMajor !== cMajor) return nMajor > cMajor;
  if (nMinor !== cMinor) return nMinor > cMinor;
  return nPatch > cPatch;
}

/**
 * Check for available updates and print banner if outdated.
 * Safe to call at program exit — all errors are swallowed.
 */
export function checkForUpdates(currentVersion: string): void {
  if (isQuiet()) return;
  // Skip in CI environments
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) return;

  const cache = loadCachedUpdate();
  if (cache && Date.now() - cache.checkedAt < CHECK_INTERVAL) {
    if (
      cache.latest &&
      isNewerVersion(currentVersion, cache.latest) &&
      semverDiff(currentVersion, cache.latest) !== 'none'
    ) {
      printUpdateBanner(currentVersion, cache.latest);
    }
    return;
  }

  try {
    // Query npm registry (3s timeout to avoid blocking)
    const latest = execFileSync(npmCommand(), ['show', 'edgebase', 'version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();

    if (!latest) return;

    saveCachedUpdate(latest);

    if (isNewerVersion(currentVersion, latest) && semverDiff(currentVersion, latest) !== 'none') {
      printUpdateBanner(currentVersion, latest);
    }
  } catch {
    // Network failure, npm not found, etc. — silently ignore
  }
}

function printUpdateBanner(current: string, latest: string): void {
  const msg1 = `  Update available: ${current} → ${latest}  `;
  const msg2 = `  Run ${chalk.cyan('npx edgebase upgrade')} to update  `;
  const width = Math.max(msg1.length, msg2.length) + 2;
  const border = '─'.repeat(width);

  console.log();
  console.log(chalk.yellow(`╭${border}╮`));
  console.log(chalk.yellow('│') + msg1.padEnd(width) + chalk.yellow('│'));
  console.log(chalk.yellow('│') + msg2.padEnd(width) + chalk.yellow('│'));
  console.log(chalk.yellow(`╰${border}╯`));
}
