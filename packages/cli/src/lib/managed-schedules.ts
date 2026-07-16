import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  Node,
  Project,
  SyntaxKind,
  type Expression,
  type ObjectLiteralExpression,
  type SourceFile,
} from 'ts-morph';
import {
  SYSTEM_MAINTENANCE_CRON,
  SYSTEM_MAINTENANCE_SCHEDULE_ID,
  MAX_MANAGED_SCHEDULE_ENTRIES,
  appFunctionScheduleIdentity,
  extraCronScheduleIdentity,
  normalizeCronExpression,
  pluginFunctionScheduleIdentity,
} from '@edge-base/shared';

export { SYSTEM_MAINTENANCE_CRON } from '@edge-base/shared';

export interface ScannedScheduleTrigger {
  exportName: string;
  cron: string;
}

export interface ScannedFunctionDefinitions {
  definedFunctionExports: string[];
  scheduleTriggers: ScannedScheduleTrigger[];
}

export type ManagedScheduleSource =
  | {
    type: 'app-function';
    route: string;
    file: string;
    exportName: string;
  }
  | {
    type: 'plugin-function';
    pluginName: string;
    functionName: string;
  }
  | {
    type: 'extra-cron';
  }
  | {
    type: 'system';
    name: 'maintenance';
  };

export interface ManagedScheduleEntry {
  id: string;
  cron: string;
  source: ManagedScheduleSource;
}

export interface ManagedScheduleManifest {
  schemaVersion: 1;
  timezone: 'UTC';
  entries: ManagedScheduleEntry[];
  /** Normalized, expression-deduplicated provider wake-up triggers. */
  crons: string[];
  /** Digest of schemaVersion, timezone, entries, and crons. */
  digest: `sha256:${string}`;
}

interface ScheduleScannedFunction {
  name: string;
  relativePath: string;
  scheduleTriggers?: ScannedScheduleTrigger[];
}

function unwrapExpression(expression: Expression): Expression {
  let current = expression;
  while (
    Node.isParenthesizedExpression(current)
    || Node.isAsExpression(current)
    || Node.isSatisfiesExpression(current)
    || Node.isTypeAssertion(current)
    || Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

function resolveConstExpression(
  expression: Expression,
  sourceFile: SourceFile,
  context: string,
  seen = new Set<string>(),
): Expression {
  const unwrapped = unwrapExpression(expression);
  if (!Node.isIdentifier(unwrapped)) return unwrapped;

  const name = unwrapped.getText();
  if (seen.has(name)) throw new Error(`${context} contains a circular static reference '${name}'.`);
  const declaration = sourceFile.getVariableDeclaration(name);
  if (!declaration || declaration.getVariableStatement()?.getDeclarationKind() !== 'const') {
    throw new Error(`${context} must be statically declared; '${name}' is not a resolvable const.`);
  }
  const initializer = declaration.getInitializer();
  if (!initializer) throw new Error(`${context} const '${name}' has no initializer.`);

  const nextSeen = new Set(seen);
  nextSeen.add(name);
  return resolveConstExpression(initializer, sourceFile, context, nextSeen);
}

function resolveLocalConstExpression(
  expression: Expression,
  sourceFile: SourceFile,
  seen = new Set<string>(),
): Expression | null {
  const unwrapped = unwrapExpression(expression);
  if (!Node.isIdentifier(unwrapped)) return unwrapped;
  const name = unwrapped.getText();
  if (seen.has(name)) throw new Error(`Function declaration contains a circular static reference '${name}'.`);
  const declaration = sourceFile.getVariableDeclaration(name);
  if (!declaration || declaration.getVariableStatement()?.getDeclarationKind() !== 'const') return null;
  const initializer = declaration.getInitializer();
  if (!initializer) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(name);
  return resolveLocalConstExpression(initializer, sourceFile, nextSeen);
}

function readStaticString(
  expression: Expression,
  sourceFile: SourceFile,
  context: string,
): string {
  const resolved = resolveConstExpression(expression, sourceFile, context);
  if (Node.isStringLiteral(resolved) || Node.isNoSubstitutionTemplateLiteral(resolved)) {
    return resolved.getLiteralText();
  }
  throw new Error(`${context} must be a static string literal; received '${resolved.getText()}'.`);
}

function getObjectPropertyExpression(
  object: ObjectLiteralExpression,
  name: string,
  context: string,
): Expression | undefined {
  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      throw new Error(`${context} cannot use object spread because schedule metadata would be ambiguous.`);
    }
    const nameNode = 'getNameNode' in property ? property.getNameNode() : undefined;
    if (nameNode && Node.isComputedPropertyName(nameNode)) {
      throw new Error(`${context} cannot use computed properties because schedule metadata would be ambiguous.`);
    }
  }

  const matching = object.getProperties().filter((property) => {
    if (!('getName' in property)) return false;
    return property.getName() === name;
  });
  if (matching.length > 1) throw new Error(`${context} declares '${name}' more than once.`);
  const property = matching[0];
  if (!property) return undefined;
  if (Node.isPropertyAssignment(property)) return property.getInitializerOrThrow();
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  throw new Error(`${context}.${name} must be a static property value.`);
}

