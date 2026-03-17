import { expect, type Page } from '@playwright/test';

export interface MockUser {
	id: string;
	email: string;
	status: string;
	role: string;
	createdAt: string;
	lastSignedInAt: string | null;
	profile?: Record<string, unknown>;
}

export interface MockStorageObject {
	key: string;
	size: number;
	uploaded: string;
	contentType?: string;
	body?: string;
}

interface MockBucket {
	objects: MockStorageObject[];
}

export interface MockAdminApiOptions {
	needsSetup?: boolean;
	users?: MockUser[];
	failDeleteUserIds?: string[];
	failStorageDeleteKeys?: string[];
	storagePageSize?: number;
}

interface MockAdminState {
	needsSetup: boolean;
	admin: { id: string; email: string };
	users: MockUser[];
	failDeleteUserIds: Set<string>;
	failStorageDeleteKeys: Set<string>;
	storagePageSize: number;
	buckets: Record<string, MockBucket>;
	namespaces: Record<string, { provider: 'do' | 'd1' | 'neon' | 'postgres'; dynamic: boolean }>;
	schema: Record<
		string,
		{
			namespace: string;
			provider: 'do' | 'd1' | 'neon' | 'postgres';
			dynamic: boolean;
			fields: Record<string, { type: string; references?: string }>;
		}
	>;
}

export interface MockAdminController {
	state: MockAdminState;
	assertNoUnhandled: () => void;
}

function jsonResponse(status: number, data: unknown) {
	return {
		status,
		contentType: 'application/json',
		body: JSON.stringify(data),
	};
}

function defaultUsers(): MockUser[] {
	return [
		{
			id: 'user_alpha',
			email: 'alpha@example.com',
			status: 'active',
			role: 'user',
			createdAt: '2026-03-01T10:00:00.000Z',
			lastSignedInAt: '2026-03-10T12:30:00.000Z',
			profile: { displayName: 'Alpha', plan: 'starter' },
		},
		{
			id: 'user_bravo',
			email: 'bravo@example.com',
			status: 'suspended',
			role: 'user',
			createdAt: '2026-03-02T10:00:00.000Z',
			lastSignedInAt: null,
			profile: { displayName: 'Bravo', plan: 'pro' },
		},
	];
}

function defaultState(options: MockAdminApiOptions = {}): MockAdminState {
	return {
		needsSetup: options.needsSetup ?? false,
		admin: {
			id: 'admin_1',
			email: 'admin@example.com',
		},
		users: (options.users ?? defaultUsers()).map((user) => ({ ...user })),
		failDeleteUserIds: new Set(options.failDeleteUserIds ?? []),
		failStorageDeleteKeys: new Set(options.failStorageDeleteKeys ?? []),
		storagePageSize: options.storagePageSize ?? 1,
		buckets: {
			avatars: {
				objects: [
					{
						key: 'folder/avatar.png',
						size: 1024,
						uploaded: '2026-03-04T10:00:00.000Z',
						contentType: 'image/png',
						body: 'avatar-image',
					},
					{
						key: 'folder/report.pdf',
						size: 2048,
						uploaded: '2026-03-05T10:00:00.000Z',
						contentType: 'application/pdf',
						body: 'report-body',
					},
					{
						key: 'folder/nested/',
						size: 0,
						uploaded: '2026-03-06T10:00:00.000Z',
						contentType: 'application/x-directory',
						body: '',
					},
				],
			},
		},
		namespaces: {
			shared: {
				provider: 'd1',
				dynamic: false,
			},
			workspace: {
				provider: 'do',
				dynamic: true,
			},
			analytics: {
				provider: 'postgres',
				dynamic: false,
			},
			reporting: {
				provider: 'neon',
				dynamic: false,
			},
		},
		schema: {
			users: {
				namespace: 'shared',
				provider: 'd1',
				dynamic: false,
				fields: {
					email: { type: 'text' },
				},
			},
			posts: {
				namespace: 'shared',
				provider: 'd1',
				dynamic: false,
				fields: {
					title: { type: 'text' },
					authorId: { type: 'text', references: 'users' },
				},
			},
			tasks: {
				namespace: 'workspace',
				provider: 'do',
				dynamic: true,
				fields: {
					title: { type: 'text' },
					done: { type: 'boolean' },
					ownerId: { type: 'text', references: 'users' },
				},
			},
			events: {
				namespace: 'analytics',
				provider: 'postgres',
				dynamic: false,
				fields: {
					name: { type: 'text' },
					postId: { type: 'text', references: 'posts' },
				},
			},
		},
	};
}

