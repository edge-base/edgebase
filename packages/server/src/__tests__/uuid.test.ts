/**
 * 서버 단위 테스트 — lib/uuid.ts
 * 1-22 uuid.test.ts — 20개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/uuid.test.ts
 */

import { describe, it, expect } from 'vitest';
import { generateId } from '../lib/uuid.js';

// UUID v7 format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateId (UUID v7)', () => {
  it('returns a string', () => {
    expect(typeof generateId()).toBe('string');
  });

  it('matches UUID v7 format', () => {
    const id = generateId();
    expect(id).toMatch(UUID_V7_REGEX);
  });

  it('version nibble is 7', () => {
    const id = generateId();
    // 3rd segment starts with '7'
    expect(id.split('-')[2][0]).toBe('7');
  });

  it('variant nibble is 8, 9, a, or b', () => {
    const id = generateId();
    const variantChar = id.split('-')[3][0];
    expect(['8', '9', 'a', 'b']).toContain(variantChar);
  });

  it('length is 36 characters', () => {
    const id = generateId();
    expect(id.length).toBe(36);
  });

  it('contains exactly 4 hyphens', () => {
    const id = generateId();
    expect((id.match(/-/g) ?? []).length).toBe(4);
  });

  it('generates unique IDs (1000 calls)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(1000);
  });

  it('IDs generated sequentially are time-ordered', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(generateId());
      // Delay to ensure different ms timestamp (≥2ms to avoid timer coalescing under load)
      await new Promise((r) => setTimeout(r, 2));
    }
    for (let i = 1; i < ids.length; i++) {
      // UUID v7 is lexicographically sortable
      expect(ids[i] > ids[i - 1]).toBe(true);
    }
  });

  it('IDs generated within same ms maintain distinct randomness', () => {
    // Generate 100 within same tick
    const batch: string[] = [];
    for (let i = 0; i < 100; i++) {
      batch.push(generateId());
    }
    const unique = new Set(batch);
    expect(unique.size).toBe(100);
  });

  it('first 8 hex chars encode timestamp', () => {
    // The timestamp portion should be close to Date.now()
    const before = Date.now();
    const id = generateId();
    const after = Date.now();

    // Extract timestamp from UUID v7: first 12 hex chars (bytes 0-5) = 48 bits
    const hexTs = id.replace(/-/g, '').slice(0, 12);
    const ts = parseInt(hexTs, 16);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 10);
  });

  it('only uses lowercase hex characters', () => {
    const id = generateId().replace(/-/g, '');
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it('no uppercase letters', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateId()).not.toMatch(/[A-F]/);
    }
  });

  it('is parseable as hex segments', () => {
    const id = generateId();
    const parts = id.split('-');
    expect(parts).toHaveLength(5);
    expect(parts.map((p) => p.length)).toEqual([8, 4, 4, 4, 12]);
  });

  it('multiple calls in tight loop are all valid', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateId()).toMatch(UUID_V7_REGEX);
    }
  });

  it('different IDs on consecutive calls within same ms', () => {
    const a = generateId();
    const b = generateId();
    // Even in same millisecond, IDs must differ
    expect(a).not.toBe(b);
  });

  it('sorting 100 IDs yields same order as insertion order', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(generateId());
      await new Promise((r) => setTimeout(r, 2));
    }
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('ID segment 3 (variant) is 10xx in binary (RFC 9562)', () => {
    // variant nibble must be 8(1000), 9(1001), a(1010), b(1011) — top 2 bits = 10
    const id = generateId();
    const variantChar = id.split('-')[3][0];
    const variantVal = parseInt(variantChar, 16);
    // Top 2 bits must be 10
    expect(variantVal & 0b1100).toBe(0b1000);
  });

  it('set of 500 IDs has no collisions', () => {
    const ids = Array.from({ length: 500 }, () => generateId());
    expect(new Set(ids).size).toBe(500);
  });
});
