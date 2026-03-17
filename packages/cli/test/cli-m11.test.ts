/**
 * Tests for CLI typegen command — FieldType → TypeScript type mapping,
 * interface generation, PascalCase naming, system fields.
 *
 * Note: upgrade, seed, migration, deploy tests have been moved to
 * dedicated test files (upgrade.test.ts, seed.test.ts, migration.test.ts, deploy.test.ts).
 */
import { describe, it, expect } from 'vitest';

import { generateTypes } from '../src/commands/typegen.js';

describe('typegen — Schema → TypeScript Type Generation', () => {
  it('maps FieldType to correct TS types', () => {
    const config = {
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                title: { type: 'string', required: true },
                content: { type: 'text' },
                views: { type: 'number' },
                published: { type: 'boolean' },
                publishedAt: { type: 'datetime' },
                metadata: { type: 'json' },
              },
            },
          },
        },
      },
    };

    const output = generateTypes(config);

    // Each FieldType → expected TS type
    expect(output).toContain('title: string;');
    expect(output).toContain('content?: string;');  // text → string, not required → optional
    expect(output).toContain('views?: number;');
    expect(output).toContain('published?: boolean;');
    expect(output).toContain('publishedAt?: string;');
    expect(output).toContain('metadata?: unknown;');
  });

  it('adds system fields (id, createdAt, updatedAt)', () => {
    const config = {
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
    };

    const output = generateTypes(config);

    expect(output).toContain('id: string;');
    expect(output).toContain('createdAt: string;');
    expect(output).toContain('updatedAt: string;');
  });

  it('marks required fields without ? and non-required with ?', () => {
    const config = {
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                requiredField: { type: 'string', required: true },
                optionalField: { type: 'string' },
                explicitOptional: { type: 'string', required: false },
              },
            },
          },
        },
      },
    };

    const output = generateTypes(config);

    expect(output).toContain('requiredField: string;');
    expect(output).not.toContain('requiredField?: string;');
    expect(output).toContain('optionalField?: string;');
    expect(output).toContain('explicitOptional?: string;');
  });

  it('generates PascalCase interface names from table names', () => {
    const config = {
      databases: {
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } } },
            userProfiles: { schema: { name: { type: 'string' } } },
          },
        },
      },
    };

    const output = generateTypes(config);

    expect(output).toContain('export interface Post {');
    expect(output).toContain('export interface UserProfile {');
  });

  it('adds ref comments for referenced fields', () => {
    const config = {
      databases: {
        shared: {
          tables: {
            comments: {
              schema: {
                postId: { type: 'string', required: true, references: 'posts' },
              },
            },
          },
        },
      },
    };

    const output = generateTypes(config);
    expect(output).toContain('references → posts');
  });

  it('generates EdgeBaseTables type map', () => {
    const config = {
      databases: {
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } } },
            comments: { schema: { body: { type: 'text' } } },
          },
        },
      },
    };

    const output = generateTypes(config);

    expect(output).toContain('export interface EdgeBaseTables {');
    expect(output).toContain('posts: Post;');
    expect(output).toContain('comments: Comment;');
  });

  it('handles empty tables gracefully', () => {
    const config = { databases: { shared: { tables: {} } } };
    const output = generateTypes(config);
    expect(output).toContain('No tables found');
  });

  it('skips deleted fields (false)', () => {
    const config = {
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                title: { type: 'string', required: true },
                legacyField: false as const,
              },
            },
          },
        },
      },
    };

    const output = generateTypes(config);
    expect(output).not.toContain('legacyField');
  });

  it('includes auto-generated header comment', () => {
    const config = {
      databases: {
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } } },
          },
        },
      },
    };

    const output = generateTypes(config);
    expect(output).toContain('Auto-generated by `npx edgebase typegen`');
    expect(output).toContain('Do not edit manually.');
  });
});
