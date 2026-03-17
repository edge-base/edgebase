import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  isCliStructuredError,
  raiseCliError,
  raiseNeedsUserAction,
} from '../lib/agent-contract.js';
import { isJson, isNonInteractive } from '../lib/cli-context.js';
import { loadConfigSafe } from '../lib/load-config.js';
import { extractDatabases } from '../lib/deploy-shared.js';
import {
  getDefaultPostgresEnvKey,
  listNeonDatabases,
  listNeonBranches,
  listNeonOrganizations,
  listNeonProjects,
  listNeonRoles,
  type NeonOrganizationSummary,
  type NeonProjectSummary,
  parseNeonProject,
  parseNeonConnectionString,
  runNeonctl,
  runNeonctlInteractive,
  writeProjectEnvValue,
} from '../lib/neon.js';
import { promptSelect } from '../lib/prompts.js';

const FULL_CONFIG_EVAL = { allowRegexFallback: false } as const;

interface NeonDbBlockMeta {
  provider?: string;
  connectionString?: string;
  tables?: unknown;
}

type PostgresCapableProvider = 'neon' | 'postgres';

export interface NeonSetupTarget {
  kind: 'auth' | 'database';
  label: string;
  envKey: string;
  namespace?: string;
}

interface NeonProjectMatch {
  projectId: string;
  projectName: string;
  orgId: string;
  orgName: string;
}

export interface NeonProjectOption {
  projectId: string;
  projectName: string;
  orgId: string;
  orgName: string;
}

function normalizeProjectName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || 'edgebase-neon';
}

function normalizePgIdentifier(value: string, fallback = 'edgebase_db'): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  const candidate = normalized || fallback;
  return /^[a-z_]/.test(candidate) ? candidate : `eb_${candidate}`;
}

function listNeonDatabaseTargets(config?: Record<string, unknown> | null): NeonSetupTarget[] {
  const databases = config
    ? (extractDatabases(config) as Record<string, NeonDbBlockMeta> | null)
    : null;
  if (!databases) return [];

  return Object.entries(databases)
    .filter(([, dbBlock]) => dbBlock?.provider === 'neon' || dbBlock?.provider === 'postgres')
    .map(([namespace, dbBlock]) => ({
      kind: 'database' as const,
      label: namespace,
      namespace,
      envKey: dbBlock.connectionString ?? getDefaultPostgresEnvKey(namespace),
    }));
}

export function listNeonSetupTargets(config?: Record<string, unknown> | null): NeonSetupTarget[] {
  const targets: NeonSetupTarget[] = [];
  const auth = config?.auth as { provider?: string; connectionString?: string } | undefined;
  if (auth?.provider === 'neon' || auth?.provider === 'postgres') {
    targets.push({
      kind: 'auth',
      label: 'auth',
      envKey: auth.connectionString ?? 'AUTH_POSTGRES_URL',
    });
  }
  targets.push(...listNeonDatabaseTargets(config));
  return targets;
}

export function resolveNeonSetupTarget(
  options: { auth?: boolean; namespace?: string },
  config?: Record<string, unknown> | null,
): NeonSetupTarget | null {
  if (options.auth && options.namespace) {
    throw new Error('Use either `--auth` or `--namespace <name>`, not both.');
  }

  const databases = config
    ? (extractDatabases(config) as Record<string, NeonDbBlockMeta> | null)
    : null;
  const auth = config?.auth as { provider?: string; connectionString?: string } | undefined;

  if (options.auth) {
    if (auth?.provider !== 'neon' && auth?.provider !== 'postgres') {
      throw new Error("auth.provider is not set to 'postgres' (legacy 'neon' also works) in edgebase.config.ts.");
    }
    return {
      kind: 'auth',
      label: 'auth',
      envKey: auth.connectionString ?? 'AUTH_POSTGRES_URL',
    };
  }

  if (options.namespace) {
    const dbBlock = databases?.[options.namespace];
    if (!dbBlock) {
      throw new Error(`DB block '${options.namespace}' was not found in edgebase.config.ts.`);
    }
    if (dbBlock.provider !== 'neon' && dbBlock.provider !== 'postgres') {
      throw new Error(`DB block '${options.namespace}' is not configured with provider: 'postgres' (legacy 'neon' also works).`);
    }
    return {
      kind: 'database',
      label: options.namespace,
      namespace: options.namespace,
      envKey: dbBlock.connectionString ?? getDefaultPostgresEnvKey(options.namespace),
    };
  }

  const targets = listNeonSetupTargets(config);
  return targets.length === 1 ? targets[0] : null;
}

