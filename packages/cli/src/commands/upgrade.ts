import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import chalk from 'chalk';
import { raiseCliError, raiseNeedsInput } from '../lib/agent-contract.js';
import { isJson, isNonInteractive } from '../lib/cli-context.js';
import { npmCommand } from '../lib/npm.js';

// ─── Package Manager Detection ───

type PackageManager = 'pnpm' | 'yarn' | 'npm';

const EDGEBASE_PACKAGE_PREFIX = '@edgebase-fun/';
const LEGACY_EDGEBASE_PACKAGES = new Set(['edgebase']);

export function detectPackageManager(cwd: string): PackageManager {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export function findInstalledEdgeBasePackages(cwd: string): string[] {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };

  const allDependencies = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  };

  return Object.keys(allDependencies)
    .filter((name) => name.startsWith(EDGEBASE_PACKAGE_PREFIX) || LEGACY_EDGEBASE_PACKAGES.has(name))
    .sort();
}

// ─── Version Utilities ───

export interface VersionInfo {
  current: string;
  latest: string;
  diff: 'major' | 'minor' | 'patch' | 'none';
}

/**
 * Parse semver string into [major, minor, patch].
 */
export function parseSemver(version: string): [number, number, number] {
  const clean = version.replace(/^[^0-9]*/, '');
  const parts = clean.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Compare two semver strings and return the diff level.
 */
export function semverDiff(
  current: string,
  latest: string,
): 'major' | 'minor' | 'patch' | 'none' {
  const [cMajor, cMinor, cPatch] = parseSemver(current);
  const [lMajor, lMinor, lPatch] = parseSemver(latest);

  if (cMajor !== lMajor) return 'major';
  if (cMinor !== lMinor) return 'minor';
  if (cPatch !== lPatch) return 'patch';
  return 'none';
}

/**
 * Get the current version of a EdgeBase package from package.json.
 */
function getCurrentVersion(cwd: string, pkgName: string): string | null {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  const version = deps[pkgName];
  if (!version) return null;

  // Strip range prefix (^, ~, etc.)
  return version.replace(/^[^0-9]*/, '');
}

/**
 * Query npm registry for latest version.
 */
function getLatestVersion(pkgName: string): string | null {
  try {
    const result = execFileSync(npmCommand(), ['show', pkgName, 'version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Build the install/update command for the detected package manager.
 */
export interface UpdateCommandInvocation {
  command: string;
  args: string[];
  display: string;
}

export function buildUpdateCommand(
  pm: PackageManager,
  packages: string[],
  targetVersion?: string,
): UpdateCommandInvocation {
  const suffix = targetVersion ? `@${targetVersion}` : '@latest';
  const packageSpecs = packages.map((p) => `${p}${suffix}`);

  switch (pm) {
    case 'pnpm':
      return {
        command: 'pnpm',
        args: ['add', ...packageSpecs],
        display: `pnpm add ${packageSpecs.join(' ')}`,
      };
    case 'yarn':
      return {
        command: 'yarn',
        args: ['add', ...packageSpecs],
        display: `yarn add ${packageSpecs.join(' ')}`,
      };
    case 'npm':
    default:
      return {
        command: 'npm',
        args: ['install', ...packageSpecs],
        display: `npm install ${packageSpecs.join(' ')}`,
      };
  }
}

/**
 * Prompt user for confirmation.
 */
function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY || isNonInteractive()) {
    raiseNeedsInput({
      code: 'upgrade_confirmation_required',
      field: 'force',
      message: message.replace(/^\s+/, ''),
      hint: 'Review the upgrade plan, then rerun with --force to skip the confirmation prompt.',
      choices: [{
        label: 'Approve upgrade',
        value: 'force',
        args: ['--force'],
      }],
    });
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

// ─── Command ───

export const upgradeCommand = new Command('upgrade')
  .alias('up')
  .description('Upgrade EdgeBase packages')
  .option('--target <version>', 'Upgrade to a specific version')
  .option('--check', 'Dry-run: check for available upgrades without installing')
  .option('--force', 'Skip confirmation prompt')
  .action(
    async (options: { target?: string; check?: boolean; force?: boolean }) => {
      const cwd = process.cwd();
      const pm = detectPackageManager(cwd);
      const edgebasePackages = findInstalledEdgeBasePackages(cwd);

      console.log(`📦 Package manager: ${pm}`);
      console.log('');

      // 1. Check each EdgeBase package
      const versionInfos: Array<{ pkg: string; info: VersionInfo }> = [];
      let hasUpdatable = false;

      for (const pkgName of edgebasePackages) {
        const current = getCurrentVersion(cwd, pkgName);
        if (!current) continue; // Not installed

        const latest = options.target ?? getLatestVersion(pkgName);
        if (!latest) {
          console.warn(
            chalk.yellow('⚠'), `Could not fetch latest version for ${pkgName}`,
          );
          continue;
        }

        const diff = semverDiff(current, latest);
        versionInfos.push({
          pkg: pkgName,
          info: { current, latest, diff },
        });

        const diffLabel =
          diff === 'none'
            ? '✅ up to date'
            : `⬆️  ${diff} update available`;

        console.log(`   ${pkgName}: ${current} → ${latest} (${diffLabel})`);

        if (diff !== 'none') hasUpdatable = true;
      }

      if (versionInfos.length === 0) {
        console.log(
          chalk.yellow('⚠'), 'No EdgeBase packages found in package.json.',
        );
        return;
      }

      if (!hasUpdatable) {
        console.log('\n' + chalk.green('✅'), 'All EdgeBase packages are up to date!');
        return;
      }

      // 2. JSON output / Dry-run mode
      if (isJson() || options.check) {
        if (isJson()) {
          console.log(JSON.stringify({
            packages: versionInfos.map(v => ({
              name: v.pkg,
              current: v.info.current,
              latest: v.info.latest,
              diff: v.info.diff,
            })),
            hasUpdates: hasUpdatable,
          }));
        } else {
          console.log(
            '\n📋 Dry-run complete. Run without --check to apply updates.',
          );
        }
        return;
      }

      // 3. Major upgrade warning
      const hasMajor = versionInfos.some((v) => v.info.diff === 'major');
      if (hasMajor && !options.force) {
        console.log(
          '\n' + chalk.yellow('⚠'), 'Major version upgrade detected! This may include Breaking Changes.',
        );
        console.log(
          '   Review the changelog before proceeding.',
        );
        const ok = await confirm('\n   Proceed with upgrade?');
        if (!ok) {
          console.log(chalk.red('✗'), 'Upgrade cancelled.');
          return;
        }
      } else if (!options.force) {
        const ok = await confirm('\nProceed with upgrade?');
        if (!ok) {
          console.log(chalk.red('✗'), 'Upgrade cancelled.');
          return;
        }
      }

      // 4. Run update
      const packagesToUpdate = versionInfos
        .filter((v) => v.info.diff !== 'none')
        .map((v) => v.pkg);

      const invocation = buildUpdateCommand(pm, packagesToUpdate, options.target);
      console.log(`\n🔄 Running: ${invocation.display}`);

      try {
        execFileSync(invocation.command, invocation.args, { cwd, stdio: 'inherit' });
      } catch {
        raiseCliError({
          code: 'upgrade_failed',
          message: 'Update failed. Please try manually.',
          hint: `Run the package manager command directly if needed: ${invocation.display}`,
        });
      }

      // 5. Post-upgrade checks
      console.log('\n── Post-upgrade checks ──');

      // Check for moved config fields
      const configPath = path.join(cwd, 'edgebase.config.ts');
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const movedPatterns = [
          {
            pattern: /accessTokenTTL\s*:/,
            message:
              'accessTokenTTL is now nested under auth.session.accessTokenTTL',
          },
          {
            pattern: /refreshTokenTTL\s*:/,
            message:
              'refreshTokenTTL is now nested under auth.session.refreshTokenTTL',
          },
        ];

        for (const { pattern, message } of movedPatterns) {
          if (pattern.test(configContent)) {
            console.log('  ', chalk.yellow('⚠'), `Config update needed: ${message}`);
          }
        }
      }

      console.log('');
      console.log(chalk.green('✅'), 'Upgrade complete!');
      console.log(
        '   Run `npx edgebase deploy` to deploy the updated Worker.',
      );
    },
  );
