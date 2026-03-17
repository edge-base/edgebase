/**
 * Field validation engine for table schemas.
 * Validates request body against schema field definitions.
 */
import type { SchemaField } from '@edgebase/shared';
import { buildEffectiveSchema } from './schema.js';

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export const CUSTOM_RECORD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
export const CUSTOM_RECORD_ID_MESSAGE =
  'Record ID must use English letters, numbers, hyphen (-), or underscore (_).';

export function validateCustomRecordId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return 'Record ID must be a string.';
  return CUSTOM_RECORD_ID_PATTERN.test(value) ? null : CUSTOM_RECORD_ID_MESSAGE;
}

export function summarizeValidationErrors(errors: Record<string, string>): string {
  const entries = Object.entries(errors);
  if (entries.length === 0) return 'Validation failed.';

  const [field, message] = entries[0];
  const label = field === 'id' ? 'record ID' : `'${field}'`;

  if (entries.length === 1) {
    return `Invalid ${label}. ${message}`;
  }

  return `Request body failed validation. First issue: invalid ${label}. ${message}`;
}

/**
 * Validate a record against a table schema for insert operations.
 * Checks required fields, types, constraints (min/max/pattern/enum).
 * When schema is undefined (schemaless,), all fields are accepted.
 */
export function validateInsert(
  data: Record<string, unknown>,
  schema?: Record<string, SchemaField | false>,
): ValidationResult {
  // Schemaless: accept everything
  if (!schema) return { valid: true, errors: {} };

  const effective = buildEffectiveSchema(schema);
  const errors: Record<string, string> = {};
  const idError = validateCustomRecordId(data.id);
  if (idError) {
    errors.id = idError;
  }

  for (const [name, field] of Object.entries(effective)) {
    // Skip auto-managed fields
    if (name === 'id' || name === 'createdAt' || name === 'updatedAt') continue;

    const value = data[name];

    // Check required
    if (field.required && (value === undefined || value === null)) {
      if (field.default === undefined) {
        errors[name] = 'Field is required.';
        continue;
      }
    }

    // Skip validation if value is absent (optional field)
    if (value === undefined || value === null) continue;

    // Validate type and constraints
    const typeErr = validateType(value, field);
    if (typeErr) {
      errors[name] = typeErr;
    }
  }

  // Unknown fields are silently ignored — the SQL layer filters them out
  // (schema-defined: columns = Object.keys(record).filter(k => k in effective)).
  // Rejecting unknown fields here would break SDK payloads that send extra metadata.

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validate a record against a table schema for update operations.
 * Partial validation — only checks provided fields.
 * When schema is undefined (schemaless,), all fields are accepted.
 */
export function validateUpdate(
  data: Record<string, unknown>,
  schema?: Record<string, SchemaField | false>,
): ValidationResult {
  // Schemaless: accept everything
  if (!schema) return { valid: true, errors: {} };

  const effective = buildEffectiveSchema(schema);
  const errors: Record<string, string> = {};

  for (const [name, value] of Object.entries(data)) {
    // Skip auto-managed fields
    if (name === 'id' || name === 'createdAt' || name === 'updatedAt') continue;

    const field = effective[name];
    if (!field) continue;

    if (isFieldOperator(value)) {
      if (value.$op === 'deleteField' && field.required) {
        errors[name] = 'Field is required and cannot be deleted.';
      }
      continue;
    }

    // Check required (can't set to null if required)
    if (field.required && (value === null || value === undefined)) {
      errors[name] = 'Field is required and cannot be null.';
      continue;
    }

    if (value === null || value === undefined) continue;

    const typeErr = validateType(value, field);
    if (typeErr) {
      errors[name] = typeErr;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ─── Type & Constraint Validation ───

function validateType(value: unknown, field: SchemaField): string | null {
  switch (field.type) {
    case 'string':
    case 'text':
      if (typeof value !== 'string') return 'Must be a string.';
      return validateStringConstraints(value, field);

    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) return 'Must be a number.';
      return validateNumberConstraints(value, field);

    case 'boolean':
      if (typeof value !== 'boolean') return 'Must be a boolean.';
      return null;

    case 'datetime':
      if (typeof value !== 'string') return 'Must be a datetime string.';
      if (Number.isNaN(Date.parse(value))) return 'Invalid datetime format.';
      return null;

    case 'json':
      // JSON fields accept any serializable value
      return null;

    default:
      return null;
  }
}

function validateStringConstraints(value: string, field: SchemaField): string | null {
  if (field.min !== undefined && value.length < field.min) {
    return `Must be at least ${field.min} characters.`;
  }
  if (field.max !== undefined && value.length > field.max) {
    return `Must be at most ${field.max} characters.`;
  }
  if (field.pattern !== undefined) {
    const regex = new RegExp(field.pattern);
    if (!regex.test(value)) return `Must match pattern: ${field.pattern}`;
  }
  if (field.enum !== undefined && !field.enum.includes(value)) {
    return `Must be one of: ${field.enum.join(', ')}`;
  }
  return null;
}

function validateNumberConstraints(value: number, field: SchemaField): string | null {
  if (field.min !== undefined && value < field.min) {
    return `Must be at least ${field.min}.`;
  }
  if (field.max !== undefined && value > field.max) {
    return `Must be at most ${field.max}.`;
  }
  return null;
}

// ─── Field Operator Detection ───

export interface FieldOperator {
  $op: 'increment' | 'deleteField';
  value?: number;
}

export function isFieldOperator(value: unknown): value is FieldOperator {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$op' in value &&
    typeof (value as FieldOperator).$op === 'string'
  );
}
