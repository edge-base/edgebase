/**
 * Shared Zod schemas — single source of truth for request/response shapes.
 *
 * These schemas serve three purposes:
 *   1. Runtime validation (Zod)
 *   2. OpenAPI spec generation (@hono/zod-openapi)
 *   3. SDK type generation (via OpenAPI)
 *
 * IMPORTANT: queryParamsSchema keys MUST stay in sync with QUERY_PARAM_KEYS
 * in query-engine.ts. The 3-way sync test in query.test.ts enforces this.
 */
import { z } from '@hono/zod-openapi';

// ─── Query Parameters ───────────────────────────────────────────────────────

/** Zod schema for REST query parameters. Keys mirror QUERY_PARAM_KEYS. */
export const queryParamsSchema = z.object({
  limit: z.string().optional().openapi({ description: 'Max items to return', example: '20' }),
  offset: z.string().optional().openapi({ description: 'Offset for pagination', example: '0' }),
  page: z.string().optional().openapi({ description: 'Page number (1-based)', example: '1' }),
  perPage: z.string().optional().openapi({ description: 'Items per page', example: '20' }),
  after: z.string().optional().openapi({ description: 'Cursor for next page' }),
  before: z.string().optional().openapi({ description: 'Cursor for previous page' }),
  sort: z.string().optional().openapi({ description: 'Sort: field:asc,field2:desc', example: 'createdAt:desc' }),
  filter: z.string().optional().openapi({ description: 'JSON-encoded filter tuples', example: '[["status","==","active"]]' }),
  orFilter: z.string().optional().openapi({ description: 'JSON-encoded OR filter tuples' }),
  fields: z.string().optional().openapi({ description: 'Comma-separated field names to return' }),
  search: z.string().optional().openapi({ description: 'Full-text search query' }),
});

// ─── Response Schemas ───────────────────────────────────────────────────────

/** List response — shared by all paginated endpoints. */
export const listResponseSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).openapi({ description: 'Result items' }),
  total: z.number().nullable().openapi({ description: 'Total count (offset mode)' }),
  hasMore: z.boolean().nullable().openapi({ description: 'More pages available (cursor mode)' }),
  cursor: z.string().nullable().openapi({ description: 'Cursor for next page' }),
  page: z.number().nullable().openapi({ description: 'Current page (offset mode)' }),
  perPage: z.number().nullable().openapi({ description: 'Items per page (offset mode)' }),
});

/** Standard error response. */
export const errorResponseSchema = z.object({
  code: z.number().openapi({ description: 'HTTP status code', example: 400 }),
  message: z.string().openapi({ description: 'Human-readable message', example: 'Invalid request body' }),
});

/** Single record response (generic). */
export const recordResponseSchema = z.record(z.string(), z.unknown()).openapi({
  description: 'A single database record',
});

/** Success response for mutations. */
export const successResponseSchema = z.object({
  success: z.literal(true),
}).openapi({ description: 'Operation completed successfully' });

/** Health check response. */
export const healthResponseSchema = z.object({
  status: z.string().openapi({ example: 'ok' }),
  timestamp: z.string().openapi({ example: '2026-01-01T00:00:00.000Z' }),
  version: z.string().optional().openapi({ example: '0.1.0' }),
});

// ─── Shared Parameter Schemas ─────────────────────────────────────────────

export const idParamSchema = z.object({ id: z.string().openapi({ description: 'Record ID' }) });
export const nameParamSchema = z.object({ name: z.string().openapi({ description: 'Resource name' }) });
export const bucketParamSchema = z.object({ bucket: z.string().openapi({ description: 'Storage bucket name' }) });
export const providerParamSchema = z.object({ provider: z.string().openapi({ description: 'OAuth provider name' }) });

// ─── Generic Response Schemas ─────────────────────────────────────────────

/** Generic JSON response (for endpoints with dynamic shapes). */
export const jsonResponseSchema = z.record(z.string(), z.unknown()).openapi({ description: 'JSON response' });

/** Simple ok response. */
export const okResponseSchema = z.object({
  ok: z.literal(true),
}).openapi({ description: 'Operation succeeded' });

// ─── Shared Body Schemas ──────────────────────────────────────────────────

export const d1BodySchema = z.object({
  query: z.string().openapi({ description: 'SQL query string' }),
  params: z.array(z.unknown()).optional().openapi({ description: 'Bind parameters' }),
});

export const sqlBodySchema = z.object({
  namespace: z.string().openapi({ description: 'Database namespace' }),
  id: z.string().optional().openapi({ description: 'Instance ID (for dynamic DBs)' }),
  sql: z.string().openapi({ description: 'SQL query' }),
  params: z.array(z.unknown()).optional().openapi({ description: 'Bind parameters' }),
});

export const kvBodySchema = z.object({
  action: z.enum(['get', 'set', 'delete', 'list']).openapi({ description: 'KV operation' }),
  key: z.string().optional().openapi({ description: 'KV key' }),
  value: z.string().optional().openapi({ description: 'Value to set' }),
  ttl: z.number().optional().openapi({ description: 'TTL in seconds' }),
  prefix: z.string().optional().openapi({ description: 'Key prefix for list' }),
  limit: z.number().optional().openapi({ description: 'Max keys for list' }),
  cursor: z.string().optional().openapi({ description: 'Pagination cursor for list' }),
});

export const vectorizeBodySchema = z.object({
  action: z.enum(['upsert', 'insert', 'search', 'queryById', 'getByIds', 'delete', 'describe']).openapi({ description: 'Vectorize operation' }),
  vectors: z.array(z.object({
    id: z.string(),
    values: z.array(z.number()),
    metadata: z.record(z.string(), z.unknown()).optional(),
    namespace: z.string().optional(),
  })).optional(),
  vector: z.array(z.number()).optional(),
  vectorId: z.string().optional(),
  topK: z.number().optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
  ids: z.array(z.string()).optional(),
  namespace: z.string().optional(),
  returnValues: z.boolean().optional(),
  returnMetadata: z.union([z.boolean(), z.enum(['all', 'indexed', 'none'])]).optional(),
});

export const broadcastBodySchema = z.object({
  channel: z.string().openapi({ description: 'Database live channel name' }),
  event: z.string().openapi({ description: 'Event name' }),
  payload: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Event payload' }),
});

export const trackEventsBodySchema = z.object({
  events: z.array(z.record(z.string(), z.unknown())).openapi({ description: 'Events to track' }),
});

// ─── OpenAPIHono defaultHook ──────────────────────────────────────────────

/**
 * Shared defaultHook for all OpenAPIHono instances.
 * Returns Zod validation errors in the standard { code, message } format.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function zodDefaultHook(result: { success: boolean; error?: { issues?: Array<{ message: string }>; errors?: Array<{ message: string }> } }, c: any) {
  if (!result.success) {
    // Zod v4 uses `issues`, Zod v3 uses `errors`
    const items = (result.error as any)?.issues ?? (result.error as any)?.errors ?? [];
    return c.json({
      code: 400,
      message: items.map((e: any) => e.message).join(', '),
    }, 400);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