export const _internals = {
  listNeonSetupTargets,
  normalizePgIdentifier,
  normalizeProjectName,
  resolveNeonSetupTarget,
};

export type NeonProjectMode = 'auto' | 'reuse' | 'create';

export interface RunNeonSetupOptions {
  projectDir?: string;
  auth?: boolean;
  namespace?: string;
  projectId?: string;
  projectName?: string;
  orgId?: string;
  database?: string;
  role?: string;
  branch?: string;
  apiKey?: string;
  configDir?: string;
  pooled?: boolean;
  projectMode?: NeonProjectMode;
  configJson?: Record<string, unknown> | null;
  envKeyOverride?: string;
  targetLabelOverride?: string;
}

export interface RunNeonSetupResult {
  target: NeonSetupTarget;
  connectionString: string;
  envDevPath: string;
  envReleasePath: string;
  projectId?: string;
  projectName: string;
  databaseName: string;
  roleName: string;
  branch?: string;
}

function formatProjectMatchLabel(match: NeonProjectMatch): string {
  return `${match.projectName} (${match.orgName})`;
}

function normalizeProviderForNeon(value: unknown): PostgresCapableProvider | undefined {
  return value === 'neon' || value === 'postgres' ? value : undefined;
}

function buildExplicitTarget(input: {
  auth?: boolean;
  namespace?: string;
  configJson?: Record<string, unknown> | null;
  envKeyOverride?: string;
  targetLabelOverride?: string;
}): NeonSetupTarget | null {
  const { auth, namespace, configJson, envKeyOverride, targetLabelOverride } = input;
  if (!auth && !namespace && !envKeyOverride && !targetLabelOverride) {
    return null;
  }

  if (auth && namespace) {
    throw new Error('Use either auth mode or a namespace target, not both.');
  }

  if (auth) {
    const authConfig = configJson?.auth as { provider?: string; connectionString?: string } | undefined;
    const provider = normalizeProviderForNeon(authConfig?.provider);
    if (!provider && !envKeyOverride) {
      throw new Error("auth.provider is not set to 'postgres' (legacy 'neon' also works) in edgebase.config.ts.");
    }
    return {
      kind: 'auth',
      label: targetLabelOverride ?? 'auth',
      envKey: envKeyOverride ?? authConfig?.connectionString ?? 'AUTH_POSTGRES_URL',
    };
  }

  const dbBlock = namespace
    ? (extractDatabases(configJson ?? {}) as Record<string, NeonDbBlockMeta> | null)?.[namespace]
    : undefined;
  const provider = normalizeProviderForNeon(dbBlock?.provider);
  if (!provider && !envKeyOverride && namespace) {
    throw new Error(
      `DB block '${namespace}' is not configured with provider: 'postgres' (legacy 'neon' also works).`,
    );
  }

  const resolvedNamespace = namespace ?? targetLabelOverride ?? 'shared';
  return {
    kind: 'database',
    label: targetLabelOverride ?? resolvedNamespace,
    namespace: resolvedNamespace,
    envKey: envKeyOverride ?? dbBlock?.connectionString ?? getDefaultPostgresEnvKey(resolvedNamespace),
  };
}

function buildProjectDefaults(projectDir: string, target: NeonSetupTarget) {
  const appSlug = normalizeProjectName(basename(projectDir));
  const defaultProjectName = target.kind === 'auth'
    ? `${appSlug}-auth`
    : `${appSlug}-${normalizeProjectName(target.label)}`;
  const defaultDatabaseName = normalizePgIdentifier(`${appSlug}_${target.label}`);
  const defaultRoleName = normalizePgIdentifier(`${defaultDatabaseName}_owner`, 'edgebase_owner');

  return {
    appSlug,
    defaultProjectName,
    defaultDatabaseName,
    defaultRoleName,
  };
}

