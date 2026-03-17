import { describe, expect, it } from 'vitest';

import { buildRecordsQuery } from './records-query';

describe('buildRecordsQuery', () => {
	it('encodes search and sort params for record queries', () => {
		const query = buildRecordsQuery({
			limit: 20,
			offset: 40,
			search: 'alice',
			sortKey: 'createdAt',
			sortDir: 'desc',
		});

		const params = new URLSearchParams(query);

		expect(params.get('limit')).toBe('20');
		expect(params.get('offset')).toBe('40');
		expect(params.get('search')).toBe('alice');
		expect(params.get('sort')).toBe('createdAt:desc');
	});

	it('omits optional params when they are not active', () => {
		const query = buildRecordsQuery({
			limit: 20,
			offset: 0,
		});

		const params = new URLSearchParams(query);

		expect(params.has('search')).toBe(false);
		expect(params.has('sort')).toBe(false);
	});
});
