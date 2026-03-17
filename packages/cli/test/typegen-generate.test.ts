/**
 * Tests for typegen.ts — generateTypes() pure function and internal helpers.
 *
 * Covers: type generation from ParsedConfig, PascalCase conversion,
 * system fields, field types, references/enum comments.
 *
 * 실행: cd packages/cli && npx vitest run test/typegen-generate.test.ts
 */

import { describe, it, expect } from 'vitest';
import { generateTypes } from '../src/commands/typegen.js';

// ─── Helper: strip the auto-generated header (first 6 lines) ───

function stripHeader(output: string): string {
  const lines = output.split('\n');
  // Header is 6 lines (5 comment lines + 1 blank), skip them
  return lines.slice(6).join('\n');
}

// ======================================================================
// 1. databases block → correct interfaces with system fields
// ======================================================================

describe('databases block — interface generation', () => {
  it('generates correct interface with system fields (id, createdAt, updatedAt)', () => {
    const output = generateTypes({
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                title: { type: 'string', required: true },
              },
            },
          },
        },
      },
    });

    const body = stripHeader(output);

    // Interface declaration
    expect(body).toContain('/** Table: posts */');
    expect(body).toContain('export interface Post {');

    // System fields
    expect(body).toContain('  /** System-generated unique ID */');
    expect(body).toContain('  id: string;');
    expect(body).toContain('  /** ISO 8601 creation timestamp */');
    expect(body).toContain('  createdAt: string;');
    expect(body).toContain('  /** ISO 8601 last-update timestamp */');
    expect(body).toContain('  updatedAt: string;');

    // User field
    expect(body).toContain('  title: string;');
  });
});

// ======================================================================
// 2. Empty config → "No tables found" comment
// ======================================================================

describe('empty config', () => {
  it('returns "No tables found" comment for empty databases', () => {
    const output = generateTypes({ databases: {} });
    expect(output).toContain('// No tables found in config.');
    // Should NOT contain any interface or EdgeBaseTables
    expect(output).not.toContain('export interface');
    expect(output).not.toContain('EdgeBaseTables');
  });

  it('returns "No tables found" comment for completely empty config', () => {
    const output = generateTypes({});
    expect(output).toContain('// No tables found in config.');
  });

  it('returns "No tables found" for databases with empty tables', () => {
    const output = generateTypes({
      databases: {
        shared: { tables: {} },
      },
    });
    expect(output).toContain('// No tables found in config.');
  });
});

// ======================================================================
// 3. PascalCase conversion (toPascalCase internal)
// ======================================================================

describe('PascalCase conversion via generateTypes output', () => {
  it('converts plural to singular PascalCase: users → User', () => {
    const output = generateTypes({
      databases: { shared: { tables: { users: { schema: {} } } } },
    });
    expect(output).toContain('export interface User {');
  });

  it('converts snake_case plural: blog_posts → BlogPost', () => {
    const output = generateTypes({
      databases: { shared: { tables: { blog_posts: { schema: {} } } } },
    });
    expect(output).toContain('export interface BlogPost {');
  });

  it('converts kebab-style: order-items → OrderItem', () => {
    const output = generateTypes({
      databases: { shared: { tables: { 'order-items': { schema: {} } } } },
    });
    expect(output).toContain('export interface OrderItem {');
  });

  it('single non-plural word: profile → Profile', () => {
    const output = generateTypes({
      databases: { shared: { tables: { profile: { schema: {} } } } },
    });
    expect(output).toContain('export interface Profile {');
  });

  it('preserves singular words like status → Status', () => {
    const output = generateTypes({
      databases: { shared: { tables: { status: { schema: {} } } } },
    });
    expect(output).toContain('export interface Status {');
    expect(output).not.toContain('export interface Statu {');
  });

  it('supports table names with path separators', () => {
    const output = generateTypes({
      databases: { shared: { tables: { 'plugin-analytics/events': { schema: {} } } } },
    });
    expect(output).toContain('export interface PluginAnalyticsEvent {');
    expect(output).toContain('"plugin-analytics/events": PluginAnalyticsEvent;');
  });
});

// ======================================================================
// 5. Required vs optional fields
// ======================================================================

describe('required and optional fields', () => {
  it('required fields have no "?", optional fields have "?"', () => {
    const output = generateTypes({
      databases: {
        shared: {
          tables: {
            items: {
              schema: {
                name: { type: 'string', required: true },
                description: { type: 'string' },
                count: { type: 'number', required: true },
                notes: { type: 'text' },
              },
            },
          },
        },
      },
    });

    // Required — no "?"
    expect(output).toContain('  name: string;');
    expect(output).toContain('  count: number;');

    // Optional — has "?"
    expect(output).toContain('  description?: string;');
    expect(output).toContain('  notes?: string;');
  });

  it('quotes invalid field identifiers instead of emitting broken TypeScript', () => {
    const output = generateTypes({
      databases: {
        shared: {
          tables: {
            profiles: {
              schema: {
                'first-name': { type: 'string', required: true },
                '2fa_enabled': { type: 'boolean' },
              },
            },
          },
        },
      },
    });

    expect(output).toContain('  "first-name": string;');
    expect(output).toContain('  "2fa_enabled"?: boolean;');
  });
});

