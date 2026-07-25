import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TableConfig } from '@edge-base/shared';
import type { PostgresExecutor, PostgresQueryResult } from '../lib/postgres-executor.js';
import { buildPgFtsArtifactQuery, resolvePgInitOrder } from '../lib/postgres-schema-init.js';
import {
	computeSchemaHashSync,
	computePgFtsSignature,
	generatePgPreparationColumnDDL,
	planPostgresFieldUniqueIndex,
	postgresUniqueDuplicateError,
} from '../lib/schema.js';

interface PgSchemaCall {
	sql: string;
	params: unknown[];
}

interface PgIndexRow extends Record<string, unknown> {
	index_name: string;
	is_unique: boolean;
	is_primary: boolean;
	constraint_name: string | null;
	constraint_type: string | null;
	is_partial: boolean;
	columns: string[];
}

interface PgFtsArtifactOverrides extends Record<string, unknown> {
	legacyColumn?: boolean;
	legacyColumnPresent?: boolean;
	textColumn?: boolean;
	textColumnPresent?: boolean;
	maintenanceFunction?: boolean;
	maintenanceFunctionNameOccupied?: boolean;
	maintenanceFunctionRepairable?: boolean;
	maintenanceTrigger?: boolean;
	maintenanceTriggerNameOccupied?: boolean;
	maintenanceTriggerRepairable?: boolean;
	legacyIndex?: boolean;
	legacyIndexNameOccupied?: boolean;
	legacyIndexRepairable?: boolean;
	trigramIndex?: boolean;
	trigramIndexNameOccupied?: boolean;
	trigramIndexRepairable?: boolean;
}

function pgResult(rows: Record<string, unknown>[] = []): PostgresQueryResult {
	return {
		columns: rows.length > 0 ? Object.keys(rows[0]!) : [],
		rows,
		rowCount: rows.length,
	};
}

