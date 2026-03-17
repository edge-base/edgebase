/**
 * Dev mode info store.
 *
 * Calls GET /admin/api/data/dev-info once (per auth session) and caches the result.
 * Used by the API client to discover the sidecar port for schema mutations.
 */

import { writable, get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';
import { getAdminApiUrl } from '$lib/runtime-config';

// ── Types ───────────────────────────────────────────────

export interface DevInfoState {
	devMode: boolean;
	sidecarPort: number | null;
	loaded: boolean;
}

// ── Store ───────────────────────────────────────────────

const store = writable<DevInfoState>({
	devMode: false,
	sidecarPort: null,
	loaded: false
});

let previousAuthSessionKey: string | null = null;
let hasObservedAuthState = false;

authStore.subscribe((auth) => {
	const nextSessionKey = auth.accessToken && auth.admin ? auth.admin.id : null;

	if (hasObservedAuthState && previousAuthSessionKey !== nextSessionKey) {
		resetDevInfo();
	}

	hasObservedAuthState = true;
	previousAuthSessionKey = nextSessionKey;
});

/**
 * Fetch dev-info from the server. Caches a successful result;
 * retries on auth failures (401) since the token may not yet be available.
 *
 * Note: We read the JWT directly from authStore instead of using api.fetch()
 * to avoid circular imports (api.ts imports devInfo.ts).
 */
export async function loadDevInfo(): Promise<void> {
	const current = get(store);
	if (current.loaded) return;

	try {
		const auth = get(authStore);
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};
		if (auth.accessToken) {
			headers['Authorization'] = `Bearer ${auth.accessToken}`;
		}

		const res = await fetch(getAdminApiUrl('data/dev-info'), { headers });

		if (res.status === 401) {
			// Auth not ready yet — do NOT cache, allow retry after login
			return;
		}

		if (!res.ok) {
			// Non-auth error — treat as production, cache result
			store.set({ devMode: false, sidecarPort: null, loaded: true });
			return;
		}

		const data: { devMode: boolean; sidecarPort: number | null } = await res.json();
		store.set({
			devMode: data.devMode,
			sidecarPort: data.sidecarPort ?? null,
			loaded: true
		});
	} catch {
		// Network error — assume not dev mode, cache result
		store.set({ devMode: false, sidecarPort: null, loaded: true });
	}
}

/**
 * Reset the store so it re-fetches on next loadDevInfo() call.
 * Should be called on login/logout.
 */
export function resetDevInfo(): void {
	store.set({ devMode: false, sidecarPort: null, loaded: false });
}

export const devInfoStore = {
	subscribe: store.subscribe,
	loadDevInfo,
	reset: resetDevInfo
};
