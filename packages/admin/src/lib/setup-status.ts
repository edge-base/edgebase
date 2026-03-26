import { getAdminApiUrl } from '$lib/runtime-config';
import { describeActionError } from '$lib/error-messages';

export interface SetupStatus {
	needsSetup: boolean;
	publicSetupAllowed?: boolean;
	setupMethod?: 'browser' | 'cli' | 'login';
	message?: string;
}

export async function fetchSetupStatus(): Promise<SetupStatus> {
	const res = await fetch(getAdminApiUrl('setup/status'));
	if (!res.ok) {
		const body = await res.json().catch(() => null) as { message?: unknown } | null;
		throw new Error(
			describeActionError(
				{
					status: res.status,
					message: typeof body?.message === 'string' ? body.message : undefined,
				},
				'Failed to load setup status.',
				{ hint: 'Refresh the admin page after the EdgeBase dev server finishes booting.' },
			),
		);
	}
	return res.json() as Promise<SetupStatus>;
}
