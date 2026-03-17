import { Command } from 'commander';
import chalk from 'chalk';
import {
  enableTelemetry,
  disableTelemetry,
  getTelemetryStatus,
} from '../lib/telemetry.js';
import { isJson } from '../lib/cli-context.js';

/**
 * `npx edgebase telemetry` — Manage anonymous usage telemetry.
 *
 * Telemetry is opt-in only. When enabled, records:
 * - Command name, success/failure, duration
 * - No PII, no code, no file paths
 *
 * Data is stored locally in ~/.edgebase/telemetry.json.
 */
export const telemetryCommand = new Command('telemetry')
  .description('Manage anonymous usage telemetry');

telemetryCommand
  .command('enable')
  .description('Opt in to anonymous telemetry')
  .action(() => {
    enableTelemetry();
    if (isJson()) {
      console.log(JSON.stringify({ enabled: true }));
      return;
    }
    console.log(chalk.green('✓'), 'Telemetry enabled.');
    console.log(chalk.dim('  Anonymous usage data will be collected locally.'));
    console.log(chalk.dim('  No personal data is ever transmitted.'));
  });

telemetryCommand
  .command('disable')
  .description('Opt out of telemetry')
  .action(() => {
    disableTelemetry();
    if (isJson()) {
      console.log(JSON.stringify({ enabled: false }));
      return;
    }
    console.log(chalk.green('✓'), 'Telemetry disabled.');
  });

telemetryCommand
  .command('status')
  .description('Show current telemetry status')
  .action(() => {
    const { enabled, eventCount } = getTelemetryStatus();
    if (isJson()) {
      console.log(JSON.stringify({ enabled, eventCount }));
      return;
    }
    console.log(chalk.blue('📊 Telemetry Status'));
    console.log(`  Enabled: ${enabled ? chalk.green('yes') : chalk.red('no')}`);
    console.log(`  Events recorded: ${eventCount}`);
    console.log();
    if (!enabled) {
      console.log(chalk.dim('  Run'), chalk.cyan('npx edgebase telemetry enable'), chalk.dim('to opt in.'));
    }
  });