function getDefineFunctionNames(sourceFile: SourceFile): {
  direct: Set<string>;
  namespaces: Set<string>;
} {
  const direct = new Set(['defineFunction']);
  const namespaces = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    for (const named of declaration.getNamedImports()) {
      if (named.getName() === 'defineFunction') {
        direct.add(named.getAliasNode()?.getText() ?? named.getName());
      }
    }
    const namespace = declaration.getNamespaceImport();
    if (namespace) namespaces.add(namespace.getText());
  }
  return { direct, namespaces };
}

function isDefineFunctionCall(
  expression: Expression,
  names: ReturnType<typeof getDefineFunctionNames>,
): boolean {
  if (!Node.isCallExpression(expression)) return false;
  const callee = unwrapExpression(expression.getExpression());
  if (Node.isIdentifier(callee)) return names.direct.has(callee.getText());
  return Node.isPropertyAccessExpression(callee)
    && callee.getName() === 'defineFunction'
    && Node.isIdentifier(callee.getExpression())
    && names.namespaces.has(callee.getExpression().getText());
}

function extractScheduleFromTrigger(
  expression: Expression,
  sourceFile: SourceFile,
  context: string,
): string | null {
  const resolved = resolveConstExpression(expression, sourceFile, `${context}.trigger`);
  if (!Node.isObjectLiteralExpression(resolved)) {
    throw new Error(`${context}.trigger must be a statically resolvable object.`);
  }
  const typeExpression = getObjectPropertyExpression(resolved, 'type', `${context}.trigger`);
  if (!typeExpression) throw new Error(`${context}.trigger must declare a static type.`);
  const type = readStaticString(typeExpression, sourceFile, `${context}.trigger.type`);
  if (type !== 'schedule') return null;

  const cronExpression = getObjectPropertyExpression(resolved, 'cron', `${context}.trigger`);
  if (!cronExpression) throw new Error(`${context}.trigger.cron is required for a schedule function.`);
  const cron = readStaticString(cronExpression, sourceFile, `${context}.trigger.cron`);
  try {
    return normalizeCronExpression(cron);
  } catch (error) {
    throw new Error(
      `${context}.trigger.cron is not a portable EdgeBase cron: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function extractScheduleFromDefinition(
  expression: Expression,
  sourceFile: SourceFile,
  names: ReturnType<typeof getDefineFunctionNames>,
  context: string,
): string | null {
  const resolved = resolveConstExpression(expression, sourceFile, context);
  let definition = resolved;
  if (isDefineFunctionCall(resolved, names)) {
    if (!Node.isCallExpression(resolved)) {
      throw new Error(`${context} contains an invalid defineFunction declaration.`);
    }
    const argument = resolved.getArguments()[0];
    if (!argument || !Node.isExpression(argument)) {
      throw new Error(`${context} defineFunction() must receive a statically inspectable argument.`);
    }
    const unwrappedArgument = resolveConstExpression(argument, sourceFile, context);
    if (Node.isArrowFunction(unwrappedArgument) || Node.isFunctionExpression(unwrappedArgument)) return null;
    definition = unwrappedArgument;
  } else if (Node.isArrowFunction(resolved) || Node.isFunctionExpression(resolved)) {
    return null;
  }

  if (!Node.isObjectLiteralExpression(definition)) {
    if (isDefineFunctionCall(resolved, names)) {
      throw new Error(`${context} must resolve to a static function definition object.`);
    }
    return null;
  }

  const triggerExpression = getObjectPropertyExpression(definition, 'trigger', context);
  if (!triggerExpression) return null;
  return extractScheduleFromTrigger(triggerExpression, sourceFile, context);
}

/**
 * Extract exported filesystem schedule declarations without executing user
 * source. Any defineFunction declaration that could hide schedule metadata is
 * rejected instead of silently omitted from the build manifest.
 */
export function inspectFileFunctionDefinitions(
  filePath: string,
  sourceText = readFileSync(filePath, 'utf-8'),
): ScannedFunctionDefinitions {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const sourceFile = project.createSourceFile(filePath, sourceText);
  const names = getDefineFunctionNames(sourceFile);
  const triggers: ScannedScheduleTrigger[] = [];
  const definedFunctionExports: string[] = [];
  const inspectedCalls = new Set<number>();

  const inspect = (exportName: string, expression: Expression, context: string): void => {
    const resolved = resolveConstExpression(expression, sourceFile, context);
    if (isDefineFunctionCall(resolved, names)) inspectedCalls.add(resolved.getStart());
    const cron = extractScheduleFromDefinition(expression, sourceFile, names, context);
    if (cron) triggers.push({ exportName, cron });
  };

  for (const assignment of sourceFile.getExportAssignments()) {
    if (assignment.isExportEquals()) continue;
    const expression = unwrapExpression(assignment.getExpression());
    if (Node.isIdentifier(expression) && sourceFile.getFunction(expression.getText())) {
      // A local function declaration is unambiguously an HTTP handler.
      continue;
    }
    inspect('default', assignment.getExpression(), `${filePath} default export`);
  }

  for (const statement of sourceFile.getVariableStatements()) {
    if (!statement.isExported()) continue;
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer) continue;
      const exportName = declaration.getName();
      if (exportName === 'trigger') continue;
      const resolved = resolveLocalConstExpression(initializer, sourceFile);
      // Named HTTP exports are always registered as HTTP handlers. Imported or
      // otherwise non-local handlers therefore require no schedule inspection.
      if (!resolved) continue;
      if (!isDefineFunctionCall(resolved, names)) continue;
      inspectedCalls.add(resolved.getStart());
      const cron = extractScheduleFromDefinition(
        initializer,
        sourceFile,
        names,
        `${filePath} export '${exportName}'`,
      );
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(exportName)) {
        if (cron) {
          throw new Error(
            `${filePath} export '${exportName}' is an HTTP method export and cannot declare a schedule trigger.`,
          );
        }
        continue;
      }
      definedFunctionExports.push(exportName);
      if (cron) triggers.push({ exportName, cron });
    }
  }

  // A schedule defineFunction that is not one of the registry's supported
  // exported forms must stop the build rather than disappearing from inventory.
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isDefineFunctionCall(call, names) || inspectedCalls.has(call.getStart())) continue;
    const cron = extractScheduleFromDefinition(
      call,
      sourceFile,
      names,
      `${filePath} unregistered defineFunction at ${call.getStartLineNumber()}`,
    );
    if (cron) {
      throw new Error(
        `${filePath} contains a schedule defineFunction that is not an exported default or named function.`,
      );
    }
  }

  return {
    definedFunctionExports: definedFunctionExports.sort(),
    scheduleTriggers: triggers.sort((a, b) => (
      a.exportName < b.exportName ? -1 : a.exportName > b.exportName ? 1 : 0
    )),
  };
}

export function extractFileScheduleTriggers(filePath: string): ScannedScheduleTrigger[] {
  return inspectFileFunctionDefinitions(filePath).scheduleTriggers;
}

function buildDigest(payload: Omit<ManagedScheduleManifest, 'digest'>): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

/** Build the single immutable schedule authority shared by hosted and self-hosted artifacts. */
export function buildManagedScheduleManifest(
  functions: ScheduleScannedFunction[],
  config: Record<string, unknown>,
): ManagedScheduleManifest {
  const entries: ManagedScheduleEntry[] = [];
  const ids = new Set<string>();
  const add = (entry: ManagedScheduleEntry): void => {
    if (entries.length >= MAX_MANAGED_SCHEDULE_ENTRIES) {
      throw new Error(
        `Managed schedule inventory exceeds ${MAX_MANAGED_SCHEDULE_ENTRIES} entries.`,
      );
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate managed schedule identity '${entry.id}'.`);
    ids.add(entry.id);
    entries.push(entry);
  };

  for (const fn of functions) {
    for (const trigger of fn.scheduleTriggers ?? []) {
      const route = fn.name || '/';
      add({
        id: appFunctionScheduleIdentity(route, trigger.exportName),
        cron: normalizeCronExpression(trigger.cron),
        source: {
          type: 'app-function',
          route,
          file: `functions/${fn.relativePath}`,
          exportName: trigger.exportName,
        },
      });
    }
  }

  const plugins = config.plugins;
  if (plugins !== undefined && !Array.isArray(plugins)) {
    throw new Error('plugins must be an array before managed schedules can be built.');
  }
  for (const pluginValue of plugins ?? []) {
    if (!pluginValue || typeof pluginValue !== 'object' || Array.isArray(pluginValue)) {
      throw new Error('Every plugin must be a statically evaluated object before managed schedules can be built.');
    }
    const plugin = pluginValue as Record<string, unknown>;
    if (typeof plugin.name !== 'string' || !plugin.name) throw new Error('Every plugin must have a stable name.');
    if (plugin.functions !== undefined && (!plugin.functions || typeof plugin.functions !== 'object' || Array.isArray(plugin.functions))) {
      throw new Error(`Plugin '${plugin.name}' functions must be an object.`);
    }
    for (const [functionName, functionValue] of Object.entries(
      (plugin.functions as Record<string, unknown> | undefined) ?? {},
    )) {
      if (!functionValue || typeof functionValue !== 'object' || Array.isArray(functionValue)) {
        throw new Error(`Plugin '${plugin.name}' function '${functionName}' did not evaluate to a definition.`);
      }
      const trigger = (functionValue as { trigger?: unknown }).trigger;
      if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
        throw new Error(`Plugin '${plugin.name}' function '${functionName}' has no resolved trigger.`);
      }
      const triggerRecord = trigger as Record<string, unknown>;
      if (typeof triggerRecord.type !== 'string') {
        throw new Error(`Plugin '${plugin.name}' function '${functionName}' has no resolved trigger type.`);
      }
      if (triggerRecord.type !== 'schedule') continue;
      if (typeof triggerRecord.cron !== 'string') {
        throw new Error(`Plugin '${plugin.name}' schedule function '${functionName}' has no resolved cron.`);
      }
      const cron = normalizeCronExpression(triggerRecord.cron);
      add({
        id: pluginFunctionScheduleIdentity(plugin.name, functionName),
        cron,
        source: { type: 'plugin-function', pluginName: plugin.name, functionName },
      });
    }
  }

  const extraCrons = (config.cloudflare as { extraCrons?: unknown } | undefined)?.extraCrons;
  if (extraCrons !== undefined && !Array.isArray(extraCrons)) {
    throw new Error('cloudflare.extraCrons must be an array before managed schedules can be built.');
  }
  const seenExtraCrons = new Set<string>();
  for (const value of extraCrons ?? []) {
    if (typeof value !== 'string') throw new Error('cloudflare.extraCrons must contain only strings.');
    const cron = normalizeCronExpression(value);
    if (seenExtraCrons.has(cron)) continue;
    seenExtraCrons.add(cron);
    add({ id: extraCronScheduleIdentity(cron), cron, source: { type: 'extra-cron' } });
  }

  add({
    id: SYSTEM_MAINTENANCE_SCHEDULE_ID,
    cron: SYSTEM_MAINTENANCE_CRON,
    source: { type: 'system', name: 'maintenance' },
  });

  entries.sort((a, b) => {
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    if (a.cron !== b.cron) return a.cron < b.cron ? -1 : 1;
    return 0;
  });
  const payload: Omit<ManagedScheduleManifest, 'digest'> = {
    schemaVersion: 1,
    timezone: 'UTC',
    entries,
    crons: [...new Set(entries.map((entry) => entry.cron))].sort(),
  };
  return { ...payload, digest: buildDigest(payload) };
}
