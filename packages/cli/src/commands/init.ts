import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, chmodSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { deriveProjectSlug, ensureLocalWranglerToml, ensureRuntimeScaffold } from '../lib/runtime-scaffold.js';

/**
 * `edgebase init [dir]` — Project scaffolding.
 * Creates edgebase.config.ts, functions/ directory, env files, and .gitignore.
 */
export const initCommand = new Command('init')
  .description('Initialize a new EdgeBase project')
  .argument('[dir]', 'Project directory', '.')
  .option('--no-dev', 'Skip automatically starting the dev server after scaffolding')
  .option('--no-open', 'Do not open the Admin Dashboard when auto-starting the dev server')
  .action(async (dir: string, options: { dev: boolean; open: boolean }) => {
    const projectDir = resolve(dir);
    const localCliEntry = resolveLocalCliEntry(projectDir);
    const edgebaseBin = localCliEntry ? `node ${localCliEntry}` : 'npx edgebase';
    const needsPublishedPackages = localCliEntry === null;

    console.log(chalk.blue('⚡ Initializing EdgeBase project...'));
    console.log();

    // Create project directory if needed
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }

    const configPath = join(projectDir, 'edgebase.config.ts');

    // Create edgebase.config.ts template
    if (!existsSync(configPath)) {
      writeFileSync(configPath, CONFIG_TEMPLATE);
      console.log(chalk.green('  ✓'), 'edgebase.config.ts');
    } else {
      console.log(chalk.yellow('  ⏭'), 'edgebase.config.ts (already exists)');
    }

    const configDir = join(projectDir, 'config');
    const rateLimitsPath = join(configDir, 'rate-limits.ts');
    if (!existsSync(rateLimitsPath)) {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(rateLimitsPath, RATE_LIMITS_TEMPLATE);
      console.log(chalk.green('  ✓'), 'config/rate-limits.ts');
    } else {
      console.log(chalk.yellow('  ⏭'), 'config/rate-limits.ts (already exists)');
    }

    // Create functions/ directory
    const functionsDir = join(projectDir, 'functions');
    if (!existsSync(functionsDir)) {
      mkdirSync(functionsDir, { recursive: true });
      // Create example function
      writeFileSync(
        join(functionsDir, 'health.ts'),
        EXAMPLE_FUNCTION_TEMPLATE,
      );
      console.log(chalk.green('  ✓'), 'functions/health.ts');
    } else {
      console.log(chalk.yellow('  ⏭'), 'functions/ (already exists)');
    }

    // Create .env.development for local development secrets
    const envDevPath = join(projectDir, '.env.development');
    if (!existsSync(envDevPath)) {
      const devUserSecret = generateDevSecret();
      const devAdminSecret = generateDevSecret();
      writeFileSync(
        envDevPath,
        ENV_DEVELOPMENT_TEMPLATE
          .replace('JWT_USER_SECRET=', `JWT_USER_SECRET=${devUserSecret}`)
          .replace('JWT_ADMIN_SECRET=', `JWT_ADMIN_SECRET=${devAdminSecret}`),
      );
      console.log(chalk.green('  ✓'), '.env.development (JWT secrets auto-generated)');

      // Also save to .edgebase/secrets.json for local key management
      const edgebaseDir = join(projectDir, '.edgebase');
      const secretsJsonPath = join(edgebaseDir, 'secrets.json');
      if (!existsSync(edgebaseDir)) mkdirSync(edgebaseDir, { recursive: true });
      writeFileSync(
        secretsJsonPath,
        JSON.stringify({ JWT_USER_SECRET: devUserSecret, JWT_ADMIN_SECRET: devAdminSecret }, null, 2),
        'utf-8',
      );
      chmodSync(secretsJsonPath, 0o600);
    }

    // Create example env files (committed to repo for onboarding)
    const envDevExamplePath = join(projectDir, '.env.development.example');
    if (!existsSync(envDevExamplePath)) {
      writeFileSync(envDevExamplePath, ENV_DEVELOPMENT_TEMPLATE);
      console.log(chalk.green('  ✓'), '.env.development.example');
    }

    const envReleaseExamplePath = join(projectDir, '.env.release.example');
    if (!existsSync(envReleaseExamplePath)) {
      writeFileSync(envReleaseExamplePath, ENV_RELEASE_TEMPLATE);
      console.log(chalk.green('  ✓'), '.env.release.example');
    }

    const packageJsonPath = join(projectDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      writeFileSync(
        packageJsonPath,
        PACKAGE_JSON_TEMPLATE(deriveProjectSlug(projectDir), localCliEntry, needsPublishedPackages),
      );
      console.log(chalk.green('  ✓'), 'package.json');
    } else {
      const packageJsonChanged = ensureScaffoldPackageJson(
        packageJsonPath,
        deriveProjectSlug(projectDir),
        localCliEntry,
        needsPublishedPackages,
      );
      console.log(
        packageJsonChanged ? chalk.green('  ✓') : chalk.yellow('  ⏭'),
        packageJsonChanged ? 'package.json (updated)' : 'package.json (already exists)',
      );
    }

    const wranglerPath = join(projectDir, 'wrangler.toml');
    if (!existsSync(wranglerPath)) {
      ensureLocalWranglerToml(projectDir);
      console.log(chalk.green('  ✓'), 'wrangler.toml');
    } else {
      console.log(chalk.yellow('  ⏭'), 'wrangler.toml (already exists)');
    }

    const gitignorePath = join(projectDir, '.gitignore');
    const hadGitignore = existsSync(gitignorePath);
    const gitignoreChanged = ensureScaffoldGitignore(gitignorePath);
    console.log(
      gitignoreChanged ? chalk.green('  ✓') : chalk.yellow('  ⏭'),
      !hadGitignore
        ? '.gitignore'
        : gitignoreChanged
          ? '.gitignore (updated)'
          : '.gitignore (already exists)',
    );

    ensureRuntimeScaffold(projectDir);
    console.log(chalk.green('  ✓'), '.edgebase/runtime scaffold');

    console.log();
    console.log(chalk.green('✨'), 'Project initialized!');
    console.log();

    // Auto-start dev server with admin dashboard
    if (!options.dev) {
      console.log(chalk.bold('Next steps:'));
      console.log(`  1. Edit ${chalk.cyan('edgebase.config.ts')} to define your schema and auth settings`);
      if (needsPublishedPackages && shouldShowInstallStep()) {
        console.log(`  2. Run ${chalk.cyan(`'npm install'`)} to install the local EdgeBase CLI`);
        console.log(`  3. Run ${chalk.cyan(`'${edgebaseBin} dev'`)} to start the local development server`);
        console.log(`  4. Open the Admin Dashboard to explore your API`);
        console.log(`  5. Read the docs: ${chalk.cyan('https://edgebase.fun/docs/getting-started/quickstart')}`);
      } else if (needsPublishedPackages) {
        console.log(`  2. Run ${chalk.cyan(`'${edgebaseBin} dev'`)} to start the local development server`);
        console.log(`  3. Open the Admin Dashboard to explore your API`);
        console.log(`  4. Read the docs: ${chalk.cyan('https://edgebase.fun/docs/getting-started/quickstart')}`);
      } else {
        console.log(`  2. Run ${chalk.cyan(`'${edgebaseBin} dev'`)} to start the local development server`);
        console.log(`  3. Open the Admin Dashboard to explore your API`);
        console.log(`  4. Read the docs: ${chalk.cyan('https://edgebase.fun/docs/getting-started/quickstart')}`);
      }
      console.log();
      console.log(chalk.dim('When you\'re ready for production:'));
      const publishedInstallStep = needsPublishedPackages && shouldShowInstallStep();
      console.log(`  ${publishedInstallStep ? '6' : '5'}. Set ${chalk.cyan('release: true')} in edgebase.config.ts`);
      console.log(`  ${publishedInstallStep ? '7' : '6'}. Run ${chalk.cyan(`'${edgebaseBin} deploy'`)} to deploy to Cloudflare`);
      return;
    }

    console.log(chalk.bold('Next steps:'));
    console.log(`  1. Edit ${chalk.cyan('edgebase.config.ts')} to define your schema and auth settings`);
    console.log(`  2. Open the Admin Dashboard to explore your API`);
    console.log(`  3. Read the docs: ${chalk.cyan('https://edgebase.fun/docs/getting-started/quickstart')}`);
    console.log();
    console.log(chalk.dim('When you\'re ready for production:'));
    console.log(`  4. Set ${chalk.cyan('release: true')} in edgebase.config.ts`);
    console.log(`  5. Run ${chalk.cyan(`'${edgebaseBin} deploy'`)} to deploy to Cloudflare`);
    console.log();
    console.log(chalk.blue('⚡'), 'Starting dev server...');
    console.log();

    // Run dev in the project directory (same process, no redundant npx spawn)
    process.chdir(projectDir);
    const { devCommand } = await import('./dev.js');
    const devArgs = options.open ? [] : ['--no-open'];
    await devCommand.parseAsync(devArgs, { from: 'user' });
  });

