/**
 * Global CLI context — shared state for verbose/quiet/json modes.
 *
 * Set once in index.ts via `preAction` hook, read by all commands
 * and utility modules (spinner, update-check, etc.).
 */

export interface CliContext {
  verbose: boolean;
  quiet: boolean;
  json: boolean;
  nonInteractive: boolean;
}

const GLOBAL_CLI_CONTEXT_KEY = '__edgebaseCliContext';

const globalScope = globalThis as typeof globalThis & {
  __edgebaseCliContext?: CliContext;
};

// Keep one shared CLI context even when modules are reloaded in tests or by dynamic imports.
const ctx: CliContext = globalScope[GLOBAL_CLI_CONTEXT_KEY]
  ?? (globalScope[GLOBAL_CLI_CONTEXT_KEY] = {
    verbose: false,
    quiet: false,
    json: false,
    nonInteractive: false,
  });

export function setContext(opts: Partial<CliContext>): void {
  Object.assign(ctx, opts);
}

export function getContext(): Readonly<CliContext> {
  return ctx;
}

// ─── Convenience helpers ───

/** True when --verbose flag is set. */
export function isVerbose(): boolean {
  return ctx.verbose;
}

/** True when --quiet or --json flag is set (suppress non-essential output). */
export function isQuiet(): boolean {
  return ctx.quiet || ctx.json;
}

/** True when --json flag is set (structured output mode). */
export function isJson(): boolean {
  return ctx.json;
}

/** True when prompts/browser flows should not auto-run and must be explicit. */
export function isNonInteractive(): boolean {
  return ctx.nonInteractive;
}
