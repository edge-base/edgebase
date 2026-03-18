import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

const neonMocks = vi.hoisted(() => ({
	listAvailableNeonProjects: vi.fn().mockResolvedValue([]),
	runNeonSetup: vi.fn(),
}));

vi.mock('../src/commands/neon.js', () => ({
	listAvailableNeonProjects: neonMocks.listAvailableNeonProjects,
	runNeonSetup: neonMocks.runNeonSetup,
}));

import { startSidecar, type SidecarOptions } from '../src/lib/dev-sidecar.js';

let projectDir: string;
let configPath: string;
let realFetch: typeof fetch;

function writeConfig(content: string): void {
	writeFileSync(configPath, content, 'utf-8');
}

function sidecarOptions(): SidecarOptions {
	return {
		port: 8788,
		workerPort: 8787,
		projectDir,
		configPath,
		adminSecret: 'secret',
	};
}

describe('Neon sidecar helpers', () => {
	beforeEach(() => {
		projectDir = mkdtempSync(join(tmpdir(), 'edgebase-sidecar-neon-test-'));
		configPath = join(projectDir, 'edgebase.config.ts');
		realFetch = globalThis.fetch;
		neonMocks.listAvailableNeonProjects.mockReset();
		neonMocks.listAvailableNeonProjects.mockResolvedValue([]);
		neonMocks.runNeonSetup.mockReset();
		neonMocks.runNeonSetup.mockResolvedValue({
			target: {
				kind: 'database',
				label: 'check44',
				namespace: 'check44',
				envKey: 'DB_POSTGRES_CHECK44_URL',
			},
			connectionString: 'postgresql://example',
			envDevPath: join(projectDir, '.env.development'),
			envReleasePath: join(projectDir, '.env.release'),
			projectName: 'authpass',
			databaseName: 'check44_db',
			roleName: 'check44_owner',
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		rmSync(projectDir, { recursive: true, force: true });
	});

	it('computes the default env key when creating a Neon-backed database block', async () => {
		writeConfig(`import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {},
});
`);

		const server = startSidecar({ ...sidecarOptions(), port: 0 });
		await once(server, 'listening');

		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('Expected sidecar to listen on a TCP port.');
		}

		try {
			const response = await fetch(`http://127.0.0.1:${address.port}/integrations/neon/databases`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-EdgeBase-Internal-Secret': 'secret',
				},
				body: JSON.stringify({
					name: 'check44',
					topology: 'single',
					projectName: 'check44-prod',
					mode: 'create',
				}),
			});

			expect(response.status).toBe(201);
			expect(neonMocks.runNeonSetup).toHaveBeenCalledWith(
				expect.objectContaining({
					namespace: 'check44',
					envKeyOverride: 'DB_POSTGRES_CHECK44_URL',
					projectName: 'check44-prod',
					projectMode: 'create',
				}),
			);

			const configText = readFileSync(configPath, 'utf-8');
			expect(configText).toContain("provider: 'postgres'");
			expect(configText).toContain("connectionString: 'DB_POSTGRES_CHECK44_URL'");
		} finally {
			server.close();
			await once(server, 'close');
		}
	});

	it('computes the default env key when upgrading a D1 database block to Postgres', async () => {
		writeConfig(`import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    check44: {
      tables: {
        check44table: {
          schema: {
            name: { type: 'string' },
          },
        },
      },
    },
  },
});
`);

		const workerFetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/admin/api/data/backup/dump-data')) {
				return new Response(JSON.stringify({
					tables: {
						check44table: [{ id: '1', name: 'hello' }],
					},
				}), { status: 200, headers: { 'Content-Type': 'application/json' } });
			}
			if (url.endsWith('/admin/api/data/schema')) {
				return new Response(JSON.stringify({
					namespaces: {
						check44: { provider: 'postgres' },
					},
				}), { status: 200, headers: { 'Content-Type': 'application/json' } });
			}
			if (url.endsWith('/admin/api/data/backup/restore-data')) {
				return new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}
			return realFetch(input);
		});
		vi.stubGlobal('fetch', workerFetch);

		const server = startSidecar({ ...sidecarOptions(), port: 0 });
		await once(server, 'listening');

		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('Expected sidecar to listen on a TCP port.');
		}

		try {
			const response = await realFetch(`http://127.0.0.1:${address.port}/integrations/neon/upgrade`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-EdgeBase-Internal-Secret': 'secret',
					Authorization: 'Bearer admin-token',
				},
				body: JSON.stringify({
					namespace: 'check44',
					projectName: 'check44-prod',
					mode: 'create',
				}),
			});

			expect(response.status).toBe(200);
			expect(neonMocks.runNeonSetup).toHaveBeenCalledWith(
				expect.objectContaining({
					namespace: 'check44',
					envKeyOverride: 'DB_POSTGRES_CHECK44_URL',
					projectName: 'check44-prod',
					projectMode: 'create',
				}),
			);

			const configText = readFileSync(configPath, 'utf-8');
			expect(configText).toContain("provider: 'postgres'");
			expect(configText).toContain("connectionString: 'DB_POSTGRES_CHECK44_URL'");
		} finally {
			server.close();
			await once(server, 'close');
		}
	});
});
