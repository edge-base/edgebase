/**
 * Shared constants for the EdgeBase admin dashboard.
 */

/** Supported field types for schema definitions. */
export const FIELD_TYPES = [
	'string',
	'text',
	'number',
	'boolean',
	'datetime',
	'json'
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Fields that are automatically managed and should not be edited manually. */
export const AUTO_FIELDS = ['id', 'createdAt', 'updatedAt'] as const;

/** Maximum lengths for validation. */
export const LIMITS = {
	TABLE_NAME_MAX: 63,
	FIELD_NAME_MAX: 63,
	NAMESPACE_MAX: 63
} as const;

/** Namespace for system-internal tables. */
export const SYSTEM_NAMESPACE = '_system';

// ── Shared Types ─────────────────────────────────────────

export interface FkReference {
	table: string;
	column?: string;
	onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
	onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export interface SchemaField {
	type: string;
	required?: boolean;
	unique?: boolean;
	default?: unknown;
	min?: number;
	max?: number;
	pattern?: string;
	enum?: string[];
	references?: string | FkReference;
	check?: string;
}

export interface IndexConfig {
	fields: string[];
	unique?: boolean;
}
