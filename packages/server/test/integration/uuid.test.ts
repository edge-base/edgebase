/**
 * uuid.test.ts — 20개
 *
 * 테스트 대상: src/lib/uuid.ts → generateId() (UUID v7)
 *
 * UUID v7 특성:
 *   - 시간순 정렬 가능 (time-ordered)
 *   - 36자 hyphenated string
 *   - 형식: 8-4-4-4-12 (version 7: 7xxx)
 *   - 고유성: 중복 없음
 */
import { describe, it, expect } from 'vitest';
import { generateId } from '../../src/lib/uuid.js';

// ─── 1. UUID 형식 검증 ────────────────────────────────────────────────────────

describe('1-22 uuid — generateId 형식', () => {
  it('36자 문자열 반환', () => {
    expect(generateId().length).toBe(36);
  });

  it('hyphenated 형식: 8-4-4-4-12', () => {
    const id = generateId();
    const parts = id.split('-');
    expect(parts.length).toBe(5);
    expect(parts[0].length).toBe(8);
    expect(parts[1].length).toBe(4);
    expect(parts[2].length).toBe(4);
    expect(parts[3].length).toBe(4);
    expect(parts[4].length).toBe(12);
  });

  it('소문자 hex 문자만 포함', () => {
    const id = generateId();
    expect(/^[0-9a-f-]+$/.test(id)).toBe(true);
  });

  it('version 7 표시: 3번째 그룹이 7xxx', () => {
    const id = generateId();
    const thirdGroup = id.split('-')[2];
    expect(thirdGroup.startsWith('7')).toBe(true);
  });

  it('UUID 4번째 그룹 variant bits 확인 (RFC4122: 8, 9, a, b)', () => {
    const id = generateId();
    const fourthGroup = id.split('-')[3];
    const firstNibble = parseInt(fourthGroup[0], 16);
    expect(firstNibble >= 8 && firstNibble <= 11).toBe(true);
  });
});

// ─── 2. 고유성 (Uniqueness) ──────────────────────────────────────────────────

describe('1-22 uuid — 고유성', () => {
  it('1000개 생성 → 중복 없음', () => {
    const ids = Array.from({ length: 1000 }, () => generateId());
    const unique = new Set(ids);
    expect(unique.size).toBe(1000);
  });

  it('연속 호출 → 다른 값', () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });
});

// ─── 3. 시간순 정렬성 ────────────────────────────────────────────────────────

describe('1-22 uuid — 시간순 정렬성', () => {
  it('생성 순서대로 정렬 가능', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(generateId());
      await new Promise(r => setTimeout(r, 2)); // 2ms: Workers 타이머 부정확으로 1ms는 같은 밀리초 가능
    }
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('첫 8자는 타임스탬프(hex) — 단조 증가', async () => {
    const id1 = generateId();
    await new Promise(r => setTimeout(r, 2));
    const id2 = generateId();
    const ts1 = parseInt(id1.slice(0, 8), 16);
    const ts2 = parseInt(id2.slice(0, 8), 16);
    expect(ts2).toBeGreaterThanOrEqual(ts1);
  });
});

// ─── 4. API에서 사용하는 generateId ─────────────────────────────────────────

describe('1-22 uuid — API 통합', () => {
  it('posts 생성 → id 필드가 UUID v7 형식', async () => {
    const res = await (globalThis as any).SELF.fetch('http://localhost/api/db/shared/tables/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': 'test-service-key-for-admin',
      },
      body: JSON.stringify({ title: 'UUID Format Test' }),
    });
    const data = await res.json() as any;
    expect([200, 201].includes(res.status)).toBe(true);
    if (data?.id) {
      expect(data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      // Cleanup
      await (globalThis as any).SELF.fetch(`http://localhost/api/db/shared/tables/posts/${data.id}`, {
        method: 'DELETE',
        headers: { 'X-EdgeBase-Service-Key': 'test-service-key-for-admin' },
      });
    }
  });

  it('생성된 id로 GET → 일치', async () => {
    const createRes = await (globalThis as any).SELF.fetch('http://localhost/api/db/shared/tables/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': 'test-service-key-for-admin',
      },
      body: JSON.stringify({ title: 'UUID Get Test' }),
    });
    const created = await createRes.json() as any;
    if (created?.id) {
      const getRes = await (globalThis as any).SELF.fetch(
        `http://localhost/api/db/shared/tables/posts/${created.id}`,
        { headers: { 'X-EdgeBase-Service-Key': 'test-service-key-for-admin' } }
      );
      const got = await getRes.json() as any;
      expect(got.id).toBe(created.id);

      await (globalThis as any).SELF.fetch(`http://localhost/api/db/shared/tables/posts/${created.id}`, {
        method: 'DELETE',
        headers: { 'X-EdgeBase-Service-Key': 'test-service-key-for-admin' },
      });
    }
  });
});

// ─── 5. UUID v7 형식 확장 ───────────────────────────────────────────────────

describe('1-22 uuid — v7 형식 확장', () => {
  it('UUID v7 정규식 전체 매칭', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('10개 연속 생성 모두 v7 형식', () => {
    for (let i = 0; i < 10; i++) {
      const id = generateId();
      expect(id.split('-')[2][0]).toBe('7');
      const variantChar = parseInt(id.split('-')[3][0], 16);
      expect(variantChar >= 8 && variantChar <= 11).toBe(true);
    }
  });

  it('UUID는 정확히 32자의 hex + 4개의 하이픈 = 36자', () => {
    const id = generateId();
    const hexOnly = id.replace(/-/g, '');
    expect(hexOnly.length).toBe(32);
    expect(id.split('-').length).toBe(5);
  });
});

// ─── 6. 시간순 정렬성 확장 ──────────────────────────────────────────────────

describe('1-22 uuid — 시간순 정렬성 확장', () => {
  it('2ms 간격 순차 생성 → string sort 유지', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(generateId());
      await new Promise(r => setTimeout(r, 2)); // 2ms: Workers 타이머 부정확으로 1ms는 같은 밀리초 가능
    }
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('동일 시점 대량 생성도 각각 고유', () => {
    const ids = Array.from({ length: 100 }, () => generateId());
    const unique = new Set(ids);
    expect(unique.size).toBe(100);
  });

  it('첫 6바이트(48비트)는 타임스탬프 — 현재 시간 범위 내', () => {
    const before = Date.now();
    const id = generateId();
    const after = Date.now();

    // Extract 48-bit timestamp from first 12 hex chars
    const hex = id.replace(/-/g, '').slice(0, 12);
    const ts = parseInt(hex, 16);

    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });
});

// ─── 7. 고유성 확장 ────────────────────────────────────────────────────────

describe('1-22 uuid — 고유성 확장', () => {
  it('10000개 생성 → 중복 없음', () => {
    const ids = Array.from({ length: 10000 }, () => generateId());
    const unique = new Set(ids);
    expect(unique.size).toBe(10000);
  });

  it('병렬-like 고속 생성 (for loop) → 모두 고유', () => {
    const ids: string[] = [];
    for (let i = 0; i < 500; i++) ids.push(generateId());
    const unique = new Set(ids);
    expect(unique.size).toBe(500);
  });
});
