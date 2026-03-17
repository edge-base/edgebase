import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TableConfig } from '@edgebase/shared';
import { resolvePgInitOrder } from '../lib/postgres-schema-init.js';

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
