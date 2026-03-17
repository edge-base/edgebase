/**
 * Bench entrypoint — re-exports the main app + DO classes for vitest-pool-workers.
 * This file is referenced by wrangler.bench.toml (main).
 */
export { default } from './index.js';
export { DatabaseDO } from './durable-objects/database-do.js';
export { AuthDO } from './durable-objects/auth-do.js';
export { RoomsDO } from './durable-objects/rooms-do.js';
export { DatabaseLiveDO } from './durable-objects/database-live-do.js';
