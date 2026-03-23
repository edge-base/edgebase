import { render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// matchMedia mock for CodeMirror theme detection
if (typeof window !== 'undefined' && !window.matchMedia) {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
}

const mocks = vi.hoisted(() => {
	const schemaState = { schema: {} as Record<string, unknown> };
	return {
		goto: vi.fn(),
		apiFetch: vi.fn().mockResolvedValue({ columns: [], rows: [], rowCount: 0, time: 0 }),
		page: {
			subscribe(run: (value: { url: URL; params: Record<string, string> }) => void) {
				run({ url: new URL('http://localhost/admin/database/sql'), params: {} });
				return () => undefined;
			},
		},
		schemaStore: {
			subscribe(run: (value: typeof schemaState) => void) {
				run(schemaState);
				return () => undefined;
			},
			loadSchema: vi.fn().mockResolvedValue({}),
		},
		namespaceNames: {
			subscribe(run: (value: string[]) => void) {
				run(['shared']);
				return () => undefined;
			},
		},
		namespaceDefs: {
			subscribe(run: (value: Record<string, { dynamic?: boolean }>) => void) {
				run({ shared: { dynamic: false } });
				return () => undefined;
			},
		},
	};
});

vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
}));

vi.mock('$app/paths', () => ({
	base: '/admin',
}));

vi.mock('$app/stores', () => ({
	page: mocks.page,
}));

vi.mock('$lib/api', () => ({
	api: { fetch: mocks.apiFetch },
}));

vi.mock('$lib/stores/schema', () => ({
	schemaStore: mocks.schemaStore,
	namespaceNames: mocks.namespaceNames,
	namespaceDefs: mocks.namespaceDefs,
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock('$lib/docs-links', () => ({
	databaseDocs: 'https://docs.example.com/database',
}));

// Mock SqlEditor to avoid CodeMirror in test environment
vi.mock('$lib/components/ui/SqlEditor.svelte', () => ({
	default: {},
}));

import SqlConsolePage from './+page.svelte';

describe('database sql page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders SQL Console heading', () => {
		const { getByText } = render(SqlConsolePage);
		expect(getByText('SQL Console')).toBeTruthy();
	});

	it('renders Execute button', () => {
		const { getByText } = render(SqlConsolePage);
		expect(getByText('Execute')).toBeTruthy();
	});
});
