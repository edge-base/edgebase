interface BuildRecordsQueryOptions {
	limit: number;
	offset: number;
	search?: string;
	sortKey?: string;
	sortDir?: 'asc' | 'desc';
	includeTotal?: boolean;
}

export function buildRecordsQuery({
	limit,
	offset,
	search,
	sortKey,
	sortDir = 'asc',
	includeTotal,
}: BuildRecordsQueryOptions): string {
	const params = new URLSearchParams({
		limit: String(limit),
		offset: String(offset),
	});

	if (search) params.set('search', search);
	if (sortKey) params.set('sort', `${sortKey}:${sortDir}`);
	if (includeTotal === false) params.set('includeTotal', '0');

	return params.toString();
}
