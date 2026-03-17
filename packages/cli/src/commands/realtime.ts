import { Command } from 'commander';
import chalk from 'chalk';
import { isCliStructuredError, raiseCliError } from '../lib/agent-contract.js';
import { isJson, isQuiet } from '../lib/cli-context.js';
import { provisionRealtime } from '../lib/realtime-provision.js';

export const realtimeCommand = new Command('realtime')
  .description('Manage Cloudflare Realtime SFU/TURN integration');

realtimeCommand
  .command('provision')
  .description('Create or reuse Cloudflare Realtime app and TURN key, then store local/Workers secrets')
  .option('--app-name <name>', 'Override the managed Cloudflare Realtime app name')
  .option('--turn-name <name>', 'Override the managed Cloudflare TURN key name')
  .option('--force-create-app', 'Mint a new Cloudflare Realtime app even if local secrets exist')
  .option('--force-create-turn', 'Mint a new Cloudflare TURN key even if local secrets exist')
  .option('--skip-workers-secrets', 'Only write local secrets; do not sync Wrangler Workers secrets')
  .action(async (options: {
    appName?: string;
    turnName?: string;
    forceCreateApp?: boolean;
    forceCreateTurn?: boolean;
    skipWorkersSecrets?: boolean;
  }) => {
    const projectDir = process.cwd();

    if (!isQuiet()) {
      console.log(chalk.blue('🎥 Provisioning Cloudflare Realtime...'));
      console.log();
    }

    try {
      const result = await provisionRealtime({
        projectDir,
        appName: options.appName,
        turnName: options.turnName,
        forceCreateApp: options.forceCreateApp,
        forceCreateTurn: options.forceCreateTurn,
        syncWorkersSecrets: !options.skipWorkersSecrets,
      });

      if (isJson()) {
        console.log(JSON.stringify({
          status: 'success',
          projectDir,
          app: {
            id: result.appId,
            name: result.appName,
            source: result.appSource,
          },
          turn: {
            keyId: result.turnKeyId,
            name: result.turnName,
            source: result.turnSource,
          },
          workersSecretsSynced: !options.skipWorkersSecrets && !(result.warnings?.length),
          warnings: result.warnings ?? [],
        }));
        return;
      }

      console.log(chalk.green('✓'), `Realtime app (${result.appSource}) → ${result.appName}`);
      console.log(chalk.dim(`  CF_REALTIME_APP_ID=${result.appId}`));
      console.log(chalk.green('✓'), `TURN key (${result.turnSource}) → ${result.turnName}`);
      console.log(chalk.dim(`  CF_REALTIME_TURN_KEY_ID=${result.turnKeyId}`));
      console.log();
      console.log(chalk.green('✅ Cloudflare Realtime secrets are ready.'));
      console.log(chalk.dim('  Local: .env.development / .dev.vars / .edgebase/secrets.json'));
      if (!options.skipWorkersSecrets) {
        console.log(chalk.dim('  Workers: synced via `wrangler secret put`'));
      }
    } catch (error) {
      if (isCliStructuredError(error)) throw error;
      raiseCliError({
        code: 'realtime_provision_failed',
        message: error instanceof Error ? error.message : 'Realtime provisioning failed.',
        hint: 'Check your Cloudflare authentication, API token permissions, and project wrangler configuration.',
      });
    }
  });
