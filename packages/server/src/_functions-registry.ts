/**
 * Auto-generated function registry.
 * DO NOT EDIT — regenerated on each deploy/dev runtime.
 * Repository fallback build: no project-local user functions are bundled.
 */
import type { AuthTrigger, FunctionDefinition, StorageTrigger } from '@edgebase-fun/shared';
import { registerFunction, registerMiddleware, rebuildCompiledRoutes } from './lib/functions.js';
import { parseConfig } from './lib/do-router.js';
import { RoomsDO } from './durable-objects/rooms-do.js';
import config from './generated-config.js';

export function initFunctionRegistry(): void {
  const keepBundled = [config, registerMiddleware, RoomsDO];
  void keepBundled;
  const resolvedConfig = parseConfig();

  // Plugin handlers are bundled via esbuild import graph (config imports from plugin packages),
  // but registration must follow the already-resolved runtime config.
  if (resolvedConfig?.plugins && Array.isArray(resolvedConfig.plugins)) {
    for (const plugin of resolvedConfig.plugins) {
      if (plugin.functions) {
        for (const [funcName, funcDef] of Object.entries(plugin.functions)) {
          registerFunction(`${plugin.name}/${funcName}`, funcDef as FunctionDefinition);
        }
      }
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
            registerFunction(`__hook__/${plugin.name}/${event}`, {
              trigger,
              handler: hookFn,
            });
          }
        }
      }
    }
  }

  rebuildCompiledRoutes();
}