function generateDevSecret(): string {
  return randomBytes(32).toString('hex');
}

// ─── Templates ───

const CONFIG_TEMPLATE = `import { defineConfig } from '@edgebase-fun/shared';
import { rateLimiting } from './config/rate-limits';

export default defineConfig({
  // release: false (default) — access policies are bypassed during development.
  // Set release: true before production deployment to enable deny-by-default access.

  databases: {
    // Add your first DB block here, for example:
    // app: {
    //   tables: {
    //     posts: {
    //       schema: {
    //         title: { type: 'string', required: true },
    //         content: { type: 'text' },
    //       },
    //     },
    //   },
    // },
  },

  // Optional rooms use handlers.lifecycle / handlers.actions / handlers.timers:
  // rooms: {
  //   game: {
  //     maxPlayers: 8,
  //     handlers: {
  //       lifecycle: {
  //         onCreate(room) {
  //           room.setSharedState(() => ({ status: 'waiting' }));
  //         },
  //       },
  //       actions: {
  //         PING: (_payload, room) => {
  //           room.broadcast('PONG', { at: Date.now() });
  //         },
  //       },
  //     },
  //   },
  // },

  auth: {
    emailAuth: true,
  },

  storage: {
    buckets: {
      uploads: {
        // Uses the generated STORAGE R2 binding by default.
        // Add access policies here when ready for production:
        // access: {
        //   read: () => true,
        //   write: (auth) => auth !== null,
        //   delete: (auth) => auth !== null,
        // },
      },
    },
  },

  serviceKeys: {
    keys: [
      {
        kid: 'root',
        tier: 'root',
        scopes: ['*'],
        secretSource: 'dashboard',
        secretRef: 'SERVICE_KEY',
      },
    ],
  },

  rateLimiting,

  cors: {
    origin: '*',
  },
});
`;

