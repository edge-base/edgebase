import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * Scanned function metadata from file-system routing.
 */
export interface ScannedFunction {
  /** Route name derived from file path (e.g., 'users/[userId]/profile'). */
  name: string;
  /** Relative file path from functions/ (e.g., 'users/[userId]/profile.ts'). */
  relativePath: string;
  /** Named HTTP method exports found (e.g., ['GET', 'POST']). */
  methods: string[];
  /** Whether this file has a default export. */
  hasDefaultExport: boolean;
  /** Whether this file exports module-level trigger metadata. */
  hasTriggerExport?: boolean;
  /** Whether this is a middleware file (_middleware.ts). */
  isMiddleware: boolean;
}

/**
 * Build a route name from a relative file path.
 * - Strip .ts extension
 * - Strip /index → parent path
 * - Strip (group) parenthesis directories from URL path
 * - Preserve [param] and [...slug] segments
 */
export function buildRouteName(relPath: string): string {
  let name = relPath.replace(/\.ts$/, '');
  if (name === 'index') return '';
  name = name.replace(/\/index$/, '');
  name = name.replace(/\(([^)]+)\)\//g, '');
  name = name.replace(/^\(([^)]+)\)$/, '');
  return name;
}

/**
 * Detect named exports (GET, POST, PUT, PATCH, DELETE) and default export.
 * Uses regex scanning — no full TS parser needed.
 */
export function detectExports(filePath: string): {
  methods: string[];
  hasDefaultExport: boolean;
  hasTriggerExport: boolean;
} {
  const content = readFileSync(filePath, 'utf-8');
  const methods: string[] = [];
  const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  for (const method of validMethods) {
    if (new RegExp(`export\\s+(?:(?:async\\s+)?function|const|let|var)\\s+${method}\\b`).test(content)) {
      methods.push(method);
    }
  }
  const hasDefaultExport = /export\s+default\b/.test(content);
  const hasTriggerExport =
    /export\s+(?:(?:const|let|var)\s+trigger\b|(?:async\s+)?function\s+trigger\b)/.test(content);
  return { methods, hasDefaultExport, hasTriggerExport };
}

/**
 * Scan functions/ directory recursively for .ts files.
 * Returns array of ScannedFunction with file-system routing metadata.
 * - Directory structure maps to URL paths (SvelteKit-style)
 * - Files starting with _ are ignored (except _middleware.ts)
 * - (group) directories are stripped from URL paths
 * - [param] and [...slug] segments are preserved for dynamic routing
 */
export function scanFunctions(functionsDir: string): ScannedFunction[] {
  const results: ScannedFunction[] = [];

  function scan(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('_')) continue;
        scan(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;

      if (entry.name === '_middleware.ts') {
        const relPath = relative(functionsDir, fullPath).replace(/\\/g, '/');
        const middlewareDir = relPath.replace(/_middleware\.ts$/, '').replace(/\/$/, '');
        results.push({
          name: middlewareDir ? `${middlewareDir}/_middleware` : '_middleware',
          relativePath: relPath,
          methods: [],
          hasDefaultExport: true,
          isMiddleware: true,
        });
        continue;
      }

      if (entry.name.startsWith('_')) continue;

      const relPath = relative(functionsDir, fullPath).replace(/\\/g, '/');
      const routeName = buildRouteName(relPath);
      const { methods, hasDefaultExport, hasTriggerExport } = detectExports(fullPath);

      results.push({
        name: routeName,
        relativePath: relPath,
        methods,
        hasDefaultExport,
        hasTriggerExport,
        isMiddleware: false,
      });
    }
  }

  scan(functionsDir);
  return results;
}

/**
 * Validate that route names don't conflict.
 */
export function validateRouteNames(functions: ScannedFunction[]): void {
  const seen = new Map<string, string>();
  for (const fn of functions) {
    if (fn.isMiddleware) continue;
    const key = fn.name;
    if (seen.has(key)) {
      throw new Error(
        `Route name conflict: '${key}' is defined by multiple files:\n` +
          `  - functions/${seen.get(key)}\n` +
          `  - functions/${fn.relativePath}\n` +
          'Rename one of the files to resolve the conflict.',
      );
    }
    seen.set(key, fn.relativePath);
  }
}

/**
 * Generate the Lazy Import registry file (_functions-registry.ts).
 * Supports file-system routing with named method exports and middleware.
 */