function buildDatabaseSummaries(state: MockAdminState) {
	return Object.keys(state.namespaces)
		.sort((a, b) => a.localeCompare(b))
		.map((name) => ({
			name,
			tableCount: Object.values(state.schema).filter((table) => table.namespace === name).length,
			hasAccess: true,
		}));
}

function buildOverview(state: MockAdminState) {
	return {
		project: {
			totalUsers: state.users.length,
			totalTables: Object.keys(state.schema).length,
			databases: buildDatabaseSummaries(state),
			storageBuckets: Object.keys(state.buckets),
			serviceKeyCount: 1,
			authProviders: ['google'],
			liveConnections: 3,
			liveChannels: 2,
			devMode: true,
		},
		traffic: {
			summary: {
				totalRequests: 128,
				totalErrors: 4,
				avgLatency: 42,
				uniqueUsers: 18,
			},
			timeSeries: [
				{ timestamp: 1, requests: 18 },
				{ timestamp: 2, requests: 24 },
				{ timestamp: 3, requests: 32 },
				{ timestamp: 4, requests: 54 },
			],
			breakdown: [],
			topItems: [],
		},
	};
}

function buildConfigInfo(state: MockAdminState) {
	return {
		devMode: true,
		release: false,
		databases: buildDatabaseSummaries(state),
		storageBuckets: Object.keys(state.buckets),
		serviceKeyCount: 1,
		serviceKeys: ['svc_***masked'],
		bindings: { kv: ['KV_MAIN'], d1: ['DB_MAIN'], vectorize: [] },
		auth: { providers: ['google'], anonymousAuth: true },
		rateLimiting: [],
	};
}

function buildAnalyticsOverview(category = 'overview') {
	return {
		timeSeries: [
			{ timestamp: 1, requests: 42, errors: 1, avgLatency: 18, uniqueUsers: 9 },
			{ timestamp: 2, requests: 68, errors: 2, avgLatency: 24, uniqueUsers: 11 },
		],
		summary: {
			totalRequests: category === 'overview' ? 200 : 96,
			totalErrors: 6,
			avgLatency: 22,
			uniqueUsers: 18,
		},
		breakdown: [
			{ label: category === 'overview' ? 'db' : category, count: 72, percentage: 60 },
			{ label: 'auth', count: 24, percentage: 20 },
		],
		topItems: [
			{ label: '/api/posts', count: 48, avgLatency: 34, errorRate: 1.2 },
			{ label: '/api/users', count: 17, avgLatency: 21, errorRate: 0.4 },
		],
	};
}

function buildEventTimeline() {
	return {
		events: [
			{
				id: 'evt_signin',
				type: 'signin',
				category: 'auth',
				userId: 'user_alpha',
				userEmail: 'alpha@example.com',
				timestamp: '2026-03-10T12:00:00.000Z',
				metadata: {
					ip: '127.0.0.1',
					userAgent: 'Playwright',
				},
			},
		],
	};
}

function buildLogs(cursor: string | null) {
	if (cursor === 'next-cursor') {
		return {
			logs: [
				{
					method: 'POST',
					path: '/api/posts',
					status: 201,
					duration: 9,
					category: 'db',
					timestamp: '2026-03-13T12:01:00.000Z',
					message: 'created',
				},
			],
			cursor: null,
		};
	}

	return {
		logs: [
			{
				method: 'GET',
				path: '/api/posts',
				status: 500,
				duration: 21,
				category: 'db',
				timestamp: '2026-03-13T12:00:00.000Z',
				message: 'boom',
			},
		],
		cursor: 'next-cursor',
	};
}

function listObjects(state: MockAdminState, bucketName: string, prefix: string, cursorParam: string | null) {
	const bucket = state.buckets[bucketName];
	if (!bucket) {
		return { objects: [], folders: [], cursor: null };
	}

	const directObjects: MockStorageObject[] = [];
	const folders = new Set<string>();

	for (const object of bucket.objects) {
		if (!object.key.startsWith(prefix)) continue;
		const rest = object.key.slice(prefix.length);
		if (!rest) continue;

		const slashIndex = rest.indexOf('/');
		if (slashIndex === -1 || slashIndex === rest.length - 1 && object.contentType !== 'application/x-directory') {
			directObjects.push(object);
			continue;
		}

		folders.add(`${prefix}${rest.slice(0, slashIndex + 1)}`);
	}

	const sortedObjects = directObjects.sort((a, b) => a.key.localeCompare(b.key));
	const sortedFolders = [...folders].sort();
	const offset = Number(cursorParam ?? '0') || 0;
	const pageSize = state.storagePageSize;
	const pageObjects = sortedObjects.slice(offset, offset + pageSize);
	const nextCursor = offset + pageSize < sortedObjects.length ? String(offset + pageSize) : null;

	return {
		objects: pageObjects.map((object) => ({
			key: object.key,
			size: object.size,
			uploaded: object.uploaded,
			httpMetadata: object.contentType ? { contentType: object.contentType } : undefined,
		})),
		folders: sortedFolders,
		cursor: nextCursor,
	};
}

