import type { AuthDb } from './auth-db-adapter.js';
import { D1AuthDb } from './auth-db-adapter.js';

export type ControlDb = AuthDb;

export const CONTROL_D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let controlSchemaInitialized = false;

export async function ensureControlSchema(db: ControlDb): Promise<void> {
  if (controlSchemaInitialized) return;

  const statements = CONTROL_D1_SCHEMA.split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  await db.batch(statements.map((sql) => ({ sql })));
  controlSchemaInitialized = true;
}

export function resetControlSchemaInit(): void {
  controlSchemaInitialized = false;
}

export function resolveControlDb(env: Record<string, unknown>): ControlDb {
  const d1 = env.CONTROL_DB as D1Database | undefined;
  if (!d1) {
    throw new Error('CONTROL_DB D1 binding is not available in the environment.');
  }
  return new D1AuthDb(d1);
}