function createExistingContactsExecutor(options: {
	schemaHash?: string;
	migrationVersion?: string;
	ftsSignature?: string | null;
	ftsHealthy?: boolean;
	ftsArtifactOverrides?: PgFtsArtifactOverrides;
	duplicates?: boolean;
	indexes?: PgIndexRow[];
} = {}): {
	query: PostgresExecutor;
	calls: PgSchemaCall[];
	state: {
		schemaHash: string;
		migrationVersion: string;
		ftsSignature: string | null;
		ftsHealthy: boolean;
		ftsArtifactOverrides: PgFtsArtifactOverrides;
		duplicates: boolean;
		indexes: PgIndexRow[];
	};
} {
	const calls: PgSchemaCall[] = [];
	const state = {
		schemaHash: options.schemaHash ?? 'stale-schema-hash',
		migrationVersion: options.migrationVersion ?? '1',
		ftsSignature: options.ftsSignature ?? null,
		ftsHealthy: options.ftsHealthy ?? false,
		ftsArtifactOverrides: { ...(options.ftsArtifactOverrides ?? {}) },
		duplicates: options.duplicates ?? false,
		indexes: [...(options.indexes ?? [])],
	};
	let transactionSnapshot: typeof state | null = null;

	const query: PostgresExecutor = vi.fn(async (sql, params = []) => {
		calls.push({ sql, params: [...params] });

		if (sql === 'BEGIN') {
			transactionSnapshot = {
				...state,
				indexes: state.indexes.map((index) => ({ ...index, columns: [...index.columns] })),
			};
			return pgResult();
		}
		if (sql === 'COMMIT') {
			transactionSnapshot = null;
			return pgResult();
		}
		if (sql === 'ROLLBACK') {
			if (transactionSnapshot) {
				state.schemaHash = transactionSnapshot.schemaHash;
				state.migrationVersion = transactionSnapshot.migrationVersion;
				state.ftsSignature = transactionSnapshot.ftsSignature;
				state.ftsHealthy = transactionSnapshot.ftsHealthy;
				state.ftsArtifactOverrides = transactionSnapshot.ftsArtifactOverrides;
				state.duplicates = transactionSnapshot.duplicates;
				state.indexes = transactionSnapshot.indexes;
			}
			transactionSnapshot = null;
			return pgResult();
		}

		if (sql.includes('SELECT "value" FROM "_meta"')) {
			const key = String(params[0]);
			if (key === 'schemaHash:contacts') return pgResult([{ value: state.schemaHash }]);
			if (key === 'migration_version:contacts') {
				return pgResult([{ value: state.migrationVersion }]);
			}
			if (key === 'fts_signature:contacts' && state.ftsSignature !== null) {
				return pgResult([{ value: state.ftsSignature }]);
			}
			return pgResult();
		}
		if (sql.includes('information_schema.columns')) {
			return pgResult([
				{ column_name: 'id' },
				{ column_name: 'createdAt' },
				{ column_name: 'updatedAt' },
				{ column_name: 'email' },
			]);
		}
		if (sql.includes('WITH target AS MATERIALIZED')) {
			const healthy = state.ftsHealthy;
			return pgResult([{
				schemaName: 'public',
				tableFound: true,
				legacyColumnPresent: healthy,
				legacyColumn: healthy,
				textColumnPresent: healthy,
				textColumn: healthy,
				maintenanceFunction: healthy,
				maintenanceFunctionNameOccupied: healthy,
				maintenanceFunctionRepairable: healthy,
				maintenanceTrigger: healthy,
				maintenanceTriggerNameOccupied: healthy,
				maintenanceTriggerRepairable: healthy,
				legacyIndex: healthy,
				legacyIndexNameOccupied: healthy,
				legacyIndexRepairable: false,
				trigramIndex: healthy,
				trigramIndexNameOccupied: healthy,
				trigramIndexRepairable: false,
				...state.ftsArtifactOverrides,
			}]);
		}
		if (sql.includes('pg_index')) {
			return pgResult(state.indexes);
		}
		if (sql.includes('HAVING COUNT(*) > 1')) {
			return state.duplicates ? pgResult([{ duplicate: 1 }]) : pgResult();
		}
		if (sql.includes("DELETE FROM contacts WHERE id = 'older'")) {
			state.duplicates = false;
			return pgResult();
		}
		if (sql.startsWith('CREATE UNIQUE INDEX "uidx_contacts_email"')) {
			if (state.duplicates) throw new Error('duplicate key value violates unique constraint');
			state.indexes.push({
				index_name: 'uidx_contacts_email',
				is_unique: true,
				is_primary: false,
				constraint_name: null,
				constraint_type: null,
				is_partial: false,
				columns: ['email'],
			});
			return pgResult();
		}
		if (sql.startsWith('DROP INDEX IF EXISTS "uidx_contacts_email"')) {
			state.indexes = state.indexes.filter((index) =>
				index.index_name !== 'uidx_contacts_email',
			);
			return pgResult();
		}
		if (sql.includes('INSERT INTO "_meta"')) {
			const key = String(params[0]);
			const value = String(params[1]);
			if (key === 'schemaHash:contacts') state.schemaHash = value;
			if (key === 'migration_version:contacts') state.migrationVersion = value;
			if (key === 'fts_signature:contacts') state.ftsSignature = value;
			return pgResult();
		}
		if (sql.startsWith('UPDATE "contacts" SET "_fts_text"')) {
			state.ftsHealthy = true;
			state.ftsArtifactOverrides = {};
			return pgResult();
		}

		return pgResult();
	});

	return { query, calls, state };
}

async function ensureContacts(
	table: TableConfig,
	query: PostgresExecutor,
	namespace = `workspace-${Math.random()}`,
): Promise<void> {
	const { ensurePgSchema, _resetPgSchemaCache } = await import('../lib/postgres-schema-init.js');
	_resetPgSchemaCache();
	await ensurePgSchema(
		'postgres://edgebase:test@localhost/db',
		namespace,
		{ contacts: table },
		query,
	);
}

afterEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.doUnmock('../lib/postgres-executor.js');
});