export async function installMockAdminApi(
	page: Page,
	options: MockAdminApiOptions = {},
): Promise<MockAdminController> {
	const state = defaultState(options);
	const unhandledRequests: string[] = [];

	await page.route('http://localhost:4312/**', async (route, request) => {
		const url = new URL(request.url());
		const method = request.method();
		const path = url.pathname.replace(/^\/+/, '');

		if (path === 'integrations/neon/projects' && method === 'GET') {
			await route.fulfill(jsonResponse(200, {
				items: [
					{
						projectId: 'neon_proj_1',
						projectName: 'edgebase-main',
						orgId: 'org_1',
						orgName: 'EdgeBase',
					},
				],
			}));
			return;
		}

		if (path === 'integrations/neon/databases' && method === 'POST') {
			await route.fulfill(jsonResponse(200, {
				ok: true,
				projectId: 'neon_proj_1',
			}));
			return;
		}

		unhandledRequests.push(`${method} ${request.url()}`);
		await route.fulfill(jsonResponse(404, { message: `Unhandled mock sidecar route: ${method} ${path}` }));
	});

	await page.route('**/admin/api/**', async (route, request) => {
		const url = new URL(request.url());
		const method = request.method();
		const path = url.pathname.replace(/^.*\/admin\/api\/?/, '');
		const bodyText = request.postData();
		const body = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {};

		if (path === 'setup/status' && method === 'GET') {
			await route.fulfill(jsonResponse(200, { needsSetup: state.needsSetup }));
			return;
		}

		if (path === 'auth/login' && method === 'POST') {
			await route.fulfill(jsonResponse(200, {
				accessToken: 'access-token',
				refreshToken: 'refresh-token',
				admin: state.admin,
			}));
			return;
		}

		if (path === 'auth/refresh' && method === 'POST') {
			await route.fulfill(jsonResponse(200, {
				accessToken: 'access-token-refreshed',
				refreshToken: 'refresh-token-refreshed',
				admin: state.admin,
			}));
			return;
		}

		if (path === 'setup' && method === 'POST') {
			state.needsSetup = false;
			await route.fulfill(jsonResponse(200, {
				accessToken: 'access-token',
				refreshToken: 'refresh-token',
				admin: state.admin,
			}));
			return;
		}

		if (path === 'data/dev-info' && method === 'GET') {
			await route.fulfill(jsonResponse(200, { devMode: true, sidecarPort: 4312 }));
			return;
		}

		if (path === 'data/overview' && method === 'GET') {
			await route.fulfill(jsonResponse(200, buildOverview(state)));
			return;
		}

		if (path === 'data/analytics' && method === 'GET') {
			const category = url.searchParams.get('category') ?? 'overview';
			await route.fulfill(jsonResponse(200, buildAnalyticsOverview(category)));
			return;
		}

		if (path === 'data/analytics/events' && method === 'GET') {
			await route.fulfill(jsonResponse(200, buildEventTimeline()));
			return;
		}

		if (path === 'data/config-info' && method === 'GET') {
			await route.fulfill(jsonResponse(200, buildConfigInfo(state)));
			return;
		}

		if (path === 'data/schema' && method === 'GET') {
			await route.fulfill(jsonResponse(200, { schema: state.schema, namespaces: state.namespaces }));
			return;
		}

		if (path === 'data/sql' && method === 'POST') {
			const sql = String(body.sql ?? '');
			if (sql.includes('sqlite_master')) {
				await route.fulfill(jsonResponse(200, {
					columns: ['name', 'type'],
					rows: [{ name: 'posts', type: 'table' }],
					rowCount: 1,
					time: 8,
				}));
				return;
			}

			if (sql.includes('"posts"') || sql.includes("'posts'")) {
				await route.fulfill(jsonResponse(200, {
					columns: ['id', 'title'],
					rows: [{ id: 'post_1', title: 'Hello world' }],
					rowCount: 1,
					time: 5,
				}));
				return;
			}

			await route.fulfill(jsonResponse(200, {
				columns: [],
				rows: [],
				rowCount: 0,
				time: 3,
			}));
			return;
		}

		if (path === 'data/logs' && method === 'GET') {
			await route.fulfill(jsonResponse(200, buildLogs(url.searchParams.get('cursor'))));
			return;
		}

		if (path === 'data/monitoring' && method === 'GET') {
			await route.fulfill(jsonResponse(200, {
				activeConnections: 12,
				authenticatedConnections: 7,
				channels: 2,
				channelDetails: [
					{ channel: 'posts:shared', subscribers: 3 },
				],
			}));
			return;
		}

		if (path === 'data/functions' && method === 'GET') {
			await route.fulfill(jsonResponse(200, {
				functions: [
					{ path: 'hello', methods: ['POST', 'GET'], type: 'public' },
				],
			}));
			return;
		}

		if (path === 'data/push/tokens' && method === 'GET') {
			const userId = url.searchParams.get('userId') ?? '';
			await route.fulfill(jsonResponse(200, {
				items: userId
					? [
						{
							deviceId: 'device_alpha',
							platform: 'ios',
							token: 'token_alpha_1234567890',
							registeredAt: '2026-03-12T08:00:00.000Z',
						},
					]
					: [],
			}));
			return;
		}

		if (path === 'data/push/test-send' && method === 'POST') {
			await route.fulfill(jsonResponse(200, {
				sent: 1,
				failed: 0,
				total: 1,
			}));
			return;
		}

		if (path === 'data/push/logs' && method === 'GET') {
			await route.fulfill(jsonResponse(200, {
				items: [
					{
						sentAt: '2026-03-12T09:00:00.000Z',
						userId: 'user_alpha',
						status: 'success',
						tokensSent: 1,
						tokensFailed: 0,
						payload: { title: 'Welcome back' },
					},
				],
			}));
			return;
		}

		if (path === 'data/users' && method === 'GET') {
			const email = (url.searchParams.get('email') ?? '').toLowerCase();
			const cursor = Number(url.searchParams.get('cursor') ?? '0') || 0;
			const limit = Number(url.searchParams.get('limit') ?? '20') || 20;
			const filtered = state.users.filter((user) => user.email.toLowerCase().includes(email));
			const pageUsers = filtered.slice(cursor, cursor + limit).map(({ profile: _profile, ...user }) => user);
			const nextCursor = cursor + limit < filtered.length ? String(cursor + limit) : null;
			await route.fulfill(jsonResponse(200, {
				users: pageUsers,
				cursor: nextCursor,
				total: filtered.length,
			}));
			return;
		}

		if (path === 'data/users' && method === 'POST') {
			const nextUser: MockUser = {
				id: `user_${state.users.length + 1}`,
				email: String(body.email ?? ''),
				status: 'active',
				role: String(body.role ?? 'user'),
				createdAt: '2026-03-14T09:00:00.000Z',
				lastSignedInAt: null,
				profile: {
					displayName: body.displayName ? String(body.displayName) : 'New User',
					plan: 'starter',
				},
			};
			state.users.unshift(nextUser);
			await route.fulfill(jsonResponse(200, { ok: true, user: nextUser }));
			return;
		}

		const userMatch = path.match(/^data\/users\/([^/]+)$/);
		if (userMatch && method === 'GET') {
			const user = state.users.find((entry) => entry.id === userMatch[1]);
			if (!user) {
				await route.fulfill(jsonResponse(404, { message: 'User not found' }));
				return;
			}
			const { profile: _profile, ...rest } = user;
			await route.fulfill(jsonResponse(200, { user: rest }));
			return;
		}

		if (userMatch && method === 'PUT') {
			const user = state.users.find((entry) => entry.id === userMatch[1]);
			if (!user) {
				await route.fulfill(jsonResponse(404, { message: 'User not found' }));
				return;
			}
			user.status = String(body.status ?? user.status);
			user.role = String(body.role ?? user.role);
			await route.fulfill(jsonResponse(200, { ok: true }));
			return;
		}

		if (userMatch && method === 'DELETE') {
			const userId = userMatch[1];
			if (state.failDeleteUserIds.has(userId)) {
				await route.fulfill(jsonResponse(500, { message: 'Cannot delete user in this scenario' }));
				return;
			}
			state.users = state.users.filter((entry) => entry.id !== userId);
			await route.fulfill(jsonResponse(200, { ok: true }));
			return;
		}

		const userProfileMatch = path.match(/^data\/users\/([^/]+)\/profile$/);
		if (userProfileMatch && method === 'GET') {
			const user = state.users.find((entry) => entry.id === userProfileMatch[1]);
			if (!user) {
				await route.fulfill(jsonResponse(404, { message: 'User not found' }));
				return;
			}
			await route.fulfill(jsonResponse(200, {
				id: user.id,
				...(user.profile ?? {}),
			}));
			return;
		}

		const userResetMatch = path.match(/^data\/users\/([^/]+)\/send-password-reset$/);
		if (userResetMatch && method === 'POST') {
			await route.fulfill(jsonResponse(200, { ok: true }));
			return;
		}

		const revokeSessionsMatch = path.match(/^data\/users\/([^/]+)\/sessions$/);
		if (revokeSessionsMatch && method === 'DELETE') {
			await route.fulfill(jsonResponse(200, { ok: true }));
			return;
		}

		const userMfaMatch = path.match(/^data\/users\/([^/]+)\/mfa$/);
		if (userMfaMatch && method === 'DELETE') {
			await route.fulfill(jsonResponse(200, { ok: true }));
			return;
		}

		if (path === 'data/storage/buckets' && method === 'GET') {
			await route.fulfill(jsonResponse(200, {
				buckets: Object.keys(state.buckets),
			}));
			return;
		}

		const tableRecordsMatch = path.match(/^data\/tables\/([^/]+)\/records(?:\/([^/]+))?$/);
		if (tableRecordsMatch && method === 'GET') {
			const tableName = decodeURIComponent(tableRecordsMatch[1]);
			if (tableName === 'posts') {
				await route.fulfill(jsonResponse(200, {
					items: [
						{ id: 'post_1', title: 'Hello world' },
					],
					total: 1,
				}));
				return;
			}

			await route.fulfill(jsonResponse(200, {
				items: [],
				total: 0,
			}));
			return;
		}

		const bucketStatsMatch = path.match(/^data\/storage\/buckets\/([^/]+)\/stats$/);
		if (bucketStatsMatch && method === 'GET') {
			const bucketName = decodeURIComponent(bucketStatsMatch[1]);
			const bucket = state.buckets[bucketName];
			const objects = bucket?.objects ?? [];
			await route.fulfill(jsonResponse(200, {
				totalObjects: objects.length,
				totalSize: objects.reduce((sum, object) => sum + object.size, 0),
			}));
			return;
		}

		const listObjectsMatch = path.match(/^data\/storage\/buckets\/([^/]+)\/objects$/);
		if (listObjectsMatch && method === 'GET') {
			const bucketName = decodeURIComponent(listObjectsMatch[1]);
			const prefix = url.searchParams.get('prefix') ?? '';
			const cursor = url.searchParams.get('cursor');
			await route.fulfill(jsonResponse(200, listObjects(state, bucketName, prefix, cursor)));
			return;
		}

		const objectMutationMatch = path.match(/^data\/storage\/buckets\/([^/]+)\/objects\/(.+)$/);
		if (objectMutationMatch && method === 'GET') {
			const bucketName = decodeURIComponent(objectMutationMatch[1]);
			const objectKey = decodeURIComponent(objectMutationMatch[2]);
			const object = state.buckets[bucketName]?.objects.find((entry) => entry.key === objectKey);
			if (!object) {
				await route.fulfill(jsonResponse(404, { message: 'Object not found' }));
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: object.contentType ?? 'application/octet-stream',
				body: object.body ?? '',
			});
			return;
		}

		if (objectMutationMatch && method === 'DELETE') {
			const bucketName = decodeURIComponent(objectMutationMatch[1]);
			const objectKey = decodeURIComponent(objectMutationMatch[2]);
			if (state.failStorageDeleteKeys.has(objectKey)) {
				await route.fulfill(jsonResponse(500, { message: 'Delete failed for this object' }));
				return;
			}
			state.buckets[bucketName].objects = state.buckets[bucketName].objects.filter((object) => object.key !== objectKey);
			await route.fulfill(jsonResponse(200, { ok: true, deleted: objectKey }));
			return;
		}

		unhandledRequests.push(`${method} ${path}`);
		await route.fulfill(jsonResponse(501, { message: `Unhandled mock route: ${method} ${path}` }));
	});

	return {
		state,
		assertNoUnhandled() {
			expect(unhandledRequests, `Unhandled admin API requests: ${unhandledRequests.join(', ')}`).toEqual([]);
		},
	};
}