async function chooseOrganization(
  organizations: Array<{ id: string; name: string }>,
  requestedOrgId: string | undefined,
): Promise<{ id: string; name: string }> {
  if (requestedOrgId) {
    const match = organizations.find((entry) => entry.id === requestedOrgId);
    if (!match) {
      throw new Error(`Neon organization '${requestedOrgId}' was not found for the authenticated account.`);
    }
    return match;
  }

  if (organizations.length === 0) {
    throw new Error('No Neon organizations are available for the authenticated account.');
  }

  if (organizations.length === 1) {
    return organizations[0];
  }

  const labels = organizations.map((entry) => `${entry.name} (${entry.id})`);
  const selected = await promptSelect('Which Neon organization should own the new project?', labels, {
    field: 'orgId',
    message: 'Multiple Neon organizations are available.',
    hint: 'Rerun with --org-id <id>.',
    choices: organizations.map((entry) => ({
      label: `${entry.name} (${entry.id})`,
      value: entry.id,
      args: ['--org-id', entry.id],
    })),
  });
  const selectedIndex = labels.indexOf(selected);
  return organizations[selectedIndex] ?? organizations[0];
}

async function findProjectMatches(
  desiredProjectName: string,
  organizations: NeonOrganizationSummary[],
  neonOptions: { apiKey?: string; configDir?: string; cwd: string },
): Promise<NeonProjectMatch[]> {
  const matches: NeonProjectMatch[] = [];
  for (const organization of organizations) {
    const projects = listNeonProjects(organization.id, neonOptions);
    for (const project of projects) {
      if (project.name === desiredProjectName) {
        matches.push({
          projectId: project.id,
          projectName: project.name,
          orgId: organization.id,
          orgName: organization.name,
        });
      }
    }
  }
  return matches;
}

function listAllProjectMatches(
  organizations: NeonOrganizationSummary[],
  neonOptions: { apiKey?: string; configDir?: string; cwd: string },
): NeonProjectOption[] {
  const matches: NeonProjectOption[] = [];
  for (const organization of organizations) {
    const projects = listNeonProjects(organization.id, neonOptions);
    for (const project of projects) {
      matches.push({
        projectId: project.id,
        projectName: project.name,
        orgId: organization.id,
        orgName: organization.name,
      });
    }
  }
  return matches;
}

function getNeonProject(
  projectId: string,
  neonOptions: { apiKey?: string; configDir?: string; cwd: string },
): NeonProjectSummary | null {
  const output = runNeonctl(
    ['project', 'get', projectId],
    { ...neonOptions, output: 'json' },
  );
  return parseNeonProject(output);
}

