/**
 * Auth state store — manages admin JWT session.
 *
 * Persists to localStorage so the session survives page reloads.
 * Provides login, setup (initial admin creation), refresh, and logout actions.
 */

import { writable, get } from 'svelte/store';
import { getAdminApiUrl } from '$lib/runtime-config';
import { describeActionError } from '$lib/error-messages';

// ── Types ───────────────────────────────────────────────

export interface AdminUser {
	id: string;
	email: string;
}

export interface AuthState {
	accessToken: string | null;
	refreshToken: string | null;
	admin: AdminUser | null;
}

interface AuthTokenResponse {
	accessToken: string;
	refreshToken: string;
	admin: { id: string; email: string };
}

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

// ── LocalStorage ────────────────────────────────────────

export const ADMIN_AUTH_STORAGE_KEY = 'edgebase_admin_auth';
const STORAGE_KEY = ADMIN_AUTH_STORAGE_KEY;

function loadFromStorage(): AuthState {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			return {
				accessToken: parsed.accessToken ?? null,
				refreshToken: parsed.refreshToken ?? null,
				admin: parsed.admin ?? null
			};
		}
	} catch {
		// Corrupt storage — clear it so user gets clean login
		try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
	}
	return { accessToken: null, refreshToken: null, admin: null };
}

function saveToStorage(state: AuthState): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		console.warn('[EdgeBase] Failed to save auth state to localStorage');
	}
}

function clearStorage(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		console.warn('[EdgeBase] Failed to clear auth state from localStorage');
	}
}

// ── Store ───────────────────────────────────────────────

const initial = loadFromStorage();
const store = writable<AuthState>(initial);

// Persist every change
store.subscribe((state) => {
	if (state.accessToken) {
		saveToStorage(state);
	} else {
		clearStorage();
	}
});

// ── Actions ─────────────────────────────────────────────

/**
 * Log in with email + password.
 * POST {apiOrigin}/admin/api/auth/login
 */
async function login(email: string, password: string): Promise<void> {
	const res = await fetch(getAdminApiUrl('auth/login'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	});

	if (!res.ok) {
		throw await buildAuthError(res, 'Login failed. Please check your email and password.');
	}

	const data: AuthTokenResponse = await res.json();
	store.set({
		accessToken: data.accessToken,
		refreshToken: data.refreshToken,
		admin: data.admin
	});
}

/**
 * Initial admin setup — create the first admin account.
 * Local dev environments only; deployed/self-hosted environments bootstrap admins through the CLI.
 * POST {apiOrigin}/admin/api/setup
 */
async function setup(email: string, password: string): Promise<void> {
	const res = await fetch(getAdminApiUrl('setup'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	});

	if (!res.ok) {
		throw await buildAuthError(res, 'Failed to create admin account. Please check your details and try again.');
	}

	const data: AuthTokenResponse = await res.json();
	store.set({
		accessToken: data.accessToken,
		refreshToken: data.refreshToken,
		admin: data.admin
	});
}

/**
 * Attempt to refresh the access token using the refresh token.
 * POST {apiOrigin}/admin/api/auth/refresh
 * Returns true if refresh succeeded, false otherwise.
 */
async function refresh(): Promise<boolean> {
	const state = get(store);
	if (!state.refreshToken) return false;

	try {
		const res = await fetch(getAdminApiUrl('auth/refresh'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ refreshToken: state.refreshToken })
		});

		if (!res.ok) return false;

		const data: AuthTokenResponse = await res.json();
		store.set({
			accessToken: data.accessToken,
			refreshToken: data.refreshToken,
			admin: data.admin
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Clear session and redirect to login.
 */
function logout(): void {
	store.set({ accessToken: null, refreshToken: null, admin: null });
}

// ── Export ───────────────────────────────────────────────

export const authStore = {
	subscribe: store.subscribe,
	set: store.set,
	update: store.update,
	login,
	setup,
	refresh,
	logout
};