describe('resolvePgInitOrder', () => {
	it('orders referenced tables before dependents', () => {
		const tables: Record<string, TableConfig> = {
			posts: {
				schema: {
					categoryId: { type: 'string', references: 'categories' },
				},
			},
			categories: {
				schema: {
					name: { type: 'string', required: true },
				},
			},
		};

		expect(resolvePgInitOrder(tables).map(([tableName]) => tableName)).toEqual([
			'categories',
			'posts',
		]);
	});

	it('ignores auth-only logical references when ordering', () => {
		const tables: Record<string, TableConfig> = {
			posts: {
				schema: {
					authorId: { type: 'string', references: 'users' },
				},
			},
			categories: {
				schema: {
					name: { type: 'string', required: true },
				},
			},
		};

		expect(resolvePgInitOrder(tables).map(([tableName]) => tableName)).toEqual([
			'posts',
			'categories',
		]);
	});

	it('caches schema initialization for the same namespace/config signature', async () => {
		const withPostgresConnection = vi.fn(async (_connectionString: string, fn: (query: (sql: string, params?: unknown[]) => Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number }>) => Promise<void>) => {
			const query = vi.fn(async () => ({
				columns: [],
				rows: [],
				rowCount: 0,
			}));
			await fn(query);
		});

		vi.doMock('../lib/postgres-executor.js', () => ({
			executePostgresQuery: vi.fn(),
			withPostgresConnection,
		}));

		const { ensurePgSchema, _resetPgSchemaCache } = await import('../lib/postgres-schema-init.js');
		_resetPgSchemaCache();

		await ensurePgSchema('postgres://edgebase:test@localhost/db', 'shared', {});
		await ensurePgSchema('postgres://edgebase:test@localhost/db', 'shared', {});

		expect(withPostgresConnection).toHaveBeenCalledTimes(1);
	});

	it('re-runs schema initialization when the config signature changes', async () => {
		const withPostgresConnection = vi.fn(async (_connectionString: string, fn: (query: (sql: string, params?: unknown[]) => Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number }>) => Promise<void>) => {
			const query = vi.fn(async () => ({
				columns: [],
				rows: [],
				rowCount: 0,
			}));
			await fn(query);
		});

		vi.doMock('../lib/postgres-executor.js', () => ({
			executePostgresQuery: vi.fn(),
			withPostgresConnection,
		}));

		const { ensurePgSchema, _resetPgSchemaCache } = await import('../lib/postgres-schema-init.js');
		_resetPgSchemaCache();

		await ensurePgSchema('postgres://edgebase:test@localhost/db', 'shared', {});
		await ensurePgSchema('postgres://edgebase:test@localhost/db', 'shared', {
			posts: {
				schema: {
					title: { type: 'string' },
				},
			},
		});

		expect(withPostgresConnection).toHaveBeenCalledTimes(2);
	});
});

