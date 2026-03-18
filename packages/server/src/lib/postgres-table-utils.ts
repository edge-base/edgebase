import type { SchemaField, TableConfig } from '@edgebase-fun/shared';
import { buildEffectiveSchema } from './schema.js';
import { generateId } from './uuid.js';

export function escapePgIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function stripInternalPgFields(row: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...row };
  delete cleaned._fts;
  return cleaned;
}

export function serializePgJsonFields(
  data: Record<string, unknown>,
  schema: Record<string, SchemaField>,
): void {
  for (const [key, field] of Object.entries(schema)) {
    if (field.type === 'json' && data[key] !== undefined && data[key] !== null) {
      if (typeof data[key] !== 'string') {
        data[key] = JSON.stringify(data[key]);
      }
    }
  }
}

export function filterToPgSchemaColumns(
  data: Record<string, unknown>,
  effectiveSchema: Record<string, SchemaField>,
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (key in effectiveSchema) {
      filtered[key] = data[key];
    }
  }
  return filtered;
}

export function preparePgInsertData(
  body: Record<string, unknown>,
  tableConfig: TableConfig,
): {
  data: Record<string, unknown>;
  effectiveSchema: Record<string, SchemaField>;
} {
  const effectiveSchema = buildEffectiveSchema(tableConfig.schema);
  const prepared = { ...body };

  if (!prepared.id) prepared.id = generateId();
  const now = new Date().toISOString();
  if (effectiveSchema.createdAt) prepared.createdAt = now;
  if (effectiveSchema.updatedAt) prepared.updatedAt = now;

  for (const [name, field] of Object.entries(effectiveSchema)) {
    if (prepared[name] === undefined && field.default !== undefined) {
      prepared[name] = field.default;
    }
  }

  const data = filterToPgSchemaColumns(prepared, effectiveSchema);
  serializePgJsonFields(data, effectiveSchema);
  return { data, effectiveSchema };
}

export function preparePgUpdateData(
  body: Record<string, unknown>,
  tableConfig: TableConfig,
): {
  data: Record<string, unknown>;
  effectiveSchema: Record<string, SchemaField>;
} {
  const effectiveSchema = buildEffectiveSchema(tableConfig.schema);
  const prepared = { ...body };

  if (effectiveSchema.updatedAt) {
    prepared.updatedAt = new Date().toISOString();
  }

  delete prepared.id;
  delete prepared.createdAt;

  const data = filterToPgSchemaColumns(prepared, effectiveSchema);
  serializePgJsonFields(data, effectiveSchema);
  return { data, effectiveSchema };
}