const RATE_LIMITS_TEMPLATE = `export const rateLimiting = {
  global: {
    requests: 10_000_000,
    window: '60s',
    binding: { limit: 10_000_000, period: 60, namespaceId: '1001' },
  },
  db: {
    requests: 100,
    window: '60s',
    binding: { limit: 10_000_000, period: 60, namespaceId: '1002' },
  },
  storage: {
    requests: 50,
    window: '60s',
    binding: { limit: 10_000_000, period: 60, namespaceId: '1003' },
  },
  functions: {
    requests: 50,
    window: '60s',
    binding: { limit: 10_000_000, period: 60, namespaceId: '1004' },
  },
  auth: {
    requests: 30,
    window: '60s',
    binding: { limit: 10_000_000, period: 60, namespaceId: '1005' },
  },
  authSignin: {
    requests: 10,
    window: '60s',
    binding: { limit: 10_000_000, period: 60, namespaceId: '1006' },
  },
  authSignup: {
    requests: 10,
    window: '60s',
    binding: { limit: 10_000_000, period: 60, namespaceId: '1007' },
  },
  events: {
    requests: 100,
    window: '60s',
    binding: { limit: 10_000_000, period: 60, namespaceId: '1008' },
  },
} as const;
`;

const EXAMPLE_FUNCTION_TEMPLATE = `import { defineFunction } from '@edgebase-fun/shared';

export const GET = defineFunction(async () => {
  return Response.json({ ok: true });
});
`;

