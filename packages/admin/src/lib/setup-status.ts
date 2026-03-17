import { getAdminApiUrl } from '$lib/runtime-config';

export interface SetupStatus {
	needsSetup: boolean;
}

export async function fetchSetupStatus(): Promise<SetupStatus> {
	const res = await fetch(getAdminApiUrl('setup/status'));
	if (!res.ok) {
		throw new Error(`Failed to load setup status (${res.status})`);
	}
	return res.json() as Promise<SetupStatus>;
}