async function resolveProjectForMode(input: {
  mode: NeonProjectMode;
  desiredProjectName: string;
  orgId?: string;
  explicitProjectId?: string;
  databaseName: string;
  roleName: string;
  neonOptions: { apiKey?: string; configDir?: string; cwd: string };
}): Promise<{ projectId: string; orgId: string; projectName: string }> {
  const {
    mode,
    desiredProjectName,
    orgId,
    explicitProjectId,
    databaseName,
    roleName,
    neonOptions,
  } = input;

  if (explicitProjectId) {
    const existingProject = getNeonProject(explicitProjectId, neonOptions);
    return {
      projectId: explicitProjectId,
      orgId: orgId ?? existingProject?.orgId ?? '',
      projectName: existingProject?.name ?? desiredProjectName,
    };
  }

  const organizations = listNeonOrganizations(neonOptions);
  const searchableOrganizations = orgId
    ? organizations.filter((entry) => entry.id === orgId)
    : organizations;

  if (searchableOrganizations.length === 0) {
    throw new Error(
      orgId
        ? `Neon organization '${orgId}' was not found for the authenticated account.`
        : 'No Neon organizations are available for the authenticated account.',
    );
  }

  const matches = await findProjectMatches(desiredProjectName, searchableOrganizations, neonOptions);

  if (mode === 'reuse') {
    if (matches.length === 0) {
      const allProjects = listAllProjectMatches(searchableOrganizations, neonOptions);
      if (allProjects.length === 0) {
        throw new Error('No existing Neon projects are available for the authenticated account.');
      }
      if (allProjects.length === 1) {
        return {
          projectId: allProjects[0].projectId,
          orgId: allProjects[0].orgId,
          projectName: allProjects[0].projectName,
        };
      }
      const labels = allProjects.map(formatProjectMatchLabel);
      const selected = await promptSelect(
        `No Neon project named '${desiredProjectName}' was found. Which existing Neon project should EdgeBase connect?`,
        labels,
        {
          field: 'projectId',
          message: `No existing Neon project named '${desiredProjectName}' was found.`,
          hint: 'Rerun with --project-id <id>.',
          choices: allProjects.map((project) => ({
            label: formatProjectMatchLabel(project),
            value: project.projectId,
            args: ['--project-id', project.projectId],
          })),
        },
      );
      const selectedIndex = labels.indexOf(selected);
      const match = allProjects[selectedIndex] ?? allProjects[0];
      return {
        projectId: match.projectId,
        orgId: match.orgId,
        projectName: match.projectName,
      };
    }
    if (matches.length === 1) {
      return {
        projectId: matches[0].projectId,
        orgId: matches[0].orgId,
        projectName: matches[0].projectName,
      };
    }
    const labels = matches.map(formatProjectMatchLabel);
    const selected = await promptSelect(
      `Multiple Neon projects named '${desiredProjectName}' were found. Which one should EdgeBase use?`,
      labels,
      {
        field: 'projectId',
        message: `Multiple Neon projects named '${desiredProjectName}' were found.`,
        hint: 'Rerun with --project-id <id> or narrow the search with --org-id.',
        choices: matches.map((match) => ({
          label: formatProjectMatchLabel(match),
          value: match.projectId,
          args: ['--project-id', match.projectId],
        })),
      },
    );
    const selectedIndex = labels.indexOf(selected);
    const match = matches[selectedIndex] ?? matches[0];
    return {
      projectId: match.projectId,
      orgId: match.orgId,
      projectName: match.projectName,
    };
  }

  if (mode === 'auto' && matches.length > 0) {
    if (matches.length === 1) {
      return {
        projectId: matches[0].projectId,
        orgId: matches[0].orgId,
        projectName: matches[0].projectName,
      };
    }
    const labels = matches.map(formatProjectMatchLabel);
    const selected = await promptSelect(
      `Multiple Neon projects named '${desiredProjectName}' were found. Which one should EdgeBase use?`,
      labels,
      {
        field: 'projectId',
        message: `Multiple Neon projects named '${desiredProjectName}' were found.`,
        hint: 'Rerun with --project-id <id> or narrow the search with --org-id.',
        choices: matches.map((match) => ({
          label: formatProjectMatchLabel(match),
          value: match.projectId,
          args: ['--project-id', match.projectId],
        })),
      },
    );
    const selectedIndex = labels.indexOf(selected);
    const match = matches[selectedIndex] ?? matches[0];
    return {
      projectId: match.projectId,
      orgId: match.orgId,
      projectName: match.projectName,
    };
  }

  const owner = await chooseOrganization(searchableOrganizations, orgId);

  let projectName = desiredProjectName;
  if (mode === 'create') {
    const taken = new Set(
      listNeonProjects(owner.id, neonOptions)
        .map((project) => project.name),
    );
    if (taken.has(projectName)) {
      let suffix = 2;
      while (taken.has(`${projectName}-${suffix}`)) suffix++;
      projectName = `${projectName}-${suffix}`;
    }
  }

  const createdOutput = runNeonctl(
    [
      'project',
      'create',
      '--org-id',
      owner.id,
      '--name',
      projectName,
      '--database',
      databaseName,
      '--role',
      roleName,
      '--set-context',
    ],
    {
      ...neonOptions,
      output: 'json',
    },
  );
  const createdProject = parseNeonProject(createdOutput);
  if (!createdProject?.id) {
    throw new Error('Neon project creation succeeded but EdgeBase could not determine the new project ID.');
  }

  return {
    projectId: createdProject.id,
    orgId: createdProject.orgId ?? owner.id,
    projectName: createdProject.name,
  };
}

export async function listAvailableNeonProjects(options: {
  projectDir?: string;
  apiKey?: string;
  configDir?: string;
  orgId?: string;
} = {}): Promise<NeonProjectOption[]> {
  const projectDir = options.projectDir ? resolve(options.projectDir) : resolve('.');
  const neonOptions = {
    apiKey: options.apiKey ?? process.env.NEON_API_KEY,
    configDir: options.configDir,
    cwd: projectDir,
  } as const;

  const organizations = listNeonOrganizations(neonOptions);
  const searchableOrganizations = options.orgId
    ? organizations.filter((entry) => entry.id === options.orgId)
    : organizations;

  if (searchableOrganizations.length === 0) {
    throw new Error(
      options.orgId
        ? `Neon organization '${options.orgId}' was not found for the authenticated account.`
        : 'No Neon organizations are available for the authenticated account.',
    );
  }

  return listAllProjectMatches(searchableOrganizations, neonOptions)
    .sort((a, b) => `${a.projectName}:${a.orgName}`.localeCompare(`${b.projectName}:${b.orgName}`));
}

