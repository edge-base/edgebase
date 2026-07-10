/**
 * Admin dashboard auth state.
 *
 * The rotating refresh credential lives only in an EdgeBase-issued HttpOnly
 * cookie. JavaScript keeps the short-lived access token in memory and removes
 * any legacy token payload left by pre-0.3.6 dashboard builds.
 */

import { writable, get } from 'svelte/store';
import { getAdminApiUrl } from '$lib/runtime-config';
import { describeActionError } from '$lib/error-messages';

export interface AdminUser {
	id: string;
	email: string;
}

export interface AuthState {
	accessToken: string | null;
	admin: AdminUser | null;
}

interface AuthTokenResponse {
	accessToken: string;
	refreshToken?: string;
	admin: AdminUser;
	sessionTransport?: string;
}

export const ADMIN_AUTH_STORAGE_KEY = 'edgebase_admin_auth';
export const ADMIN_LOGOUT_PENDING_KEY = 'edgebase_admin_logout_pending';
export const ADMIN_SESSION_MARKER_KEY = 'edgebase_admin_session_marker';
const ADMIN_REFRESH_LEASE_KEY = 'edgebase_admin_refresh_lease';
const ADMIN_REFRESH_LOCK_NAME = 'edgebase-admin-refresh';
const LEASE_TTL_MS = 15_000;
const LEASE_VERIFY_DELAY_MS = 25;
const SESSION_REQUEST_TIMEOUT_MS = 15_000;
const COOKIE_TRANSPORT_HEADERS = {
	'Content-Type': 'application/json',
	'X-EdgeBase-Auth-Transport': 'cookie',
} as const;

async function buildAuthError(res: Response, fallback: string): Promise<Error> {
	const body = await res.json().catch(() => null) as { message?: unknown } | null;
	return new Error(
		describeActionError(
			{
				status: res.status,
				message: typeof body?.message === 'string' ? body.message : undefined,
			},
			fallback,
		),
	);
}

function takeLegacyRefreshToken(): string | null {
	let refreshToken: string | null = null;
	for (const storage of [
		typeof localStorage === 'undefined' ? null : localStorage,
		typeof sessionStorage === 'undefined' ? null : sessionStorage,
	]) {
		if (!storage) continue;
		try {
			const raw = storage.getItem(ADMIN_AUTH_STORAGE_KEY);
			if (!refreshToken && raw) {
				const parsed = JSON.parse(raw) as { refreshToken?: unknown };
				if (typeof parsed.refreshToken === 'string' && parsed.refreshToken) {
					refreshToken = parsed.refreshToken;
				}
			}
			storage.removeItem(ADMIN_AUTH_STORAGE_KEY);
		} catch {
			try { storage.removeItem(ADMIN_AUTH_STORAGE_KEY); } catch { /* noop */ }
		}
	}
	return refreshToken;
}

function clearLegacyAuthStorage(): void {
	for (const storage of [
		typeof localStorage === 'undefined' ? null : localStorage,
		typeof sessionStorage === 'undefined' ? null : sessionStorage,
	]) {
		try { storage?.removeItem(ADMIN_AUTH_STORAGE_KEY); } catch { /* noop */ }
	}
}

let pendingLegacyRefreshToken = takeLegacyRefreshToken();
const emptyState: AuthState = { accessToken: null, admin: null };
const store = writable<AuthState>(emptyState);
let authGeneration = 0;
let refreshInFlight: Promise<boolean> | null = null;
let initializeInFlight: Promise<boolean> | null = null;
let activeSessionRequestController: AbortController | null = null;

function browserLocalStorage(): Storage | null {
	return typeof localStorage === 'undefined' ? null : localStorage;
}

function hasPendingLogout(): boolean {
	try { return browserLocalStorage()?.getItem(ADMIN_LOGOUT_PENDING_KEY) !== null; } catch { return false; }
}

function markPendingLogout(): void {
	try {
		browserLocalStorage()?.setItem(ADMIN_LOGOUT_PENDING_KEY, JSON.stringify({ version: 1, at: Date.now() }));
	} catch { /* no durable marker available */ }
}

function clearPendingLogout(): void {
	try { browserLocalStorage()?.removeItem(ADMIN_LOGOUT_PENDING_KEY); } catch { /* noop */ }
}

function readSessionMarkerAdminId(): string | null {
	try {
		const raw = browserLocalStorage()?.getItem(ADMIN_SESSION_MARKER_KEY);
		if (!raw) return null;
		const marker = JSON.parse(raw) as { version?: unknown; adminId?: unknown };
		return marker.version === 1 && typeof marker.adminId === 'string'
			? marker.adminId
			: null;
	} catch {
		return null;
	}
}

function writeSessionMarker(adminId: string): void {
	try {
		browserLocalStorage()?.setItem(
			ADMIN_SESSION_MARKER_KEY,
			JSON.stringify({ version: 1, adminId }),
		);
	} catch { /* marker is an optimization, never a credential */ }
}

