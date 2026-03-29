#!/usr/bin/env node

import { Command, CommanderError } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initCommand } from './commands/init.js';
import { devCommand } from './commands/dev.js';
import { deployCommand } from './commands/deploy.js';
import { destroyCommand } from './commands/destroy.js';
import { secretCommand } from './commands/secret.js';
import { keysCommand } from './commands/keys.js';
import { backupCommand } from './commands/backup.js';
import { exportCommand } from './commands/export.js';
import { typegenCommand } from './commands/typegen.js';
import { logsCommand } from './commands/logs.js';
import { migrationCommand } from './commands/migration.js';
import { migrateCommand } from './commands/migrate.js';
import { upgradeCommand } from './commands/upgrade.js';
import { seedCommand } from './commands/seed.js';
import { adminCommand } from './commands/admin.js';
import { neonCommand } from './commands/neon.js';
import { dockerCommand } from './commands/docker.js';
import { pluginsCommand } from './commands/plugins.js';
import { createPluginCommand } from './commands/create-plugin.js';
import { webhookTestCommand } from './commands/webhook-test.js';
import { completionCommand } from './commands/completion.js';
import { telemetryCommand } from './commands/telemetry.js';
import { describeCommand } from './commands/describe.js';
import { setContext } from './lib/cli-context.js';
import { isCliStructuredError, raiseCliError, renderStructuredIssue } from './lib/agent-contract.js';
import { assertSupportedNodeVersion } from './lib/node-version.js';
import { checkForUpdates } from './lib/update-check.js';
import { recordEvent, showTelemetryNoticeOnce } from './lib/telemetry.js';

// ─── Dynamic version from package.json ───
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

function hasRawFlag(rawArgs: string[], longFlag: string, shortFlag?: string): boolean {
  return rawArgs.some((arg) => {
    if (arg === longFlag) return true;
    if (!shortFlag || !arg.startsWith('-') || arg.startsWith('--')) return false;
    return arg.slice(1).includes(shortFlag.slice(1));
  });
}

program
  .name('edgebase')
  .description('EdgeBase CLI — Serverless BaaS on Cloudflare Edge')
  .version(pkg.version)
  .option('-v, --verbose', 'Show detailed output')
  .option('-q, --quiet', 'Suppress non-essential output')
  .option('--json', 'Output results as JSON')
  .option('--non-interactive', 'Disable prompts and return structured input/user-action requirements');

// ─── First-run telemetry notice ───
const rawArgs = process.argv.slice(2);
setContext({
  verbose: hasRawFlag(rawArgs, '--verbose', '-v'),
  quiet: hasRawFlag(rawArgs, '--quiet', '-q'),
  json: hasRawFlag(rawArgs, '--json'),
  nonInteractive: hasRawFlag(rawArgs, '--non-interactive'),
});
showTelemetryNoticeOnce({
  suppressOutput:
    hasRawFlag(rawArgs, '--json')
    || hasRawFlag(rawArgs, '--quiet', '-q'),
});

// ─── Global hooks ───

let _startTime = Date.now();
let _telemetryCommandPath: string | null = null;

function buildCommandPath(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;

  while (current) {
    names.push(current.name());
    current = current.parent;
  }

  return names.reverse().join(' ');
}

function resolveCommandPath(actionCommand?: Command, rawArgs = process.argv.slice(2)): string {
  if (actionCommand) {
    return buildCommandPath(actionCommand);
  }

  const path = [program.name()];
  let current = program;

  for (const token of rawArgs) {
    if (!token || token === '--') break;
    if (token.startsWith('-')) continue;

    const next = current.commands.find(
      (candidate) => candidate.name() === token || candidate.aliases().includes(token),
    );

    if (!next) {
      path.push(token);
      break;
    }

    path.push(next.name());
    current = next;
  }

  return path.join(' ');
}

program.exitOverride();

program.hook('preAction', (thisCommand, actionCommand) => {
  const opts = thisCommand.opts();
  setContext({
    verbose: !!opts.verbose,
    quiet: !!opts.quiet,
    json: !!opts.json,
    nonInteractive: !!opts.nonInteractive,
  });
  try {
    assertSupportedNodeVersion();
  } catch (error) {
    raiseCliError({
      code: 'unsupported_node_version',
      message: (error as Error).message,
      hint: 'Install Node.js 20.19.0 or newer, then rerun the command.',
    });
  }
  _startTime = Date.now();
  _telemetryCommandPath = resolveCommandPath(actionCommand);
});

program.hook('postAction', (_thisCommand, actionCommand) => {
  _telemetryCommandPath = resolveCommandPath(actionCommand);
  recordEvent(_telemetryCommandPath, true, Date.now() - _startTime);
});

// ─── Core ───
program.addCommand(initCommand);
program.addCommand(devCommand);
program.addCommand(deployCommand);
program.addCommand(destroyCommand);
program.addCommand(logsCommand);
program.addCommand(upgradeCommand);

// ─── Database ───
program.addCommand(migrationCommand);
program.addCommand(migrateCommand);
program.addCommand(seedCommand);
program.addCommand(backupCommand);
program.addCommand(exportCommand);
program.addCommand(typegenCommand);
program.addCommand(neonCommand);

// ─── Security ───
program.addCommand(secretCommand);
program.addCommand(keysCommand);
program.addCommand(adminCommand);

// ─── Plugins & Tools ───
program.addCommand(pluginsCommand);
program.addCommand(createPluginCommand);
program.addCommand(dockerCommand);
program.addCommand(webhookTestCommand);
program.addCommand(completionCommand);
program.addCommand(describeCommand);
program.addCommand(telemetryCommand);

// ─── Help Text Grouping ───
program.addHelpText('after', `
Commands by category:
  Core:         init, dev (dv), deploy (dp), destroy, logs (l), upgrade (up)
  Database:     migration (mg), migrate, seed, backup (bk), export, typegen (tg), neon
  Security:     secret, keys, admin
  Plugins:      plugins, create-plugin, docker, webhook-test
  Utilities:    completion, describe, telemetry

Environment variables:
  NO_COLOR=1              Disable colored output
  EDGEBASE_SERVICE_KEY    Service Key for backup/export/admin commands
  EDGEBASE_URL            Default server URL for remote commands
`);

let parseFailed = false;

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const commandPath = _telemetryCommandPath ?? resolveCommandPath(undefined, process.argv.slice(2));
  recordEvent(commandPath, false, Date.now() - _startTime);

  if (error instanceof CommanderError) {
    parseFailed = true;
    process.exitCode = error.exitCode;
  } else if (isCliStructuredError(error)) {
    parseFailed = true;
    process.exitCode = error.exitCode;
    renderStructuredIssue(error.payload);
  } else {
    throw error;
  }
}

// ─── Post-run update check (non-blocking) ───
const currentCommand = process.argv[2];
if (!parseFailed && !['init', 'dev', 'dv'].includes(currentCommand ?? '')) {
  checkForUpdates(pkg.version);
}