async function ensureNeonAuth(
  projectDir: string,
  apiKey?: string,
  configDir?: string,
): Promise<void> {
  try {
    runNeonctl(['me'], {
      apiKey,
      configDir,
      cwd: projectDir,
      output: 'json',
    });
    return;
  } catch {
    if (!process.stdin.isTTY || isNonInteractive()) {
      raiseNeedsUserAction({
        code: 'neon_auth_required',
        message: 'Neon authentication is required before setup can continue.',
        hint: 'Set NEON_API_KEY/--api-key for automation, or complete a one-time neonctl auth flow.',
        action: {
          type: 'open_browser',
          title: 'Neon Login',
          message: 'This step opens the official neonctl browser flow and requires the user to finish sign-in.',
          command: 'neonctl auth',
          instructions: [
            'Run the login command in an interactive terminal, or provide --api-key/NEON_API_KEY.',
            'After authentication succeeds, rerun the original EdgeBase command.',
          ],
        },
      });
    }
  }

  console.log(chalk.blue('🌅 Authenticating with Neon...'));
  console.log(chalk.dim('  EdgeBase will open the official neonctl auth flow if needed.'));
  runNeonctlInteractive(['auth'], {
    apiKey,
    configDir,
    cwd: projectDir,
  });
}

export async function runNeonSetup(options: RunNeonSetupOptions): Promise<RunNeonSetupResult> {
  const projectDir = options.projectDir ? resolve(options.projectDir) : resolve('.');
  const configPath = join(projectDir, 'edgebase.config.ts');
  const configJson = options.configJson ?? (existsSync(configPath)
    ? loadConfigSafe(configPath, projectDir, FULL_CONFIG_EVAL)
    : null);

  const target = buildExplicitTarget({
    auth: options.auth,
    namespace: options.namespace,
    configJson,
    envKeyOverride: options.envKeyOverride,
    targetLabelOverride: options.targetLabelOverride,
  }) ?? resolveNeonSetupTarget(
    { auth: options.auth, namespace: options.namespace },
    configJson,
  );

  if (!target) {
    const targets = listNeonSetupTargets(configJson);
    if (targets.length === 0) {
      throw new Error("No PostgreSQL-backed targets found. Set provider: 'postgres' (legacy 'neon' also works) first.");
    }
    const selection = await promptSelect(
      'Which Neon target do you want to configure?',
      targets.map((entry) => entry.label),
      {
        field: 'target',
        message: 'Multiple PostgreSQL-backed targets were found.',
        hint: 'Rerun with --auth or --namespace <name> explicitly.',
        choices: targets.map((entry) => ({
          label: entry.label,
          value: entry.kind === 'auth' ? 'auth' : entry.namespace ?? entry.label,
          args: entry.kind === 'auth' ? ['--auth'] : ['--namespace', entry.namespace ?? entry.label],
        })),
      },
    );
    const resolved = targets.find((entry) => entry.label === selection) ?? null;
    if (!resolved) {
      throw new Error('Failed to resolve the selected Neon target.');
    }
    return runNeonSetup({
      ...options,
      auth: resolved.kind === 'auth',
      namespace: resolved.namespace,
      envKeyOverride: resolved.envKey,
      targetLabelOverride: resolved.label,
      configJson,
    });
  }

  const defaults = buildProjectDefaults(projectDir, target);
  const desiredProjectName = options.projectName ?? defaults.defaultProjectName;
  const databaseName = options.database ?? defaults.defaultDatabaseName;
  const roleName = options.role ?? defaults.defaultRoleName;
  const apiKey = options.apiKey ?? process.env.NEON_API_KEY;
  const neonOptions = {
    apiKey,
    configDir: options.configDir,
    cwd: projectDir,
  } as const;

  await ensureNeonAuth(projectDir, apiKey, options.configDir);

  const { projectId, projectName } = await resolveProjectForMode({
    mode: options.projectMode ?? 'auto',
    desiredProjectName,
    orgId: options.orgId,
    explicitProjectId: options.projectId,
    databaseName,
    roleName,
    neonOptions,
  });

  let branch = options.branch;
  if (!branch && projectId && process.stdin.isTTY && !isNonInteractive()) {
    try {
      const branches = listNeonBranches(projectId, neonOptions);
      if (branches.length > 1) {
        const defaultBranch = branches.find((entry) => entry.default || entry.primary);
        const labels = branches.map((entry) => (entry.default || entry.primary ? `${entry.name} (default)` : entry.name));
        const selected = await promptSelect('Which Neon branch do you want to use?', labels);
        const selectedIndex = labels.indexOf(selected);
        branch = branches[selectedIndex]?.name ?? defaultBranch?.name;
      }
    } catch {
      // Fall back to Neon default branch.
    }
  }

  const roleNames = listNeonRoles(projectId, branch, neonOptions);
  if (!roleNames.includes(roleName)) {
    const args = ['role', 'create', '--project-id', projectId, '--name', roleName];
    if (branch) args.push('--branch', branch);
    runNeonctl(args, { ...neonOptions, output: 'json' });
  }

  const databaseNames = listNeonDatabases(projectId, branch, neonOptions);
  if (!databaseNames.includes(databaseName)) {
    const args = [
      'database',
      'create',
      '--project-id',
      projectId,
      '--name',
      databaseName,
      '--owner-name',
      roleName,
    ];
    if (branch) args.push('--branch', branch);
    runNeonctl(args, { ...neonOptions, output: 'json' });
  }

  const connectionArgs = ['connection-string'];
  if (branch) connectionArgs.push(branch);
  if (projectId) connectionArgs.push('--project-id', projectId);
  if (databaseName) connectionArgs.push('--database-name', databaseName);
  if (roleName) connectionArgs.push('--role-name', roleName);
  if (options.pooled) connectionArgs.push('--pooled');

  const output = runNeonctl(connectionArgs, {
    apiKey,
    configDir: options.configDir,
    cwd: projectDir,
    output: 'json',
  });
  const connectionString = parseNeonConnectionString(output);

  const envDevPath = writeProjectEnvValue(projectDir, '.env.development', target.envKey, connectionString);
  const envReleasePath = writeProjectEnvValue(projectDir, '.env.release', target.envKey, connectionString);

  return {
    target,
    connectionString,
    envDevPath,
    envReleasePath,
    projectId,
    projectName,
    databaseName,
    roleName,
    branch,
  };
}

