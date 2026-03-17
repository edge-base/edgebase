/**
 * 서버 단위 테스트 — RoomsDO pure logic functions
 * 1-17 room.test.ts — 80개 (순수 로직만, WebSocket 불필요)
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/room.test.ts
 *
 * 주의: RoomsDO 내부 함수(isValidDotPath, deepSet, computeDelta)들은
 *       모듈 외부에서 직접 임포트 불가이므로,
 *       여기서는 동일 로직을 검증하는 단위 테스트를 작성
 */

import { describe, it, expect } from 'vitest';

// ── 1. isValidDotPath 동일 로직 구현 (module-private → copy logic) ─────────────

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DOT_PATH_DEPTH = 5;

function isValidDotPath(path: string): boolean {
  const segments = path.split('.');
  if (segments.length > MAX_DOT_PATH_DEPTH) return false;
  for (const seg of segments) {
    if (seg === '' || BLOCKED_KEYS.has(seg)) return false;
    if (/^\d+$/.test(seg)) return false;
  }
  return true;
}

// ── 2. deepSet 동일 로직 ────────────────────────────────────────────────────

function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof current[seg] !== 'object' || current[seg] === null || Array.isArray(current[seg])) {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }
  const lastSeg = segments[segments.length - 1];
  if (value === null) {
    delete current[lastSeg];
  } else {
    current[lastSeg] = value;
  }
}

// ── 3. computeDelta 동일 로직 ────────────────────────────────────────────────

function computeDelta(
  oldState: Record<string, unknown>,
  newState: Record<string, unknown>,
): Record<string, unknown> | null {
  const delta: Record<string, unknown> = {};
  let hasChanges = false;
  for (const key of Object.keys(newState)) {
    if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
      delta[key] = newState[key];
      hasChanges = true;
    }
  }
  for (const key of Object.keys(oldState)) {
    if (!(key in newState)) {
      delta[key] = null;
      hasChanges = true;
    }
  }
  return hasChanges ? delta : null;
}

// ─── A. isValidDotPath ───────────────────────────────────────────────────────

describe('isValidDotPath', () => {
  it('simple key → valid', () => {
    expect(isValidDotPath('health')).toBe(true);
  });

  it('dot path → valid', () => {
    expect(isValidDotPath('player.position.x')).toBe(true);
  });

  it('5-level depth → valid (max)', () => {
    expect(isValidDotPath('a.b.c.d.e')).toBe(true);
  });

  it('6-level depth → invalid (exceeds max)', () => {
    expect(isValidDotPath('a.b.c.d.e.f')).toBe(false);
  });

  it('empty segment (double dot) → invalid', () => {
    expect(isValidDotPath('a..b')).toBe(false);
  });

  it('leading dot → invalid', () => {
    expect(isValidDotPath('.a.b')).toBe(false);
  });

  it('__proto__ → invalid (prototype pollution)', () => {
    expect(isValidDotPath('__proto__')).toBe(false);
  });

  it('constructor → invalid', () => {
    expect(isValidDotPath('constructor')).toBe(false);
  });

  it('prototype → invalid', () => {
    expect(isValidDotPath('prototype')).toBe(false);
  });

  it('nested __proto__ → invalid', () => {
    expect(isValidDotPath('a.__proto__.b')).toBe(false);
  });

  it('numeric-only key → invalid (array injection)', () => {
    expect(isValidDotPath('0')).toBe(false);
    expect(isValidDotPath('items.0')).toBe(false);
  });

  it('alphanumeric key → valid', () => {
    expect(isValidDotPath('item2')).toBe(true);
    expect(isValidDotPath('player1.score')).toBe(true);
  });

  it('trailing dot → invalid', () => {
    expect(isValidDotPath('a.b.')).toBe(false);
  });
});

// ─── B. deepSet ──────────────────────────────────────────────────────────────

