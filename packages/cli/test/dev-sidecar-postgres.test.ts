import { describe, expect, it, vi } from 'vitest';
import { ensurePostgresSchemaWithDedicatedClient } from '../src/lib/dev-sidecar.js';

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

describe('PostgreSQL dev-sidecar schema initialization', () => {
	it('pins the complete schema transaction to one checked-out client and releases it', async () => {
		const poolQuery = vi.fn(async () => ({ rows: [], rowCount: 0, fields: [] }));
		const clientQuery = vi.fn(async () => ({ rows: [], rowCount: 0, fields: [] }));
		const release = vi.fn();
		const connect = vi.fn(async () => ({ query: clientQuery, release }));
		const ensurePgSchema = vi.fn(async (
			_connectionString: string,
			_namespace: string,
			_tables: Record<string, unknown>,
			query: (sql: string, params?: unknown[]) => Promise<unknown>,
		) => {
			await query('BEGIN', []);
			await query('DELETE FROM contacts WHERE id = $1', ['older']);
			await query('CREATE UNIQUE INDEX contacts_email_key ON contacts(email)', []);
			await query('COMMIT', []);
		});

		await ensurePostgresSchemaWithDedicatedClient(
			{
				query: poolQuery,
				connect,
				end: vi.fn(async () => undefined),
			},
			ensurePgSchema,
			'postgres://edgebase:test@localhost/db',
			'workspace',
			{ contacts: { schema: { email: { type: 'string', unique: true } } } },
		);

		expect(connect).toHaveBeenCalledTimes(1);
		expect(poolQuery).not.toHaveBeenCalled();
		expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
			'BEGIN',
			'DELETE FROM contacts WHERE id = $1',
			'CREATE UNIQUE INDEX contacts_email_key ON contacts(email)',
			'COMMIT',
		]);
		expect(release).toHaveBeenCalledTimes(1);
	});

	it('isolates held concurrent namespaces and publishes only the successful hash', async () => {
		const bothBegun = createDeferred();
		const begunNamespaces = new Set<string>();
		const publishedHashes = new Set<string>();
		const timeline: Array<{ client: string; sql: string; params: unknown[] }> = [];

		function createClient(clientName: string, failingNamespace?: string) {
			let pendingHash: string | null = null;
			const release = vi.fn();
			const query = vi.fn(async (sql: string, params: unknown[] = []) => {
				timeline.push({ client: clientName, sql, params });
				if (sql === 'APPLY MIGRATION' && params[0] === failingNamespace) {
					throw new Error(`migration failed for ${failingNamespace}`);
				}
				if (sql === 'PUBLISH SCHEMA HASH') {
					pendingHash = String(params[1]);
				} else if (sql === 'COMMIT' && pendingHash) {
					publishedHashes.add(pendingHash);
					pendingHash = null;
				} else if (sql === 'ROLLBACK') {
					pendingHash = null;
				}
				return { rows: [], rowCount: 0, fields: [] };
			});
			return { query, release };
		}

		const successfulClient = createClient('successful-client');
		const failingClient = createClient('failing-client', 'failing');
		const availableClients = [successfulClient, failingClient];
		const poolQuery = vi.fn(async () => ({ rows: [], rowCount: 0, fields: [] }));
		const connect = vi.fn(async () => {
			const client = availableClients.shift();
			if (!client) throw new Error('unexpected extra client checkout');
			return client;
		});
		const ensurePgSchema = vi.fn(async (
			_connectionString: string,
			namespace: string,
			_tables: Record<string, unknown>,
			query: (sql: string, params?: unknown[]) => Promise<unknown>,
		) => {
			await query('BEGIN');
			begunNamespaces.add(namespace);
			if (begunNamespaces.size === 2) bothBegun.resolve();
			await bothBegun.promise;

			try {
				await query('APPLY MIGRATION', [namespace]);
				await query('PUBLISH SCHEMA HASH', [namespace, `${namespace}-hash`]);
				await query('COMMIT');
			} catch (error) {
				await query('ROLLBACK');
				throw error;
			}
		});
		const pool = {
			query: poolQuery,
			connect,
			end: vi.fn(async () => undefined),
		};

		const successfulAttempt = ensurePostgresSchemaWithDedicatedClient(
			pool,
			ensurePgSchema,
			'postgres://edgebase:test@localhost/db',
			'successful',
			{},
		);
		const failingAttempt = ensurePostgresSchemaWithDedicatedClient(
			pool,
			ensurePgSchema,
			'postgres://edgebase:test@localhost/db',
			'failing',
			{},
		);

		const results = await Promise.allSettled([successfulAttempt, failingAttempt]);

		expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
		expect(results[1]).toMatchObject({
			status: 'rejected',
			reason: expect.objectContaining({ message: 'migration failed for failing' }),
		});
		expect(connect).toHaveBeenCalledTimes(2);
		expect(poolQuery).not.toHaveBeenCalled();
		expect(successfulClient.query).not.toBe(failingClient.query);
		expect(timeline.slice(0, 2).map(({ client, sql }) => ({ client, sql }))).toEqual([
			{ client: 'successful-client', sql: 'BEGIN' },
			{ client: 'failing-client', sql: 'BEGIN' },
		]);
		expect(successfulClient.query.mock.calls).toEqual([
			['BEGIN', []],
			['APPLY MIGRATION', ['successful']],
			['PUBLISH SCHEMA HASH', ['successful', 'successful-hash']],
			['COMMIT', []],
		]);
		expect(failingClient.query.mock.calls).toEqual([
			['BEGIN', []],
			['APPLY MIGRATION', ['failing']],
			['ROLLBACK', []],
		]);
		expect(publishedHashes).toEqual(new Set(['successful-hash']));
		expect(successfulClient.release).toHaveBeenCalledTimes(1);
		expect(failingClient.release).toHaveBeenCalledTimes(1);
	});

	it('rolls back a post-BEGIN mutation failure on the same client without publishing a hash', async () => {
		const publishedHashes = new Set(['previous-hash']);
		let pendingHash: string | null = null;
		const poolQuery = vi.fn(async () => ({ rows: [], rowCount: 0, fields: [] }));
		const clientQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
			if (sql === 'ALTER TABLE contacts ADD CONSTRAINT contacts_email_key') {
				throw new Error('constraint migration failed');
			}
			if (sql === 'PUBLISH SCHEMA HASH') {
				pendingHash = String(params[0]);
			} else if (sql === 'COMMIT' && pendingHash) {
				publishedHashes.add(pendingHash);
				pendingHash = null;
			} else if (sql === 'ROLLBACK') {
				pendingHash = null;
			}
			return { rows: [], rowCount: 0, fields: [] };
		});
		const release = vi.fn();
		const connect = vi.fn(async () => ({ query: clientQuery, release }));
		const ensurePgSchema = vi.fn(async (
			_connectionString: string,
			_namespace: string,
			_tables: Record<string, unknown>,
			query: (sql: string, params?: unknown[]) => Promise<unknown>,
		) => {
			await query('BEGIN');
			try {
				await query('ALTER TABLE contacts ADD CONSTRAINT contacts_email_key');
				await query('PUBLISH SCHEMA HASH', ['replacement-hash']);
				await query('COMMIT');
			} catch (error) {
				await query('ROLLBACK');
				throw error;
			}
		});

		await expect(ensurePostgresSchemaWithDedicatedClient(
			{
				query: poolQuery,
				connect,
				end: vi.fn(async () => undefined),
			},
			ensurePgSchema,
			'postgres://edgebase:test@localhost/db',
			'workspace',
			{},
		)).rejects.toThrow('constraint migration failed');

		expect(connect).toHaveBeenCalledTimes(1);
		expect(poolQuery).not.toHaveBeenCalled();
		expect(clientQuery.mock.calls).toEqual([
			['BEGIN', []],
			['ALTER TABLE contacts ADD CONSTRAINT contacts_email_key', []],
			['ROLLBACK', []],
		]);
		expect(publishedHashes).toEqual(new Set(['previous-hash']));
		expect(release).toHaveBeenCalledTimes(1);
	});

	it('releases the checked-out client when schema initialization fails', async () => {
		const release = vi.fn();
		const connect = vi.fn(async () => ({
			query: vi.fn(async () => ({ rows: [], rowCount: 0, fields: [] })),
			release,
		}));

		await expect(ensurePostgresSchemaWithDedicatedClient(
			{
				query: vi.fn(async () => ({ rows: [], rowCount: 0, fields: [] })),
				connect,
				end: vi.fn(async () => undefined),
			},
			vi.fn(async () => {
				throw new Error('schema failure');
			}),
			'postgres://edgebase:test@localhost/db',
			'workspace',
			{},
		)).rejects.toThrow('schema failure');

		expect(release).toHaveBeenCalledTimes(1);
	});
});