export function generateFunctionRegistry(
  functions: ScannedFunction[],
  outputPath: string,
  options?: { configImportPath?: string; functionsImportBasePath?: string },
): void {
  const imports: string[] = [];
  const registrations: string[] = [];
  const middlewareRegistrations: string[] = [];
  const configImportPath = options?.configImportPath ?? '../../../../edgebase.config.ts';
  const functionsImportBasePath =
    options?.functionsImportBasePath ??
    relative(dirname(outputPath), join(dirname(outputPath), '..', '..', '..', '..', 'functions'))
      .replace(/\\/g, '/');

  for (const fn of functions) {
    const importPath = `${functionsImportBasePath}/${fn.relativePath}`;
    const safeName = fn.relativePath.replace(/\.ts$/, '').replace(/[^a-zA-Z0-9_]/g, '_');

    if (fn.isMiddleware) {
      imports.push(`import ${safeName}_module from '${importPath}';`);
      const middlewareDir = fn.relativePath.replace(/\/?_middleware\.ts$/, '');
      middlewareRegistrations.push(`  registerMiddleware('${middlewareDir}', ${safeName}_module);`);
      continue;
    }

    if (fn.methods.length > 0) {
      imports.push(`import * as ${safeName}_module from '${importPath}';`);
      for (const method of fn.methods) {
        const regName = fn.name || '/';
        const runtimeTriggerArg = fn.hasTriggerExport ? `, ${safeName}_module.trigger` : '';
        registrations.push(
          `  registerFunction('${regName}', wrapMethodExport(${safeName}_module.${method}, '${method}'${runtimeTriggerArg}));`,
        );
      }
    } else if (fn.hasDefaultExport) {
      imports.push(`import ${safeName}_module from '${importPath}';`);
      registrations.push(`  registerFunction('${fn.name || '/'}', ${safeName}_module);`);
    }
  }

  const content = `/**
 * Auto-generated function registry.
 * DO NOT EDIT — regenerated on each deploy.
 * Generated at: ${new Date().toISOString()}
 */
import type { AuthTrigger, FunctionDefinition, StorageTrigger } from '@edgebase-fun/shared';
import { registerFunction, registerMiddleware, wrapMethodExport, rebuildCompiledRoutes } from './lib/functions.js';
import { parseConfig } from './lib/do-router.js';
import { RoomsDO } from './durable-objects/rooms-do.js';
import config from '${configImportPath}';

${imports.join('\n')}

export function initFunctionRegistry(): void {
${middlewareRegistrations.join('\n')}
${registrations.join('\n')}

  const keepBundled = [config, registerMiddleware, RoomsDO];
  void keepBundled;
  const resolvedConfig = parseConfig();

  // ─── Plugin Functions + Hooks Registration (Explicit Import Pattern) ───
  // Plugin handlers are bundled via esbuild import graph (config imports from plugin packages),
  // but registration must follow the already-resolved runtime config.
  // pluginConfig is already injected by the factory closure in definePlugin().
  if (resolvedConfig?.plugins && Array.isArray(resolvedConfig.plugins)) {
    for (const plugin of resolvedConfig.plugins) {
      // Register plugin functions
      if (plugin.functions) {
        for (const [funcName, funcDef] of Object.entries(plugin.functions)) {
          registerFunction(\`\${plugin.name}/\${funcName}\`, funcDef as FunctionDefinition);
        }
      }
      // Register plugin hooks as FunctionDefinition entries
      // Auth hooks: getFunctionsByTrigger('auth', { event })
      // Storage hooks: getFunctionsByTrigger('storage', { event })
      if (plugin.hooks) {
        const STORAGE_EVENTS = new Set<StorageTrigger['event']>([
          'beforeUpload',
          'afterUpload',
          'beforeDownload',
          'beforeDelete',
          'afterDelete',
          'onMetadataUpdate',
        ]);
        for (const [event, hookFn] of Object.entries(plugin.hooks)) {
          if (typeof hookFn === 'function') {
            const trigger = STORAGE_EVENTS.has(event as StorageTrigger['event'])
              ? { type: 'storage' as const, event: event as StorageTrigger['event'] }
              : { type: 'auth' as const, event: event as AuthTrigger['event'] };
            registerFunction(\`__hook__/\${plugin.name}/\${event}\`, {
              trigger,
              handler: hookFn,
            });
          }
        }
      }
    }
  }

  // Compile route patterns for file-system routing (dynamic params, catch-all, specificity ordering)
  rebuildCompiledRoutes();
}
`;

  const outputDir = join(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  writeFileSync(outputPath, content, 'utf-8');
}