describe('PostgreSQL existing-column unique reconciliation', () => {
	it('prepares new unique fields without enforcing uniqueness before migrations', () => {
		expect(generatePgPreparationColumnDDL('contacts', 'email', {
			type: 'string',
			unique: true,
		})).toBe('ALTER TABLE "contacts" ADD COLUMN "email" TEXT;');
		expect(planPostgresFieldUniqueIndex('contacts', 'email', true, [])).toEqual({
			action: 'create',
			indexName: 'uidx_contacts_email',
			ddl: 'CREATE UNIQUE INDEX "uidx_contacts_email" ON "contacts"("email");',
		});
	});

	it('reports an actionable duplicate-value failure', () => {
		expect(postgresUniqueDuplicateError('contacts', 'email').message).toBe(
			"Cannot enable unique for field 'contacts.email': existing non-NULL values contain duplicates. "
			+ 'Resolve the duplicates before retrying the schema update.',
		);
	});

	it('adds a managed unique index for an existing duplicate-free column', async () => {
		const table: TableConfig = {
			schema: { email: { type: 'string', unique: true } },
		};
		const { query, calls, state } = createExistingContactsExecutor();

		await ensureContacts(table, query);

		expect(state.indexes).toEqual(expect.arrayContaining([
			expect.objectContaining({
				index_name: 'uidx_contacts_email',
				is_unique: true,
				columns: ['email'],
			}),
		]));
		const uniquePosition = calls.findIndex((call) =>
			call.sql.startsWith('CREATE UNIQUE INDEX "uidx_contacts_email"'),
		);
		const hashPosition = calls.findIndex((call) =>
			call.sql.includes('INSERT INTO "_meta"')
			&& call.params[0] === 'schemaHash:contacts',
		);
		expect(uniquePosition).toBeGreaterThanOrEqual(0);
		expect(hashPosition).toBeGreaterThan(uniquePosition);
		expect(state.schemaHash).toBe(computeSchemaHashSync(table));
	});

	it('fails closed on duplicate values without storing the new hash', async () => {
		const { query, state } = createExistingContactsExecutor({ duplicates: true });

		await expect(ensureContacts({
			schema: { email: { type: 'string', unique: true } },
		}, query)).rejects.toThrow(
			"Cannot enable unique for field 'contacts.email': existing non-NULL values contain duplicates.",
		);

		expect(state.schemaHash).toBe('stale-schema-hash');
		expect(state.indexes).toHaveLength(0);
	});

	it('runs a pending duplicate repair transaction before creating the unique index', async () => {
		const table: TableConfig = {
			schema: { email: { type: 'string', unique: true } },
			migrations: [{
				version: 2,
				description: 'Remove the older duplicate email row',
				up: `DELETE FROM contacts WHERE id = 'older'`,
				upPg: `DELETE FROM contacts WHERE id = 'older'`,
			}],
		};
		const { query, calls, state } = createExistingContactsExecutor({ duplicates: true });

		await ensureContacts(table, query);

		const beginPosition = calls.findIndex((call) => call.sql === 'BEGIN');
		const migrationPosition = calls.findIndex((call) =>
			call.sql.includes("DELETE FROM contacts WHERE id = 'older'"),
		);
		const uniquePosition = calls.findIndex((call) =>
			call.sql.startsWith('CREATE UNIQUE INDEX "uidx_contacts_email"'),
		);
		const hashPosition = calls.findIndex((call) =>
			call.sql.includes('INSERT INTO "_meta"')
			&& call.params[0] === 'schemaHash:contacts',
		);
		const commitPosition = calls.findIndex((call) => call.sql === 'COMMIT');
		expect(beginPosition).toBeGreaterThanOrEqual(0);
		expect(migrationPosition).toBeGreaterThan(beginPosition);
		expect(uniquePosition).toBeGreaterThan(migrationPosition);
		expect(hashPosition).toBeGreaterThan(uniquePosition);
		expect(commitPosition).toBeGreaterThan(hashPosition);
		expect(state).toMatchObject({
			duplicates: false,
			migrationVersion: '2',
			schemaHash: computeSchemaHashSync(table),
		});
	});

	it('self-heals a missing unique index when the current hash was already stored', async () => {
		const table: TableConfig = {
			schema: { email: { type: 'string', unique: true } },
		};
		const { query, state } = createExistingContactsExecutor({
			schemaHash: computeSchemaHashSync(table),
		});

		await ensureContacts(table, query);

		expect(state.indexes.some((index) => index.index_name === 'uidx_contacts_email'))
			.toBe(true);
	});

	it('self-heals a missing physical-reference index when the current hash was already stored', async () => {
		const table: TableConfig = {
			schema: { email: { type: 'string', references: 'categories' } },
		};
		const { query, calls } = createExistingContactsExecutor({
			schemaHash: computeSchemaHashSync(table),
		});

		await ensureContacts(table, query);

		expect(calls.filter((call) => call.sql ===
			'CREATE INDEX IF NOT EXISTS "idx_contacts_email" ON "contacts"("email");'
		)).toHaveLength(1);
	});

	it('drops only the managed field index when unique is disabled', async () => {
		const { query, state } = createExistingContactsExecutor({
			indexes: [{
				index_name: 'uidx_contacts_email',
				is_unique: true,
				is_primary: false,
				constraint_name: null,
				constraint_type: null,
				is_partial: false,
				columns: ['email'],
			}],
		});

		await ensureContacts({
			schema: { email: { type: 'string', unique: false } },
		}, query);

		expect(state.indexes.some((index) => index.index_name === 'uidx_contacts_email'))
			.toBe(false);
	});

	it('retains an existing constraint-owned unique index when unique stays enabled', async () => {
		const existingConstraint: PgIndexRow = {
			index_name: 'contacts_email_key',
			is_unique: true,
			is_primary: false,
			constraint_name: 'contacts_email_key',
			constraint_type: 'u',
			is_partial: false,
			columns: ['email'],
		};
		const { query, calls, state } = createExistingContactsExecutor({
			indexes: [existingConstraint],
		});

		await ensureContacts({
			schema: { email: { type: 'string', unique: true } },
		}, query);

		expect(state.indexes).toEqual([existingConstraint]);
		expect(calls.some((call) => call.sql.includes('uidx_contacts_email'))).toBe(false);
	});

	it('requires an explicit migration before disabling a constraint-owned unique index', async () => {
		const { query, calls, state } = createExistingContactsExecutor({
			indexes: [{
				index_name: 'contacts_email_key',
				is_unique: true,
				is_primary: false,
				constraint_name: 'contacts_email_key',
				constraint_type: 'u',
				is_partial: false,
				columns: ['email'],
			}],
		});

		await expect(ensureContacts({
			schema: { email: { type: 'string', unique: false } },
		}, query)).rejects.toThrow(/Apply an explicit constraint-removal migration/);

		expect(calls.some((call) => call.sql === 'ROLLBACK')).toBe(true);
		expect(state.schemaHash).toBe('stale-schema-hash');
	});

	it('rolls back migration metadata when duplicates remain after preparation', async () => {
		const { query, calls, state } = createExistingContactsExecutor({ duplicates: true });

		await expect(ensureContacts({
			schema: { email: { type: 'string', unique: true } },
			migrations: [{
				version: 2,
				description: 'A preparation that does not repair duplicates',
				up: 'SELECT 1',
				upPg: 'SELECT 1',
			}],
		}, query)).rejects.toThrow(/existing non-NULL values contain duplicates/);

		expect(calls.some((call) => call.sql === 'ROLLBACK')).toBe(true);
		expect(state).toMatchObject({
			duplicates: true,
			migrationVersion: '1',
			schemaHash: 'stale-schema-hash',
		});
	});

	it('re-runs reconciliation without recreating an already managed unique index', async () => {
		const table: TableConfig = {
			schema: { email: { type: 'string', unique: true } },
		};
		const { query, calls } = createExistingContactsExecutor();

		await ensureContacts(table, query, 'workspace-rerun-first');
		await ensureContacts(table, query, 'workspace-rerun-second');

		expect(calls.filter((call) =>
			call.sql.startsWith('CREATE UNIQUE INDEX "uidx_contacts_email"'),
		)).toHaveLength(1);
	});

	it('fails closed on a reserved PostgreSQL managed-index name collision', async () => {
		const { query, state } = createExistingContactsExecutor({
			indexes: [{
				index_name: 'uidx_contacts_email',
				is_unique: false,
				is_primary: false,
				constraint_name: null,
				constraint_type: null,
				is_partial: false,
				columns: ['email'],
			}],
		});

		await expect(ensureContacts({
			schema: { email: { type: 'string', unique: true } },
		}, query)).rejects.toThrow(/reserved index 'uidx_contacts_email' does not match/);

		expect(state.schemaHash).toBe('stale-schema-hash');
	});
});