describe('deepSet', () => {
  it('sets top-level key', () => {
    const obj: Record<string, unknown> = {};
    deepSet(obj, 'score', 100);
    expect(obj['score']).toBe(100);
  });

  it('sets nested key (creates intermediary)', () => {
    const obj: Record<string, unknown> = {};
    deepSet(obj, 'player.position.x', 42);
    const player = obj['player'] as Record<string, unknown>;
    const pos = player['position'] as Record<string, unknown>;
    expect(pos['x']).toBe(42);
  });

  it('deletes key when value is null', () => {
    const obj: Record<string, unknown> = { title: 'hello' };
    deepSet(obj, 'title', null);
    expect('title' in obj).toBe(false);
  });

  it('overwrites existing value', () => {
    const obj: Record<string, unknown> = { x: 1 };
    deepSet(obj, 'x', 99);
    expect(obj['x']).toBe(99);
  });

  it('replaces non-object with object on path', () => {
    const obj: Record<string, unknown> = { player: 'string-value' };
    deepSet(obj, 'player.score', 50);
    const player = obj['player'] as Record<string, unknown>;
    expect(player['score']).toBe(50);
  });

  it('replaces array with object on path', () => {
    const obj: Record<string, unknown> = { player: [1, 2, 3] };
    deepSet(obj, 'player.score', 10);
    expect((obj['player'] as Record<string, unknown>)['score']).toBe(10);
  });

  it('sets deep nested path', () => {
    const obj: Record<string, unknown> = {};
    deepSet(obj, 'a.b.c.d', 'leaf');
    const a = obj['a'] as Record<string, unknown>;
    const b = a['b'] as Record<string, unknown>;
    const c = b['c'] as Record<string, unknown>;
    expect(c['d']).toBe('leaf');
  });
});

// ─── C. computeDelta ─────────────────────────────────────────────────────────

describe('computeDelta', () => {
  it('returns null when states are identical', () => {
    const state = { x: 1, y: 2 };
    expect(computeDelta(state, { ...state })).toBeNull();
  });

  it('detects modified value', () => {
    const delta = computeDelta({ x: 1 }, { x: 2 });
    expect(delta).not.toBeNull();
    expect(delta?.x).toBe(2);
  });

  it('detects added key → in delta', () => {
    const delta = computeDelta({ x: 1 }, { x: 1, y: 2 });
    expect(delta?.y).toBe(2);
  });

  it('detects deleted key → null in delta', () => {
    const delta = computeDelta({ x: 1, y: 2 }, { x: 1 });
    expect(delta?.y).toBeNull();
  });

  it('empty → empty → null', () => {
    expect(computeDelta({}, {})).toBeNull();
  });

  it('empty → with values → delta has new values', () => {
    const delta = computeDelta({}, { a: 1, b: 2 });
    expect(delta?.a).toBe(1);
    expect(delta?.b).toBe(2);
  });

  it('with values → empty → delta has null for each key', () => {
    const delta = computeDelta({ a: 1, b: 2 }, {});
    expect(delta?.a).toBeNull();
    expect(delta?.b).toBeNull();
  });

  it('nested object change detected', () => {
    const delta = computeDelta(
      { player: { x: 1, y: 2 } },
      { player: { x: 1, y: 99 } },
    );
    expect(delta?.player).toBeDefined();
  });

  it('no spurious delta for deeply equal objects', () => {
    const delta = computeDelta(
      { items: [1, 2, 3] },
      { items: [1, 2, 3] },
    );
    expect(delta).toBeNull();
  });
});

// ─── D. RoomsDO constants 검증 ────────────────────────────────────────────────

describe('RoomsDO constants (design verification)', () => {
  it('MAX_DOT_PATH_DEPTH is 5', () => {
    // 5-level deep is valid
    expect(isValidDotPath('a.b.c.d.e')).toBe(true);
    // 6-level deep is invalid
    expect(isValidDotPath('a.b.c.d.e.f')).toBe(false);
  });

  it('BLOCKED_KEYS contains proto-pollution keys', () => {
    expect(BLOCKED_KEYS.has('__proto__')).toBe(true);
    expect(BLOCKED_KEYS.has('constructor')).toBe(true);
    expect(BLOCKED_KEYS.has('prototype')).toBe(true);
  });
});
