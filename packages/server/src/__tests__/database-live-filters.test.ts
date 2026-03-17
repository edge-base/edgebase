import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
}));

describe('database-live filter helpers', () => {
  it('normalizes tuple filters for contains-any and not in operators', async () => {
    const { normalizeDatabaseLiveFilterPayload } = await import('../durable-objects/database-live-do.js');

    const normalized = normalizeDatabaseLiveFilterPayload([
      ['tags', 'contains-any', ['hot', 'featured']],
      ['status', 'not in', ['archived']],
    ], 'Filters');

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      throw new Error(normalized.message);
    }
    expect(normalized.value).toEqual([
      ['tags', 'contains-any', ['hot', 'featured']],
      ['status', 'not in', ['archived']],
    ]);
  });

  it('evaluates AND filters together with OR-group semantics', async () => {
    const { evaluateDatabaseLiveFilters } = await import('../durable-objects/database-live-do.js');

    expect(evaluateDatabaseLiveFilters(
      {
        score: 12,
        status: 'published',
        tags: ['cold'],
        title: 'Hello World',
      },
      [
        ['score', '>', 10],
        ['status', 'not in', ['draft', 'archived']],
      ],
      [
        ['tags', 'contains-any', ['hot']],
        ['title', 'contains', 'World'],
      ],
    )).toBe(true);

    expect(evaluateDatabaseLiveFilters(
      {
        score: 12,
        status: 'published',
        tags: ['cold'],
        title: 'Hello there',
      },
      [
        ['score', '>', 10],
        ['status', 'not in', ['draft', 'archived']],
      ],
      [
        ['tags', 'contains-any', ['hot']],
        ['title', 'contains', 'World'],
      ],
    )).toBe(false);
  });
});