const GITIGNORE_RULES = [
  'node_modules/',
  'dist/',
  '.wrangler/',
  '.wrangler.generated.*',
  '.dev.vars',
  '.env.development',
  '.env.release',
  '.edgebase/',
  'edgebase.d.ts',
  '*.local',
] as const;

const GITIGNORE_TEMPLATE = `${GITIGNORE_RULES.join('\n')}\n`;

function resolveLocalCliEntry(projectDir: string): string | null {
  let currentDir = resolve(projectDir);

  while (true) {
    const repoPackageJsonPath = join(currentDir, 'package.json');
    const workspacePath = join(currentDir, 'pnpm-workspace.yaml');
    const cliEntryPath = join(currentDir, 'packages', 'cli', 'dist', 'index.js');

    if (existsSync(repoPackageJsonPath) && existsSync(workspacePath) && existsSync(cliEntryPath)) {
      try {
        const repoPackageJson = JSON.parse(readFileSync(repoPackageJsonPath, 'utf-8')) as { name?: string };
        if (repoPackageJson.name === 'edgebase') {
          return toPosixPath(relative(projectDir, cliEntryPath));
        }
      } catch {
        // Ignore malformed repo metadata and keep walking upward.
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function readPackageJsonFromUrl(relativePath: string): Record<string, unknown> | null {
  try {
    const packageJsonPath = fileURLToPath(new URL(relativePath, import.meta.url));
    return JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveScaffoldDependencyVersion(packageName: string): string {
  const cliPackageJson = readPackageJsonFromUrl('../../package.json');
  const cliVersion = typeof cliPackageJson?.version === 'string' ? cliPackageJson.version : '0.1.0';
  const cliDependencies = typeof cliPackageJson?.dependencies === 'object' && cliPackageJson.dependencies !== null
    ? cliPackageJson.dependencies as Record<string, string>
    : {};

  const declaredVersion = cliDependencies[packageName];
  if (typeof declaredVersion === 'string' && !declaredVersion.startsWith('workspace:')) {
    return /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(declaredVersion)
      ? `^${declaredVersion}`
      : declaredVersion;
  }

  if (packageName === '@edgebase-fun/shared') {
    const sharedPackageJson = readPackageJsonFromUrl('../../../shared/package.json');
    if (typeof sharedPackageJson?.version === 'string') {
      return `^${sharedPackageJson.version}`;
    }
  }

  return `^${cliVersion}`;
}

const PACKAGE_JSON_TEMPLATE = (
  name: string,
  localCliEntry: string | null,
  needsPublishedPackages: boolean,
) => {
  return `${JSON.stringify(buildPackageJsonObject(name, localCliEntry, needsPublishedPackages), null, 2)}\n`;
};

function buildPackageJsonObject(
  name: string,
  localCliEntry: string | null,
  needsPublishedPackages: boolean,
): {
  name: string;
  private: true;
  type: 'module';
  scripts: Record<string, string>;
  engines: { node: string };
  devDependencies?: Record<string, string>;
} {
  const scriptPrefix = localCliEntry ? `node ${localCliEntry}` : 'edgebase';
  const packageJson: {
    name: string;
    private: true;
    type: 'module';
    scripts: Record<string, string>;
    engines: { node: string };
    devDependencies?: Record<string, string>;
  } = {
    name,
    private: true,
    type: 'module',
    scripts: {
      dev: `${scriptPrefix} dev`,
      deploy: `${scriptPrefix} deploy`,
      typegen: `${scriptPrefix} typegen`,
    },
    engines: {
      node: '^22.0.0 || ^24.0.0',
    },
  };

  if (needsPublishedPackages) {
    packageJson.devDependencies = {
      '@edgebase-fun/cli': resolveScaffoldDependencyVersion('@edgebase-fun/cli'),
      '@edgebase-fun/shared': resolveScaffoldDependencyVersion('@edgebase-fun/shared'),
    };
  }

  return packageJson;
}

// ─── Env File Templates ───

function shouldShowInstallStep(): boolean {
  return process.env.EDGEBASE_BOOTSTRAP_WRAPPER !== '1';
}

function ensureScaffoldPackageJson(
  packageJsonPath: string,
  name: string,
  localCliEntry: string | null,
  needsPublishedPackages: boolean,
): boolean {
  let existing: Record<string, unknown>;

  try {
    existing = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return false;
  }

  const generated = buildPackageJsonObject(name, localCliEntry, needsPublishedPackages);
  let changed = false;

  if (existing.name === undefined) {
    existing.name = generated.name;
    changed = true;
  }

  if (existing.private === undefined) {
    existing.private = generated.private;
    changed = true;
  }

  if (existing.type === undefined) {
    existing.type = generated.type;
    changed = true;
  }

  const existingScripts = ensureStringMap(existing, 'scripts');
  for (const [key, value] of Object.entries(generated.scripts ?? {})) {
    if (existingScripts[key] === undefined) {
      existingScripts[key] = value;
      changed = true;
    }
  }

  const existingEngines = ensureStringMap(existing, 'engines');
  if (generated.engines?.node && existingEngines.node === undefined) {
    existingEngines.node = generated.engines.node;
    changed = true;
  }

  if (needsPublishedPackages) {
    const existingDependencies = ensureStringMap(existing, 'dependencies');
    const existingDevDependencies = ensureStringMap(existing, 'devDependencies');
    const existingPeerDependencies = ensureStringMap(existing, 'peerDependencies');
    const existingOptionalDependencies = ensureStringMap(existing, 'optionalDependencies');

    for (const [key, value] of Object.entries(generated.devDependencies ?? {})) {
      if (
        existingDependencies[key] === undefined
        && existingDevDependencies[key] === undefined
        && existingPeerDependencies[key] === undefined
        && existingOptionalDependencies[key] === undefined
      ) {
        existingDevDependencies[key] = value;
        changed = true;
      }
    }
  }

  if (!changed) {
    return false;
  }

  writeFileSync(packageJsonPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
  return true;
}

function ensureScaffoldGitignore(gitignorePath: string): boolean {
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, GITIGNORE_TEMPLATE, 'utf-8');
    return true;
  }

  const existing = readFileSync(gitignorePath, 'utf-8');
  const existingRules = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  const missingRules = GITIGNORE_RULES.filter((rule) => !existingRules.has(rule));

  if (missingRules.length === 0) {
    return false;
  }

  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  writeFileSync(gitignorePath, `${existing}${prefix}${missingRules.join('\n')}\n`, 'utf-8');
  return true;
}

function ensureStringMap(
  target: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const current = target[key];
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as Record<string, string>;
  }

  const next: Record<string, string> = {};
  target[key] = next;
  return next;
}

const ENV_DEVELOPMENT_TEMPLATE = `# EdgeBase Development Environment Variables
# This file is git-ignored. Copy from .env.development.example to get started.
#
# JWT secrets below are auto-generated by EdgeBase project scaffolding.
# Add any development/test API keys below.

JWT_USER_SECRET=
JWT_ADMIN_SECRET=

# Example: Stripe test keys
# STRIPE_SECRET_KEY=sk_test_...
# STRIPE_WEBHOOK_SECRET=whsec_...

# Example: Email provider (Resend, etc.)
# EMAIL_API_KEY=re_test_...
`;

const ENV_RELEASE_TEMPLATE = `# EdgeBase Production Environment Variables
# This file is git-ignored. Copy from .env.release.example to get started.
#
# On \`edgebase deploy\`, these are auto-synced to Cloudflare Secrets.
# SERVICE_KEY is auto-managed by the deploy pipeline — do not include it here.

JWT_USER_SECRET=
JWT_ADMIN_SECRET=

# Database provider connection strings (only if using provider: 'neon' or 'postgres')
# DB_POSTGRES_SHARED_URL=postgres://user:pass@host/db?sslmode=require

# Example: Stripe live keys
# STRIPE_SECRET_KEY=sk_live_...
# STRIPE_WEBHOOK_SECRET=whsec_...

# Example: Email provider (Resend, etc.)
# EMAIL_API_KEY=re_...
`;
