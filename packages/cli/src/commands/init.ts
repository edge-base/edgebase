import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, chmodSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { deriveProjectSlug, ensureLocalWranglerToml, ensureRuntimeScaffold } from '../lib/runtime-scaffold.js';

/**
 * `npx edgebase init [dir]` — Project scaffolding.
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
        PACKAGE_JSON_TEMPLATE(deriveProjectSlug(projectDir), localCliEntry),
      );
      console.log(chalk.green('  ✓'), 'package.json');
    } else {
      console.log(chalk.yellow('  ⏭'), 'package.json (already exists)');
    }

    const wranglerPath = join(projectDir, 'wrangler.toml');
    if (!existsSync(wranglerPath)) {
      ensureLocalWranglerToml(projectDir);
      console.log(chalk.green('  ✓'), 'wrangler.toml');
    } else {
      console.log(chalk.yellow('  ⏭'), 'wrangler.toml (already exists)');
    }

    // Create .gitignore entry
    const gitignorePath = join(projectDir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, GITIGNORE_TEMPLATE);
      console.log(chalk.green('  ✓'), '.gitignore');
    }

    ensureRuntimeScaffold(projectDir);
    console.log(chalk.green('  ✓'), '.edgebase/runtime scaffold');

    console.log();
    console.log(chalk.green('✨'), 'Project initialized!');
    console.log();

    // Auto-start dev server with admin dashboard
    if (!options.dev) {
      console.log(chalk.bold('Next steps:'));
      console.log(`  1. Edit ${chalk.cyan('edgebase.config.ts')} to define your schema and auth settings`);
      console.log(`  2. Run ${chalk.cyan(`'${edgebaseBin} dev'`)} to start the local development server`);
      console.log(`  3. Open the Admin Dashboard to explore your API`);
      console.log(`  4. Read the docs: ${chalk.cyan('https://edgebase.fun/docs/getting-started/quickstart')}`);
      console.log();
      console.log(chalk.dim('When you\'re ready for production:'));
      console.log(`  5. Set ${chalk.cyan('release: true')} in edgebase.config.ts`);
      console.log(`  6. Run ${chalk.cyan(`'${edgebaseBin} deploy'`)} to deploy to Cloudflare`);
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

const CONFIG_TEMPLATE = `import { defineConfig } from '@edgebase/shared';
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

const EXAMPLE_FUNCTION_TEMPLATE = `import { defineFunction } from '@edgebase/shared';

export const GET = defineFunction(async () => {
  return Response.json({ ok: true });
});
`;

const GITIGNORE_TEMPLATE = `node_modules/
dist/
.wrangler/
.wrangler.generated.*
.dev.vars
.env.development
.env.release
.edgebase/
edgebase.d.ts
*.local
`;

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

const PACKAGE_JSON_TEMPLATE = (name: string, localCliEntry: string | null) => {
  const edgebaseBin = localCliEntry ? `node ${localCliEntry}` : 'npx edgebase';

  return `{
  "name": ${JSON.stringify(name)},
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "${edgebaseBin} dev",
    "deploy": "${edgebaseBin} deploy",
    "typegen": "${edgebaseBin} typegen"
  },
  "engines": {
    "node": "^22.0.0 || ^24.0.0"
  }
}
`;
};

// ─── Env File Templates ───

const ENV_DEVELOPMENT_TEMPLATE = `# EdgeBase Development Environment Variables
# This file is git-ignored. Copy from .env.development.example to get started.
#
# JWT secrets below are auto-generated by \`npx edgebase init\`.
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
# On \`npx edgebase deploy\`, these are auto-synced to Cloudflare Secrets.
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
