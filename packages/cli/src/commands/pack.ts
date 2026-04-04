import { Command } from 'commander';
import { join } from 'node:path';
import chalk from 'chalk';
import { isJson, isQuiet } from '../lib/cli-context.js';
import { raiseCliError } from '../lib/agent-contract.js';
import { createArchivePackArtifact, createDirPackArtifact, createPortablePackArtifact, findPackProjectRoot } from '../lib/pack.js';

export const packCommand = new Command('pack')
  .description('Package the current EdgeBase project into a distributable artifact')
  .option('--format <format>', 'Artifact format (dir, portable, or archive)', 'dir')
  .option('-o, --output <path>', 'Output directory or file path for the packed artifact')
  .option('--app-name <name>', 'Portable app name override')
  .action(async (options: { format: string; output?: string; appName?: string }) => {
    if (!['dir', 'portable', 'archive'].includes(options.format)) {
      raiseCliError({
        code: 'unsupported_pack_format',
        message: `Unsupported pack format '${options.format}'.`,
        hint: 'Use --format dir, --format portable, or --format archive.',
        details: {
          supportedFormats: ['dir', 'portable', 'archive'],
        },
      });
    }

    const projectDir = findPackProjectRoot();
    try {
      const result = options.format === 'archive'
        ? createArchivePackArtifact(projectDir, {
          outputDir: options.output,
          appName: options.appName,
        })
        : options.format === 'portable'
          ? createPortablePackArtifact(projectDir, {
          outputDir: options.output,
          appName: options.appName,
        })
          : createDirPackArtifact(projectDir, {
          outputDir: options.output,
        });

      if (isJson()) {
        console.log(JSON.stringify({
          status: 'success',
          operation: 'pack',
          format: result.format,
          ...(result.format === 'archive'
            ? {
              projectDir: result.projectDir,
              outputPath: result.outputPath,
              sourcePortablePath: result.sourcePortablePath,
              launcherPath: result.launcherPath,
              bundledAppDir: result.bundledAppDir,
              appManifestPath: result.appManifestPath,
              packManifestPath: result.packManifestPath,
              manifest: result.manifest,
              appManifest: result.appManifest,
              packManifest: result.packManifest,
            }
            : result.format === 'portable'
            ? {
              projectDir: result.projectDir,
              outputPath: result.outputPath,
              manifestPath: result.manifestPath,
              launcherPath: result.launcherPath,
              bundledAppDir: result.bundledAppDir,
              appManifestPath: result.appManifestPath,
              packManifestPath: result.packManifestPath,
              manifest: result.manifest,
              appManifest: result.appManifest,
              packManifest: result.packManifest,
            }
            : {
              projectDir: result.projectDir,
              outputDir: result.outputDir,
              manifestPath: result.manifestPath,
              appManifestPath: result.appManifestPath,
              manifest: result.manifest,
              appManifest: result.appManifest,
            }),
        }));
        return;
      }

      if (!isQuiet()) {
        console.log(chalk.blue('Packing EdgeBase project...'));
      }
      console.log(chalk.green(`✓ ${
        result.format === 'archive'
          ? 'Archive'
          : result.format === 'portable'
            ? 'Portable'
            : 'Pack'
      } artifact created successfully`));
      console.log(chalk.dim(`  Project:  ${result.projectDir}`));
      if (result.format === 'archive') {
        console.log(chalk.dim(`  Output:   ${result.outputPath}`));
        console.log(chalk.dim(`  Source:   ${result.sourcePortablePath}`));
        console.log(chalk.dim(`  Launcher: ${result.launcherPath}`));
      } else if (result.format === 'portable') {
        console.log(chalk.dim(`  Output:   ${result.outputPath}`));
        console.log(chalk.dim(`  Launcher: ${result.launcherPath}`));
        console.log(chalk.dim(`  Bundle:   ${result.bundledAppDir}`));
        console.log(chalk.dim(`  Manifest: ${result.manifestPath}`));
      } else {
        console.log(chalk.dim(`  Output:   ${result.outputDir}`));
        console.log(chalk.dim(`  App:      ${result.appManifestPath}`));
        console.log(chalk.dim(`  Manifest: ${result.manifestPath}`));
        console.log(chalk.dim(`  Launcher: ${join(result.outputDir, result.manifest.launcher.entry)}`));
        console.log(chalk.dim(`  Run:      ${join(result.outputDir, result.manifest.launcher.unix)}`));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      raiseCliError({
        code: 'pack_failed',
        message,
        hint: 'Make sure edgebase.config.ts is present, any configured frontend build output already exists, and the current platform can copy its local Node runtime and archive tooling.',
      });
    }
  });
