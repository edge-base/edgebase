import type { Env } from '../types.js';

export interface ResolvedRoomRuntime {
  target: 'rooms';
  binding: DurableObjectNamespace;
}

/** Resolve the Room DO binding. */
export function resolveRoomRuntime(env: Env): ResolvedRoomRuntime {
  return {
    target: 'rooms',
    binding: env.ROOMS,
  };
}
