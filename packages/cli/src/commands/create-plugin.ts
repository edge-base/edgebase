import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { isJson } from '../lib/cli-context.js';
import { raiseCliError } from '../lib/agent-contract.js';

/**
 * `npx edgebase create-plugin <name>` — Scaffold a new EdgeBase plugin project.
 * Templates from packages/cli/src/templates/plugin/.
 */

function readTemplate(templateDir: string, relativePath: string): string {
  const fullPath = join(templateDir, relativePath + '.tmpl');
  if (existsSync(fullPath)) {
    return readFileSync(fullPath, 'utf-8');
  }
  // Fallback: try without .tmpl extension
  const plainPath = join(templateDir, relativePath);
  if (existsSync(plainPath)) {
    return readFileSync(plainPath, 'utf-8');
  }
  throw new Error(`Template not found: ${relativePath}`);
}

function applyVariables(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

/** Write a file only if it doesn't already exist. Returns true if written. */
function safeWrite(filePath: string, content: string): 'created' | 'skipped' {
  if (existsSync(filePath)) {
    return 'skipped';
  }
  writeFileSync(filePath, content, 'utf-8');
  return 'created';
}

/** Convert a plugin name to camelCase (e.g. 'my-plugin' → 'myPlugin', '@scope/plugin-name' → 'pluginName') */
function toCamelCase(name: string): string {
  const baseName = name.replace(/^@[^/]+\//, '');
  return baseName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Convert a plugin name to PascalCase (e.g. 'my-plugin' → 'MyPlugin') */
function toPascalCase(name: string): string {
  const camel = toCamelCase(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export const createPluginCommand = new Command('create-plugin')
  .description('Create a new EdgeBase plugin project')
  .argument('<name>', 'Plugin name (e.g. my-plugin or @scope/plugin-name)')
  .option('--with-client [langs]', 'Include client SDKs (js, or "all")')
  .option('--force', 'Overwrite existing files')
  .action((name: string, options: { withClient?: string | boolean; force?: boolean }) => {
    try {
      const outputDir = resolve('.', name.replace(/^@[^/]+\//, ''));
      const force = !!options.force;
      const created: string[] = [];
      const skippedPaths: string[] = [];
      const warnings: string[] = [];

      if (!isJson()) {
        console.log(chalk.blue('⚡'), `Creating EdgeBase plugin: ${chalk.cyan(name)}`);
        console.log();
      }

      const vars: Record<string, string> = {
        PLUGIN_NAME: name,
        PLUGIN_NAME_CAMEL: toCamelCase(name),
        PLUGIN_NAME_PASCAL: toPascalCase(name),
        PLUGIN_DESCRIPTION: `${name} functionality`,
      };

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const templateDir = join(__dirname, '..', 'templates', 'plugin');
      const srcTemplateDir = join(__dirname, '..', '..', 'src', 'templates', 'plugin');
      const resolvedTemplateDir = existsSync(templateDir) ? templateDir : srcTemplateDir;

      const serverDir = join(outputDir, 'server');
      mkdirSync(join(serverDir, 'src'), { recursive: true });

      const templateFiles: Array<{ template: string; output: string }> = [
        { template: 'server/package.json', output: join(serverDir, 'package.json') },
        { template: 'server/src/index.ts', output: join(serverDir, 'src', 'index.ts') },
        { template: 'server/tsconfig.json', output: join(serverDir, 'tsconfig.json') },
        { template: 'README.md', output: join(outputDir, 'README.md') },
      ];

      const writeRenderedTemplate = (template: string, output: string, fallbackPlaceholder = false) => {
        try {
          const content = readTemplate(resolvedTemplateDir, template);
          const rendered = applyVariables(content, vars);

          if (force) {
            writeFileSync(output, rendered, 'utf-8');
            created.push(output);
            if (!isJson()) {
              console.log(chalk.green('✓'), `Created ${output.replace(resolve('.') + '/', '')}`);
            }
            return;
          }

          const result = safeWrite(output, rendered);
          if (result === 'created') {
            created.push(output);
            if (!isJson()) {
              console.log(chalk.green('✓'), `Created ${output.replace(resolve('.') + '/', '')}`);
            }
          } else {
            skippedPaths.push(output);
            if (!isJson()) {
              console.log(chalk.yellow('⏭'), `Skipped ${output.replace(resolve('.') + '/', '')} (already exists)`);
            }
          }
        } catch (err) {
          if (!fallbackPlaceholder) {
            const warning = `Failed to create ${template}: ${(err as Error).message}`;
            warnings.push(warning);
            if (!isJson()) {
              console.error(chalk.yellow('⚠'), warning);
            }
            return;
          }

          const placeholder = `// ${template} - template not found\n`;
          if (force || !existsSync(output)) {
            writeFileSync(output, placeholder, 'utf-8');
            created.push(output);
            const warning = `Created placeholder for ${template}`;
            warnings.push(warning);
            if (!isJson()) {
              console.log(chalk.yellow('⚠'), warning);
            }
          } else {
            skippedPaths.push(output);
            if (!isJson()) {
              console.log(chalk.yellow('⏭'), `Skipped placeholder ${output.replace(resolve('.') + '/', '')} (already exists)`);
            }
          }
        }
      };

      for (const { template, output } of templateFiles) {
        writeRenderedTemplate(template, output);
      }

      if (options.withClient) {
        const langs = options.withClient === true || options.withClient === 'all'
          ? ['js']
          : [options.withClient];
        for (const lang of langs) {
          const clientDir = join(outputDir, 'client', lang);
          mkdirSync(join(clientDir, 'src'), { recursive: true });

          const clientTemplates: Array<{ template: string; output: string }> = [
            { template: `client/${lang}/package.json`, output: join(clientDir, 'package.json') },
            { template: `client/${lang}/src/index.ts`, output: join(clientDir, 'src', 'index.ts') },
            { template: `client/${lang}/tsconfig.json`, output: join(clientDir, 'tsconfig.json') },
          ];

          for (const { template, output } of clientTemplates) {
            writeRenderedTemplate(template, output, true);
          }
        }
      }

      const relativeOutputDir = outputDir.replace(resolve('.') + '/', '');
      const nextSteps = [
        `cd ${relativeOutputDir}`,
        'cd server && npm install',
        'Edit server/src/index.ts to define tables, functions, and hooks',
        'npm run build',
        `npm install ../${name.replace(/^@[^/]+\//, '')}/server`,
        `Import ${vars.PLUGIN_NAME_CAMEL}Plugin in edgebase.config.ts and add it to plugins`,
        'npx edgebase deploy',
      ];

      if (isJson()) {
        console.log(JSON.stringify({
          status: 'success',
          plugin: {
            name,
            outputDir,
            created,
            skipped: skippedPaths,
            warnings,
          },
          nextSteps,
        }));
        return;
      }

      console.log();

      if (skippedPaths.length > 0) {
        console.log(chalk.yellow('ℹ'), `${skippedPaths.length} file(s) skipped (already exist). Use ${chalk.cyan('--force')} to overwrite.`);
        console.log();
      }

      console.log(chalk.green('✅'), 'Plugin created! Next steps:');
      console.log();
      console.log(chalk.dim('  1. cd'), chalk.cyan(relativeOutputDir));
      console.log(chalk.dim('  2.'), chalk.cyan('cd server && npm install'));
      console.log(chalk.dim('  3.'), 'Edit', chalk.cyan('server/src/index.ts'), 'to define tables, functions, and hooks');
      console.log(chalk.dim('  4.'), chalk.cyan('npm run build'));
      console.log(chalk.dim('  5.'), 'In your EdgeBase project:');
      console.log(chalk.dim('     '), chalk.cyan(`npm install ../${name.replace(/^@[^/]+\//, '')}/server`));
      console.log(chalk.dim('  6.'), 'Add to', chalk.cyan('edgebase.config.ts') + ':');
      console.log(chalk.dim('     '), chalk.cyan(`import { ${vars.PLUGIN_NAME_CAMEL}Plugin } from '${name}';`));
      console.log(chalk.dim('     '), chalk.cyan(`plugins: [ ${vars.PLUGIN_NAME_CAMEL}Plugin({ apiKey: '...' }) ]`));
      console.log(chalk.dim('  7.'), chalk.cyan('npx edgebase deploy'));
      console.log();
    } catch (error) {
      raiseCliError({
        code: 'create_plugin_failed',
        message: error instanceof Error ? error.message : 'Plugin scaffolding failed.',
        hint: 'Check that the target directory is writable and the plugin templates are available in this CLI build.',
      });
    }
  });