// ======================================================================
// 6. references fields → "// references → tableName" comment
// ======================================================================

describe('references fields', () => {
  it('generates "// references → tableName" comment for references fields', () => {
    const output = generateTypes({
      databases: {
        shared: {
          tables: {
            comments: {
              schema: {
                postId: { type: 'string', required: true, references: 'posts' },
                userId: { type: 'string', references: 'users' },
              },
            },
          },
        },
      },
    });

    expect(output).toContain('  postId: string; // references → posts');
    expect(output).toContain('  userId?: string; // references → users');
  });
});

// ======================================================================
// 7. enum fields → "// enum: val1 | val2" comment
// ======================================================================

describe('enum fields', () => {
  it('generates "// enum: val1 | val2" comment for enum fields', () => {
    const output = generateTypes({
      databases: {
        shared: {
          tables: {
            tickets: {
              schema: {
                status: { type: 'string', required: true, enum: ['open', 'closed', 'pending'] },
                priority: { type: 'string', enum: ['low', 'medium', 'high'] },
              },
            },
          },
        },
      },
    });

    expect(output).toContain('  status: string; // enum: open | closed | pending');
    expect(output).toContain('  priority?: string; // enum: low | medium | high');
  });
});

// ======================================================================
// 8. false fields (deleted) are skipped
// ======================================================================

describe('false fields (deleted)', () => {
  it('skips fields marked as false', () => {
    const output = generateTypes({
      databases: {
        shared: {
          tables: {
            products: {
              schema: {
                name: { type: 'string', required: true },
                legacyCode: false,
                deletedField: false,
                price: { type: 'number' },
              },
            },
          },
        },
      },
    });

    expect(output).toContain('  name: string;');
    expect(output).toContain('  price?: number;');
    expect(output).not.toContain('legacyCode');
    expect(output).not.toContain('deletedField');
  });
});

// ======================================================================
// 9. Multiple tables → EdgeBaseTables type map
// ======================================================================

describe('EdgeBaseTables type map', () => {
  it('generates EdgeBaseTables with all table → type mappings', () => {
    const output = generateTypes({
      databases: {
        shared: {
          tables: {
            users: { schema: { email: { type: 'string', required: true } } },
            posts: { schema: { title: { type: 'string', required: true } } },
            comments: { schema: { body: { type: 'text' } } },
          },
        },
      },
    });

    const body = stripHeader(output);

    // All three interfaces should exist
    expect(body).toContain('export interface User {');
    expect(body).toContain('export interface Post {');
    expect(body).toContain('export interface Comment {');

    // EdgeBaseTables type map
    expect(body).toContain('/** Table name → Type mapping */');
    expect(body).toContain('export interface EdgeBaseTables {');
    expect(body).toContain('  users: User;');
    expect(body).toContain('  posts: Post;');
    expect(body).toContain('  comments: Comment;');
  });

  it('includes tables from multiple database blocks', () => {
    const output = generateTypes({
      databases: {
        shared: {
          tables: {
            users: { schema: { email: { type: 'string', required: true } } },
          },
        },
        workspace: {
          tables: {
            documents: { schema: { content: { type: 'text' } } },
          },
        },
      },
    });

    const body = stripHeader(output);
    expect(body).toContain('export interface User {');
    expect(body).toContain('export interface Document {');
    expect(body).toContain('  users: User;');
    expect(body).toContain('  documents: Document;');
  });
});

// ======================================================================
// 10. Field type mapping (string, number, boolean, datetime, json, text)
// ======================================================================

describe('field type mapping', () => {
  it('maps all field types correctly to TypeScript types', () => {
    const output = generateTypes({
      databases: {
        shared: {
          tables: {
            test_records: {
              schema: {
                nameField: { type: 'string', required: true },
                textField: { type: 'text', required: true },
                countField: { type: 'number', required: true },
                activeField: { type: 'boolean', required: true },
                dateField: { type: 'datetime', required: true },
                metaField: { type: 'json', required: true },
              },
            },
          },
        },
      },
    });

    // string → string
    expect(output).toContain('  nameField: string;');
    // text → string
    expect(output).toContain('  textField: string;');
    // number → number
    expect(output).toContain('  countField: number;');
    // boolean → boolean
    expect(output).toContain('  activeField: boolean;');
    // datetime → string
    expect(output).toContain('  dateField: string;');
    // json → unknown
    expect(output).toContain('  metaField: unknown;');
  });

  it('maps unknown field type to "unknown"', () => {
    const output = generateTypes({
      databases: {
        shared: {
          tables: {
            exotic: {
              schema: {
                weirdField: { type: 'somethingNew', required: true },
              },
            },
          },
        },
      },
    });

    expect(output).toContain('  weirdField: unknown;');
  });
});
