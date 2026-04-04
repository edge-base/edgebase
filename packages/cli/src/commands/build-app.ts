import { Command } from 'commander';
import { raiseCliError } from '../lib/agent-contract.js';
import { createAppBundle, findAppProjectRoot } from '../lib/app-bundle.js';
import { isJson } from '../lib/cli-context.js';

export const buildAppCommand = new Command('build-app')
  .description('Build a self-contained app bundle from the current EdgeBase project')
  .option('-o, --output <path>', 'Output directory for the app bundle')
  .action((options: { output?: string }) => {
    try {
      const projectDir = findAppProjectRoot();
      const result = createAppBundle(projectDir, {
        outputDir: options.output,
      });

      if (isJson()) {
        process.stdout.write(`${JSON.stringify({
          status: 'success',
          operation: 'build-app',
          format: result.format,
          projectDir: result.projectDir,
          outputDir: result.outputDir,
          manifestPath: result.manifestPath,
          manifest: result.manifest,
        }, null, 2)}\n`);
        return;
      }

      console.log(`Built EdgeBase app bundle at ${result.outputDir}`);
      console.log(`Manifest: ${result.manifestPath}`);
      console.log(`Functions bundled: ${result.manifest.functions.count}`);
      console.log(
        result.manifest.frontend.enabled
          ? `Frontend: enabled (${result.manifest.frontend.mountPath ?? '/'})`
          : 'Frontend: disabled',
      );
    } catch (error) {
      raiseCliError({
        code: 'build_app_failed',
        message: error instanceof Error ? error.message : 'Failed to build app bundle.',
        hint: 'Fix the reported config, frontend, or functions issue and rerun `edgebase build-app`.',
        details: {
          operation: 'build-app',
          cause: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
