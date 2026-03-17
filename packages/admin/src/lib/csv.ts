/**
 * RFC 4180-compliant CSV parser and generator.
 * No external dependencies.
 */

export interface CsvData {
	headers: string[];
	rows: string[][];
}

/** Parse CSV text into headers + rows. Handles quoted fields, commas, and newlines. */
export function parseCSV(text: string): CsvData {
	const rows: string[][] = [];
	let current: string[] = [];
	let field = '';
	let inQuotes = false;
	let i = 0;

	while (i < text.length) {
		const ch = text[i];

		if (inQuotes) {
			if (ch === '"') {
				if (i + 1 < text.length && text[i + 1] === '"') {
					field += '"';
					i += 2;
				} else {
					inQuotes = false;
					i++;
				}
			} else {
				field += ch;
				i++;
			}
		} else {
			if (ch === '"') {
				inQuotes = true;
				i++;
			} else if (ch === ',') {
				current.push(field);
				field = '';
				i++;
			} else if (ch === '\r') {
				current.push(field);
				field = '';
				rows.push(current);
				current = [];
				i++;
				if (i < text.length && text[i] === '\n') i++;
			} else if (ch === '\n') {
				current.push(field);
				field = '';
				rows.push(current);
				current = [];
				i++;
			} else {
				field += ch;
				i++;
			}
		}
	}

	// Last field/row
	if (field || current.length > 0) {
		current.push(field);
		rows.push(current);
	}

	// Filter empty trailing rows
	while (rows.length > 0 && rows[rows.length - 1].every((f) => f === '')) {
		rows.pop();
	}

	if (rows.length === 0) return { headers: [], rows: [] };

	return {
		headers: rows[0],
		rows: rows.slice(1),
	};
}

/** Generate CSV string from columns and row data. */
export function generateCSV(columns: string[], rows: Record<string, unknown>[]): string {
	const lines: string[] = [];

	// Header
	lines.push(columns.map(escapeField).join(','));

	// Rows
	for (const row of rows) {
		const fields = columns.map((col) => {
			const val = row[col];
			if (val === null || val === undefined) return '';
			if (typeof val === 'object') return escapeField(JSON.stringify(val));
			return escapeField(String(val));
		});
		lines.push(fields.join(','));
	}

	return lines.join('\r\n');
}

function escapeField(val: string): string {
	if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
		return '"' + val.replace(/"/g, '""') + '"';
	}
	return val;
}

/** Infer column types from sample data rows. */
export function inferTypes(
	headers: string[],
	rows: string[][],
	sampleSize = 10,
): Record<string, 'text' | 'number' | 'boolean'> {
	const result: Record<string, 'text' | 'number' | 'boolean'> = {};
	const sample = rows.slice(0, sampleSize);

	for (let ci = 0; ci < headers.length; ci++) {
		const col = headers[ci];
		const values = sample.map((r) => r[ci]).filter((v) => v !== '' && v !== undefined);

		if (values.length === 0) {
			result[col] = 'text';
			continue;
		}

		const allNumbers = values.every((v) => !isNaN(Number(v)));
		const allBooleans = values.every((v) => v === 'true' || v === 'false' || v === '0' || v === '1');

		if (allBooleans) result[col] = 'boolean';
		else if (allNumbers) result[col] = 'number';
		else result[col] = 'text';
	}

	return result;
}
