/**
 * Context management for legacy isolateBy compatibility state.
 * HTTP DB routing now uses explicit `db(namespace, instanceId)` paths.
 */

import { EdgeBaseError } from './errors.js';

export type ContextValue = Record<string, string>;

/** Internal event type for context changes */
export type ContextChangeHandler = (ctx: ContextValue) => void;

export class ContextManager {
  private context: ContextValue = {};
  private listeners: ContextChangeHandler[] = [];

  /**
   * Set isolateBy context keys.
   * Retained for SDK compatibility; current HTTP clients do not serialize this
   * state into request headers.
   *
   * NOTE: 'auth.id' key is silently ignored (server extracts from JWT).
   *
   * @example
   * client.setContext({ workspaceId: 'ws-123' });
   */
  setContext(ctx: ContextValue): void {
    // Filter out auth.id — server extracts from JWT only
    const filtered: ContextValue = {};
    for (const [key, value] of Object.entries(ctx)) {
      if (key === 'auth.id') continue;
      filtered[key] = value;
    }
    this.context = filtered;

    // Emit contextChange event (M5: internal event only; M6: Database Live reconnect)
    for (const listener of this.listeners) {
      listener(this.context);
    }
  }

  /**
   * Get the current context value
   */
  getContext(): ContextValue {
    return { ...this.context };
  }

  /**
   * Validate that a required isolateBy key is present in context.
   * Throws EdgeBaseError if missing (pre-server-call defense,).
   */
  requireContextKey(key: string): void {
    if (key === 'auth.id') return; // auth.id is handled via JWT, not context
    if (!(key in this.context)) {
      throw new EdgeBaseError(
        400,
        `Missing context key "${key}". Provide it when calling db(namespace, id).`,
      );
    }
  }

  /**
   * Subscribe to context changes (internal use for Database Live reconnect in M6)
   */
  onContextChange(handler: ContextChangeHandler): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter((h) => h !== handler);
    };
  }
}
