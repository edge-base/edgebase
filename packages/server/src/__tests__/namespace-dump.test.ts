import { describe, expect, it } from 'vitest';
import { defineConfig } from '@edgebase-fun/shared';
import { dumpNamespaceTables } from '../lib/namespace-dump.js';

describe('namespace dump helpers', () => {
  it('throws when the requested namespace is missing from config', async () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                title: { type: 'string' },
              },
            },
          },
        },
      },
    });

    await expect(
      dumpNamespaceTables({} as never, config, 'missing'),
    ).rejects.toMatchObject({
      code: 404,
      message: "Namespace 'missing' not found in config.",
    });
  });
});
