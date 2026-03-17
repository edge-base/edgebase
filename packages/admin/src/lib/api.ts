/**
 * Two-mode API client for the EdgeBase admin dashboard.
 *
 * 1. api.fetch<T>(path, opts) — calls the Worker server at {apiOrigin}/admin/api/{path}
 * 2. api.schemaMutation<T>(path, opts) — calls the dev sidecar at http://localhost:{port}/{path}
 *
 * Features:
 * - JWT auto-attach from auth store
 * - Auto-refresh on 401 (try refresh, logout on failure)
 * - Sidecar port auto-discovery via GET {apiOrigin}/admin/api/data/dev-info
 * - Structured error parsing: server returns { code, message }
 */

import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';
import { devInfoStore, loadDevInfo } from '$lib/stores/devInfo';
import { addToast } from '$lib/stores/toast.svelte';
import { getAdminApiUrl } from '$lib/runtime-config';

// ── Error type ──────────────────────────────────────────

export class ApiError extends Error {
	code: number | string;
	status: number;
	data?: unknown;

	constructor(status: number, code: number | string, message: string, data?: unknown) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.data = data;
	}
}

// ── Internal helpers ────────────────────────────────────

interface RequestOpts {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
	/** Skip automatic 401 refresh (used internally to prevent recursion) */
	_skipRefresh?: boolean;
}

async function parseErrorBody(res: Response): Promise<{ code: string; message: string; data?: unknown }> {
	try {
		const json = await res.json();
		return {
			code: json.code ?? 'UNKNOWN',
			message: json.message ?? res.statusText,
			data: json.data
		};
	} catch {
		return { code: 'UNKNOWN', message: res.statusText };
	}
}

async function rawFetch<T>(url: string, opts: RequestOpts = {}): Promise<T> {
	const auth = get(authStore);

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...opts.headers
	};

	if (auth.accessToken) {
		headers['Authorization'] = `Bearer ${auth.accessToken}`;
	}

	const res = await fetch(url, {
		method: opts.method ?? 'GET',
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
	});

	// ── 401 auto-refresh ────────────────────────────────
	if (res.status === 401 && !opts._skipRefresh) {
		const refreshed = await authStore.refresh();
		if (refreshed) {
			return rawFetch<T>(url, { ...opts, _skipRefresh: true });
		}
		authStore.logout();
		throw new ApiError(401, 'UNAUTHORIZED', 'Session expired');
	}

	if (!res.ok) {
		const err = await parseErrorBody(res);
		throw new ApiError(res.status, err.code, err.message, err.data);
	}

	// 204 No Content
	if (res.status === 204) return undefined as T;

	return res.json() as Promise<T>;
}

// ── Public API ──────────────────────────────────────────

/**
 * Call the Worker server API.
 * Path is relative — e.g. `api.fetch<Schema>('data/schema')`
 * resolves to `{apiOrigin}/admin/api/data/schema`.
 */
async function apiFetch<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
	const url = getAdminApiUrl(path);
	return rawFetch<T>(url, opts);
}

/**
 * Call the dev sidecar for schema mutations.
 * Automatically discovers the sidecar port on first call.
 * Throws if not in dev mode or sidecar is unavailable.
 */
async function schemaMutation<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
	let info = get(devInfoStore);

	// Auto-discover sidecar port if not loaded yet
	if (!info.loaded) {
		await loadDevInfo();
		info = get(devInfoStore);
	}

	if (!info.devMode || info.sidecarPort === null) {
		throw new ApiError(0, 'NOT_DEV_MODE', 'Schema mutations require dev mode with sidecar');
	}

	const url = `http://localhost:${info.sidecarPort}/${path}`;
	try {
		return await rawFetch<T>(url, opts);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			throw new ApiError(
				404,
				err.code,
				'This dashboard action is not available on the current dev sidecar yet. Restart `pnpm dev` and try again.',
			);
		}
		throw err;
	}
}

/**
 * Convenience wrapper that catches ApiError and shows a toast.
 * Returns `null` on failure instead of throwing.
 */
async function safeFetch<T = unknown>(
	fetcher: () => Promise<T>,
	errorLabel?: string
): Promise<T | null> {
	try {
		return await fetcher();
	} catch (err) {
		const msg =
			err instanceof ApiError
				? err.message
				: err instanceof Error
					? err.message
					: 'Unknown error';
		addToast({ type: 'error', message: errorLabel ? `${errorLabel}: ${msg}` : msg });
		return null;
	}
}

export const api = {
	fetch: apiFetch,
	schemaMutation,
	safeFetch
} as const;