describe('PostgreSQL indexed substring corpus migration', () => {
	it('backfills once and persists the FTS definition signature last', async () => {
		const table: TableConfig = {
			schema: { email: { type: 'string' } },
			fts: ['email'],
		};
		const { query, calls, state } = createExistingContactsExecutor({
			schemaHash: computeSchemaHashSync(table),
		});

		await ensureContacts(table, query, 'workspace-fts-first');
		await ensureContacts(table, query, 'workspace-fts-second');

		const backfills = calls.filter((call) => (
			call.sql.startsWith('UPDATE "contacts" SET "_fts_text"')
		));
		expect(backfills).toHaveLength(1);
		expect(calls.filter((call) => /CREATE EXTENSION IF NOT EXISTS pg_trgm/i.test(call.sql)))
			.toHaveLength(1);
		expect(state.ftsSignature).toBe(computePgFtsSignature(['email']));

		const backfillPosition = calls.findIndex((call) => call === backfills[0]);
		const signaturePosition = calls.findIndex((call) => (
			call.sql.includes('INSERT INTO "_meta"')
			&& call.params[0] === 'fts_signature:contacts'
		));
		expect(signaturePosition).toBeGreaterThan(backfillPosition);
	});

	it('repairs physical FTS artifacts even when the definition signature matches', async () => {
		const table: TableConfig = {
			schema: { email: { type: 'string' } },
			fts: ['email'],
		};
		const signature = computePgFtsSignature(['email']);
		const { query, calls, state } = createExistingContactsExecutor({
			schemaHash: computeSchemaHashSync(table),
			ftsSignature: signature,
			ftsHealthy: false,
		});

		await ensureContacts(table, query, 'workspace-fts-artifact-repair');

		const artifactQuery = calls.find((call) => (
			call.sql.includes('WITH target AS MATERIALIZED')
		));
		expect(artifactQuery?.params.slice(0, 5)).toEqual([
			'contacts',
			'contacts_fts_update',
			'contacts_fts_trigger',
			'idx_contacts_fts',
			'idx_contacts_fts_text_trgm',
		]);
		expect(artifactQuery?.params).toHaveLength(7);
		expect(artifactQuery?.sql).toContain('n.nspname = pg_catalog.current_schema()');
		expect(artifactQuery?.sql).not.toContain('to_regclass($1)');
		expect(calls.some((call) => call.sql.startsWith('DROP INDEX'))).toBe(false);
		expect(calls.some((call) => (
			call.sql.startsWith('UPDATE "contacts" SET "_fts_text"')
		))).toBe(true);
		expect(state.ftsHealthy).toBe(true);
		expect(state.ftsSignature).toBe(signature);
	});

	it('recognizes the prior generated function body while upgrading configured fields', async () => {
		const table: TableConfig = {
			schema: {
				email: { type: 'string' },
				displayName: { type: 'string' },
			},
			fts: ['email', 'displayName'],
		};
		const { query, calls, state } = createExistingContactsExecutor({
			schemaHash: computeSchemaHashSync(table),
			ftsSignature: computePgFtsSignature(['email']),
			ftsHealthy: true,
			ftsArtifactOverrides: {
				maintenanceFunction: false,
				maintenanceFunctionNameOccupied: true,
				maintenanceFunctionRepairable: true,
				maintenanceTrigger: false,
				maintenanceTriggerNameOccupied: true,
				maintenanceTriggerRepairable: true,
			},
		});

		await ensureContacts(table, query, 'workspace-fts-field-drift');

		const artifactQuery = calls.find((call) => call.sql.includes('WITH target AS MATERIALIZED'))!;
		expect(artifactQuery.params[5]).toContain('NEW."displayName"');
		expect(artifactQuery.params[6]).not.toContain('NEW."displayName"');
		expect(calls.some((call) => call.sql.includes('DROP TRIGGER IF EXISTS'))).toBe(true);
		expect(calls.some((call) => call.sql.startsWith('UPDATE "contacts" SET "_fts_text"')))
			.toBe(true);
		expect(state.ftsSignature).toBe(computePgFtsSignature(['email', 'displayName']));
	});

	it('drops only an exact-shape target-owned invalid trigram index before repair', async () => {
		const table: TableConfig = {
			schema: { email: { type: 'string' } },
			fts: ['email'],
		};
		const signature = computePgFtsSignature(['email']);
		const { query, calls } = createExistingContactsExecutor({
			schemaHash: computeSchemaHashSync(table),
			ftsSignature: signature,
			ftsArtifactOverrides: {
				legacyColumnPresent: true,
				legacyColumn: true,
				textColumnPresent: true,
				textColumn: true,
				maintenanceTrigger: true,
				legacyIndex: true,
				legacyIndexNameOccupied: true,
				trigramIndexNameOccupied: true,
				trigramIndexRepairable: true,
			},
		});

		await ensureContacts(table, query, 'workspace-fts-invalid-index');

		expect(calls.some((call) => (
			call.sql === 'DROP INDEX IF EXISTS "public"."idx_contacts_fts_text_trgm"'
		))).toBe(true);
		expect(calls.some((call) => (
			call.sql === 'DROP INDEX IF EXISTS "public"."idx_contacts_fts"'
		))).toBe(false);
	});

	it('fails closed without DROP when a reserved FTS index name belongs elsewhere', async () => {
		const table: TableConfig = {
			schema: { email: { type: 'string' } },
			fts: ['email'],
		};
		const signature = computePgFtsSignature(['email']);
		const { query, calls, state } = createExistingContactsExecutor({
			schemaHash: computeSchemaHashSync(table),
			ftsSignature: signature,
			ftsArtifactOverrides: {
				legacyColumnPresent: true,
				legacyColumn: true,
				textColumnPresent: true,
				textColumn: true,
				maintenanceTrigger: true,
				legacyIndex: true,
				legacyIndexNameOccupied: true,
				trigramIndexNameOccupied: true,
				trigramIndexRepairable: false,
			},
		});

		await expect(ensureContacts(table, query, 'workspace-fts-index-collision'))
			.rejects.toThrow(/index name collision/);

		expect(calls.some((call) => call.sql.startsWith('DROP INDEX'))).toBe(false);
		expect(calls.some((call) => call.sql.startsWith('UPDATE "contacts" SET "_fts_text"')))
			.toBe(false);
		expect(state.ftsSignature).toBe(signature);
	});

	it('preserves a custom same-name maintenance trigger instead of replacing it', async () => {
		const table: TableConfig = {
			schema: { email: { type: 'string' } },
			fts: ['email'],
		};
		const signature = computePgFtsSignature(['email']);
		const { query, calls, state } = createExistingContactsExecutor({
			schemaHash: computeSchemaHashSync(table),
			ftsSignature: signature,
			ftsHealthy: true,
			ftsArtifactOverrides: {
				maintenanceTrigger: false,
				maintenanceTriggerNameOccupied: true,
				maintenanceTriggerRepairable: false,
			},
		});

		await expect(ensureContacts(table, query, 'workspace-fts-trigger-collision'))
			.rejects.toThrow(/trigger name collision/);

		expect(calls.some((call) => call.sql.includes('DROP TRIGGER'))).toBe(false);
		expect(calls.some((call) => call.sql.startsWith('CREATE OR REPLACE FUNCTION')))
			.toBe(false);
		expect(calls.some((call) => call.sql.startsWith('UPDATE "contacts" SET "_fts_text"')))
			.toBe(false);
		expect(state.ftsSignature).toBe(signature);
	});

	it('preserves a custom same-signature function instead of CREATE OR REPLACE', async () => {
		const table: TableConfig = {
			schema: { email: { type: 'string' } },
			fts: ['email'],
		};
		const signature = computePgFtsSignature(['email']);
		const { query, calls } = createExistingContactsExecutor({
			schemaHash: computeSchemaHashSync(table),
			ftsSignature: signature,
			ftsHealthy: true,
			ftsArtifactOverrides: {
				maintenanceFunction: false,
				maintenanceFunctionNameOccupied: true,
				maintenanceFunctionRepairable: false,
				maintenanceTrigger: false,
				maintenanceTriggerNameOccupied: false,
			},
		});

		await expect(ensureContacts(table, query, 'workspace-fts-function-collision'))
			.rejects.toThrow(/function name collision/);

		expect(calls.some((call) => call.sql.startsWith('CREATE OR REPLACE FUNCTION')))
			.toBe(false);
		expect(calls.some((call) => call.sql.includes('DROP TRIGGER'))).toBe(false);
		expect(calls.some((call) => call.sql.startsWith('UPDATE "contacts" SET "_fts_text"')))
			.toBe(false);
	});

	it('resolves special table names by exact pg_class relname rather than regclass parsing', () => {
		const query = buildPgFtsArtifactQuery('plugin-a/events', ['content']);
		expect(query.params.slice(0, 5)).toEqual([
			'plugin-a/events',
			'plugin-a/events_fts_update',
			'plugin-a/events_fts_trigger',
			'idx_plugin-a/events_fts',
			'idx_plugin-a/events_fts_text_trgm',
		]);
		expect(query.params).toHaveLength(7);
		expect(query.params[5]).toContain('NEW."content"');
		expect(query.sql).toContain('c.relname = $1');
		expect(query.sql).toContain('p.prosrc = $6');
		expect(query.sql).toContain('p.prosrc IN ($6, $7)');
		expect(query.sql).not.toContain('to_regclass($1)');
	});
});
