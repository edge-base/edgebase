import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDevVars, startSidecar } from '../../cli/src/lib/dev-sidecar.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(scriptDir, '../..');
const projectDir = resolve(packagesDir, '..');
const configPath = resolve(projectDir, 'edgebase.config.ts');
const serverProjectDir = resolve(packagesDir, 'server');
const wranglerTestConfigPath = resolve(packagesDir, 'server', 'wrangler.test.toml');

function readWranglerVar(configText: string, key: string): string | null {
	let inVarsSection = false;

	for (const rawLine of configText.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;

		if (line.startsWith('[') && line.endsWith(']')) {
			inVarsSection = line === '[vars]';
			continue;
		}

		if (!inVarsSection) continue;

		const match = rawLine.match(/^\s*([A-Z0-9_]+)\s*=\s*"([^"]*)"\s*$/);
		if (match?.[1] === key) {
			return match[2];
		}
	}

	return null;
}

function resolveAdminSecret(): string | null {
	if (process.env.EDGEBASE_LIVE_ADMIN_SECRET) {
		return process.env.EDGEBASE_LIVE_ADMIN_SECRET;
	}

	const serverDevVars = parseDevVars(serverProjectDir).JWT_ADMIN_SECRET;
	if (serverDevVars) {
		return serverDevVars;
	}

	try {
		const wranglerConfig = readFileSync(wranglerTestConfigPath, 'utf-8');
		const fromWrangler = readWranglerVar(wranglerConfig, 'JWT_ADMIN_SECRET');
		if (fromWrangler) return fromWrangler;
	} catch {
		// Fall back to the regular dev vars lookup below.
	}

	return parseDevVars(projectDir).JWT_ADMIN_SECRET ?? null;
}

const port = Number.parseInt(process.env.EDGEBASE_LIVE_SIDECAR_PORT ?? '8789', 10);
const workerPort = Number.parseInt(process.env.EDGEBASE_LIVE_API_PORT ?? '8788', 10);
const adminSecret = resolveAdminSecret();

if (!adminSecret) {
	console.error('Missing JWT_ADMIN_SECRET for the live sidecar');
	process.exit(1);
}

const server = startSidecar({
	port,
	workerPort,
	configPath,
	projectDir,
	adminSecret,
});

const shutdown = () => {
	server.close(() => {
		process.exit(0);
	});
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
