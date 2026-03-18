import { describe, expect, it } from 'vitest';
import type { TableConfig } from '@edge-base/shared';
import {
  escapePgIdentifier,
  filterToPgSchemaColumns,
  preparePgInsertData,
  preparePgUpdateData,
  serializePgJsonFields,
  stripInternalPgFields,
} from '../lib/postgres-table-utils.js';

const tableConfig: TableConfig = {
  schema: {
    title: { type: 'string', required: true },
    status: { type: 'string', default: 'draft' },
    metadata: { type: 'json' },
  },
};

describe('postgres table utils', () => {
  it('escapePgIdentifier quotes identifiers and escapes embedded quotes', () => {
    expect(escapePgIdentifier('posts')).toBe('"posts"');
    expect(escapePgIdentifier('weird"name')).toBe('"weird""name"');
  });

  it('serializePgJsonFields stringifies json schema fields without double-stringifying existing strings', () => {
    const data = {
      title: 'hello',
      metadata: { tags: ['a'] },
      rawJson: '{"ready":true}',
    };

    serializePgJsonFields(data, {
      title: { type: 'string' },
      metadata: { type: 'json' },
      rawJson: { type: 'json' },
    });

    expect(data.title).toBe('hello');
    expect(data.metadata).toBe(JSON.stringify({ tags: ['a'] }));
    expect(data.rawJson).toBe('{"ready":true}');
  });

  it('filterToPgSchemaColumns keeps only declared schema fields', () => {
    expect(
      filterToPgSchemaColumns(
        {
          title: 'hello',
          metadata: { ok: true },
          ignored: 'nope',
        },
        {
          title: { type: 'string' },
          metadata: { type: 'json' },
        },
      ),
    ).toEqual({
      title: 'hello',
      metadata: { ok: true },
    });
  });

  it('preparePgInsertData applies auto fields, defaults, schema filtering, and JSON serialization', () => {
    const { data } = preparePgInsertData(
      {
        title: 'hello',
        metadata: { tags: ['a'] },
        ignored: 'nope',
      },
      tableConfig,
    );

    expect(typeof data.id).toBe('string');
    expect(typeof data.createdAt).toBe('string');
    expect(typeof data.updatedAt).toBe('string');
    expect(data.status).toBe('draft');
    expect(data.metadata).toBe(JSON.stringify({ tags: ['a'] }));
    expect(data.ignored).toBeUndefined();
  });

  it('preparePgUpdateData strips immutable fields and serializes JSON', () => {
    const { data } = preparePgUpdateData(
      {
        id: 'row-1',
        createdAt: 'yesterday',
        title: 'updated',
        metadata: { ok: true },
        ignored: 'nope',
      },
      tableConfig,
    );

    expect(data.id).toBeUndefined();
    expect(data.createdAt).toBeUndefined();
    expect(data.title).toBe('updated');
    expect(data.metadata).toBe(JSON.stringify({ ok: true }));
    expect(typeof data.updatedAt).toBe('string');
    expect(data.ignored).toBeUndefined();
  });

  it('stripInternalPgFields removes internal postgres helper columns', () => {
    expect(stripInternalPgFields({ id: 'row-1', _fts: 'vector', title: 'hello' })).toEqual({
      id: 'row-1',
      title: 'hello',
    });
  });
});