function clearSessionMarker(): void {
	try { browserLocalStorage()?.removeItem(ADMIN_SESSION_MARKER_KEY); } catch { /* noop */ }
}

function randomOwnerId(): string {
	try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random()}`; }
}

function readLease(storage: Storage): { owner: string; expiresAt: number } | null {
	try {
		const parsed = JSON.parse(storage.getItem(ADMIN_REFRESH_LEASE_KEY) ?? 'null') as {
			owner?: unknown;
			expiresAt?: unknown;
		} | null;
		if (
			parsed
			&& typeof parsed.owner === 'string'
			&& typeof parsed.expiresAt === 'number'
		) return { owner: parsed.owner, expiresAt: parsed.expiresAt };
	} catch { /* treat malformed lease as expired */ }
	return null;
}

async function withStorageLease<T>(task: () => Promise<T>): Promise<T> {
	const storage = browserLocalStorage();
	if (!storage) return task();
	const owner = randomOwnerId();

	for (;;) {
		const now = Date.now();
		const current = readLease(storage);
		if (!current || current.expiresAt <= now) {
			try {
				storage.setItem(ADMIN_REFRESH_LEASE_KEY, JSON.stringify({
					owner,
					expiresAt: now + LEASE_TTL_MS,
				}));
			} catch {
				return task();
			}
			// Yield before verifying ownership. Separate tabs can both observe an
			// empty lease and write; only the last surviving owner may enter.
			await new Promise((resolve) => setTimeout(resolve, LEASE_VERIFY_DELAY_MS));
			if (readLease(storage)?.owner === owner) {
				const heartbeat = setInterval(() => {
					if (readLease(storage)?.owner !== owner) return;
					try {
						storage.setItem(ADMIN_REFRESH_LEASE_KEY, JSON.stringify({
							owner,
							expiresAt: Date.now() + LEASE_TTL_MS,
						}));
					} catch { /* the lease will expire if storage becomes unavailable */ }
				}, Math.floor(LEASE_TTL_MS / 3));
				try {
					return await task();
				} finally {
					clearInterval(heartbeat);
					if (readLease(storage)?.owner === owner) {
						try { storage.removeItem(ADMIN_REFRESH_LEASE_KEY); } catch { /* noop */ }
					}
				}
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 50)));
	}
}

/** Serialize rotating-cookie use across dashboard tabs without sharing a token. */
export async function withAdminSessionLock<T>(task: () => Promise<T>): Promise<T> {
	const lockManager = typeof navigator === 'undefined'
		? undefined
		: (navigator as Navigator & { locks?: LockManager }).locks;
	if (lockManager?.request) {
		return lockManager.request(ADMIN_REFRESH_LOCK_NAME, { mode: 'exclusive' }, task);
	}
	return withStorageLease(task);
}

function applySession(data: AuthTokenResponse, generation: number): boolean {
	if (
		authGeneration !== generation
		|| typeof data.accessToken !== 'string'
		|| !data.accessToken
		|| !data.admin
		|| typeof data.admin.id !== 'string'
		|| typeof data.admin.email !== 'string'
	) {
		return false;
	}
	store.set({ accessToken: data.accessToken, admin: data.admin });
	writeSessionMarker(data.admin.id);
	return true;
}

function abortActiveSessionRequest(): void {
	activeSessionRequestController?.abort();
}

async function requestSession(path: string, body: Record<string, unknown>): Promise<Response> {
	const controller = new AbortController();
	activeSessionRequestController = controller;
	let timedOut = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<Response>((_resolve, reject) => {
		timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
			reject(new Error('Admin session request timed out. Please try again.'));
		}, SESSION_REQUEST_TIMEOUT_MS);
	});

	try {
		return await Promise.race([
			(async () => {
				const response = await fetch(getAdminApiUrl(path), {
					method: 'POST',
					headers: COOKIE_TRANSPORT_HEADERS,
					credentials: 'include',
					body: JSON.stringify(body),
					signal: controller.signal,
				});
				// Keep the deadline active until the response body is complete;
				// headers-only proxy stalls must not retain the session lock.
				const bytes = await response.arrayBuffer();
				return new Response(bytes.byteLength > 0 ? bytes : null, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				});
			})(),
			timeoutPromise,
		]);
	} catch (error) {
		if (controller.signal.aborted) {
			throw new Error(timedOut
				? 'Admin session request timed out. Please try again.'
				: 'Admin session request was cancelled.');
		}
		throw error;
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
		if (activeSessionRequestController === controller) {
			activeSessionRequestController = null;
		}
	}
}

/** Restore an existing HttpOnly-cookie session once when the app starts. */
function initialize(): Promise<boolean> {
	if (get(store).accessToken) return Promise.resolve(true);
	if (initializeInFlight) return initializeInFlight;
	initializeInFlight = (async () => {
		if (hasPendingLogout()) {
			await settlePendingLogout();
			return false;
		}
		return refresh();
	})().finally(() => {
		initializeInFlight = null;
	});
	return initializeInFlight;
}

async function requireSettledLogout(): Promise<void> {
	if (!hasPendingLogout()) return;
	if (!await settlePendingLogout()) {
		throw new Error('The previous admin sign-out is still pending. Reconnect and try again.');
	}
}

async function login(email: string, password: string): Promise<void> {
	await requireSettledLogout();
	await withAdminSessionLock(async () => {
		if (hasPendingLogout()) {
			throw new Error('The previous admin sign-out is still pending. Reconnect and try again.');
		}
		const generation = ++authGeneration;
		const res = await requestSession('auth/login', { email, password });
		if (!res.ok) {
			throw await buildAuthError(res, 'Login failed. Please check your email and password.');
		}
		const data = await res.json() as AuthTokenResponse;
		if (!applySession(data, generation)) throw new Error('Login response did not contain a valid admin session.');
		pendingLegacyRefreshToken = null;
		clearLegacyAuthStorage();
	});
}

async function setup(email: string, password: string): Promise<void> {
	await requireSettledLogout();
	await withAdminSessionLock(async () => {
		if (hasPendingLogout()) {
			throw new Error('The previous admin sign-out is still pending. Reconnect and try again.');
		}
		const generation = ++authGeneration;
		const res = await requestSession('setup', { email, password });
		if (!res.ok) {
			throw await buildAuthError(res, 'Failed to create admin account. Please check your details and try again.');
		}
		const data = await res.json() as AuthTokenResponse;
		if (!applySession(data, generation)) throw new Error('Setup response did not contain a valid admin session.');
		pendingLegacyRefreshToken = null;
		clearLegacyAuthStorage();
	});
}

function refresh(): Promise<boolean> {
	if (hasPendingLogout()) return Promise.resolve(false);
	if (refreshInFlight) return refreshInFlight;
	refreshInFlight = withAdminSessionLock(performRefresh).finally(() => {
		refreshInFlight = null;
	});
	return refreshInFlight;
}

async function settlePendingLogout(): Promise<boolean> {
	if (!hasPendingLogout()) return true;
	return withAdminSessionLock(async () => {
		try {
			const res = await requestSession('auth/logout', {});
			if (!res.ok) return false;
			clearPendingLogout();
			return true;
		} catch {
			return false;
		}
	});
}

async function performRefresh(): Promise<boolean> {
	if (hasPendingLogout()) return false;
	const generation = authGeneration;
	const migrationToken = pendingLegacyRefreshToken;
	try {
		const res = await requestSession(
			'auth/refresh',
			migrationToken ? { refreshToken: migrationToken } : {},
		);
		if (!res.ok) {
			if ([400, 401, 403].includes(res.status) && authGeneration === generation) {
				store.set(emptyState);
				pendingLegacyRefreshToken = null;
				clearSessionMarker();
			}
			return false;
		}

		const data = await res.json() as AuthTokenResponse;
		const applied = applySession(data, generation);
		if (applied) pendingLegacyRefreshToken = null;
		return applied;
	} catch {
		return false;
	} finally {
		clearLegacyAuthStorage();
	}
}

/** Clear private UI state immediately, then revoke the cookie-backed session. */
function logout(): Promise<void> {
	++authGeneration;
	store.set(emptyState);
	pendingLegacyRefreshToken = null;
	clearLegacyAuthStorage();
	markPendingLogout();
	clearSessionMarker();
	abortActiveSessionRequest();
	return settlePendingLogout().then(() => undefined);
}

export function handleAdminAuthStorageEvent(event: StorageEvent): void {
	if (event.key === ADMIN_LOGOUT_PENDING_KEY && event.newValue !== null) {
		++authGeneration;
		pendingLegacyRefreshToken = null;
		store.set(emptyState);
		abortActiveSessionRequest();
		return;
	}
	if (event.key !== ADMIN_SESSION_MARKER_KEY) return;
	const nextAdminId = readSessionMarkerAdminId();
	if (get(store).admin?.id === nextAdminId) return;

	++authGeneration;
	pendingLegacyRefreshToken = null;
	store.set(emptyState);
	abortActiveSessionRequest();
	if (!nextAdminId || hasPendingLogout()) return;

	const priorRefresh = refreshInFlight;
	void (priorRefresh ?? Promise.resolve(false)).finally(() => {
		if (
			!hasPendingLogout()
			&& readSessionMarkerAdminId() === nextAdminId
			&& !get(store).accessToken
		) void refresh();
	});
}

if (typeof window !== 'undefined') {
	window.addEventListener('storage', handleAdminAuthStorageEvent);
}

export const authStore = {
	subscribe: store.subscribe,
	set: store.set,
	update: store.update,
	initialize,
	login,
	setup,
	refresh,
	logout,
};