export const neonCommand = new Command('neon')
  .description('Manage Neon PostgreSQL setup');

neonCommand
  .command('setup')
  .description('Authenticate with Neon and write postgres connection-string env keys')
  .option('--namespace <ns>', "DB block namespace configured with provider: 'postgres' (legacy 'neon' also works)")
  .option('--auth', "Configure auth.provider = 'postgres' (legacy 'neon' also works)")
  .option('--project-id <id>', 'Existing Neon project ID (omit to use current neonctl context)')
  .option('--project-name <name>', 'Neon project name (defaults to the EdgeBase app name)')
  .option('--org-id <id>', 'Neon organization ID for project lookup/creation')
  .option('--database <name>', 'Database name to use')
  .option('--role <name>', 'Database role to use')
  .option('--branch <branch>', 'Neon branch name or ID (defaults to Neon default branch)')
  .option('--api-key <key>', 'Neon API key (default: NEON_API_KEY or neonctl auth)')
  .option('--config-dir <dir>', 'Custom neonctl config directory')
  .option('--pooled', 'Use Neon pooled connection string')
  .action(async (options: {
    namespace?: string;
    auth?: boolean;
    projectId?: string;
    projectName?: string;
    orgId?: string;
    database?: string;
    role?: string;
    branch?: string;
    apiKey?: string;
    configDir?: string;
    pooled?: boolean;
  }) => {
    try {
      const result = await runNeonSetup({
        projectDir: resolve('.'),
        ...options,
      });

      if (isJson()) {
        console.log(JSON.stringify({
          status: 'success',
          target: result.target,
          envDevPath: result.envDevPath,
          envReleasePath: result.envReleasePath,
        }));
        return;
      }

      console.log(chalk.green('✓'), `Configured Neon target '${result.target.label}'.`);
      console.log(chalk.dim(`  Env key: ${result.target.envKey}`));
      console.log(chalk.dim(`  Updated: ${result.envDevPath}`));
      console.log(chalk.dim(`  Updated: ${result.envReleasePath}`));
      if (result.target.kind === 'database') {
        console.log(
          chalk.dim(
            `  Deploy will now provision Hyperdrive for '${result.target.namespace}' using ${result.target.envKey}.`,
          ),
        );
      } else {
        console.log(chalk.dim(`  Deploy will now provision auth Hyperdrive using ${result.target.envKey}.`));
      }
    } catch (error) {
      if (isCliStructuredError(error)) throw error;
      raiseCliError({
        code: 'neon_setup_failed',
        message: (error as Error).message,
      });
    }
  });
