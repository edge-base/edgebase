/**
 * $op field operator parser for PATCH update requests.
 * Converts field operators to SQL SET clause fragments.
 *
 * Supported operators:
 * - increment(n): field = COALESCE(field, 0) + n
 * - deleteField(): field = NULL
 */
import type { FieldOperator } from './validation.js';
import { EdgeBaseError } from '@edgebase/shared';

interface SetClause {
  /** SQL fragment for SET clause, e.g. "viewCount" = COALESCE("viewCount", 0) + ? */
  sql: string;
  /** Parameters for the SQL fragment */
  params: unknown[];
  /** Next placeholder index after consuming this clause's params */
  nextParamIndex: number;
}

export interface ParseUpdateBodyOptions {
  dialect?: 'sqlite' | 'postgres';
  startIndex?: number;
}

/**
 * Parse update body into SQL SET clause parts.
 * Handles both regular values and $op field operators.
 * Returns { setClauses, params } ready for UPDATE statement.
 */
export function parseUpdateBody(
  data: Record<string, unknown>,
  excludeFields: string[] = ['id'],
  options: ParseUpdateBodyOptions = {},
): { setClauses: string[]; params: unknown[]; nextParamIndex: number } {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  const dialect = options.dialect ?? 'sqlite';
  let paramIndex = options.startIndex ?? 1;

  for (const [key, value] of Object.entries(data)) {
    if (excludeFields.includes(key)) continue;

    if (isOpObject(value)) {
      const clause = buildOpClause(key, value as FieldOperator, dialect, paramIndex);
      setClauses.push(clause.sql);
      params.push(...clause.params);
      paramIndex = clause.nextParamIndex;
    } else {
      setClauses.push(`${esc(key)} = ${placeholderFor(dialect, paramIndex)}`);
      params.push(value);
      paramIndex++;
    }
  }

  return { setClauses, params, nextParamIndex: paramIndex };
}

function buildOpClause(
  field: string,
  op: FieldOperator,
  dialect: 'sqlite' | 'postgres',
  paramIndex: number,
): SetClause {
  switch (op.$op) {
    case 'increment':
      return {
        sql: `${esc(field)} = COALESCE(${esc(field)}, 0) + ${placeholderFor(dialect, paramIndex)}`,
        params: [op.value ?? 0],
        nextParamIndex: paramIndex + 1,
      };

    case 'deleteField':
      return {
        sql: `${esc(field)} = NULL`,
        params: [],
        nextParamIndex: paramIndex,
      };

    default:
      throw new EdgeBaseError(400, `Unknown field operator '${(op as FieldOperator).$op}'. Supported operators: increment, deleteField.`);
  }
}

function placeholderFor(dialect: 'sqlite' | 'postgres', paramIndex: number): string {
  return dialect === 'postgres' ? `$${paramIndex}` : '?';
}

function isOpObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$op' in value
  );
}

function esc(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
