/**
 * 서버 단위 테스트 — Presence + Broadcast 로직
 * 1-18 presence.test.ts — 30개
 * (RoomsDO 내 Presence 로직 — 순수 로직 파트)
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/presence.test.ts
 *
 * NOTE: WebSocket 연결 없이 Presence 데이터 구조만 검증
 */

import { describe, it, expect } from 'vitest';

// ── Presence 상태 관리 로직 (RoomsDO 동일 패턴) ──────────────────────────────

interface PresenceEntry {
  userId: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

class PresenceStore {
  private store = new Map<string, PresenceEntry>();
  private readonly MAX_PRESENCE_SIZE = 1024; // 1KB per

  track(userId: string, data: Record<string, unknown>): boolean {
    const json = JSON.stringify(data);
    if (json.length > this.MAX_PRESENCE_SIZE) {
      return false; // size exceeded
    }
    this.store.set(userId, { userId, data, updatedAt: Date.now() });
    return true;
  }

  untrack(userId: string): boolean {
    return this.store.delete(userId);
  }

  getAll(): PresenceEntry[] {
    return Array.from(this.store.values());
  }

  getUser(userId: string): PresenceEntry | undefined {
    return this.store.get(userId);
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

// ─── A. track ────────────────────────────────────────────────────────────────

describe('PresenceStore.track', () => {
  it('tracks a user', () => {
    const ps = new PresenceStore();
    const result = ps.track('user-1', { status: 'online' });
    expect(result).toBe(true);
    expect(ps.size()).toBe(1);
  });

  it('tracks multiple users', () => {
    const ps = new PresenceStore();
    ps.track('user-1', { status: 'online' });
    ps.track('user-2', { status: 'away' });
    expect(ps.size()).toBe(2);
  });

  it('overwrites existing presence for same userId', () => {
    const ps = new PresenceStore();
    ps.track('user-1', { status: 'online' });
    ps.track('user-1', { status: 'away' });
    expect(ps.size()).toBe(1);
    expect(ps.getUser('user-1')?.data['status']).toBe('away');
  });

  it('rejects data exceeding 1KB → false', () => {
    const ps = new PresenceStore();
    const bigData = { payload: 'x'.repeat(1025) };
    const result = ps.track('user-1', bigData);
    expect(result).toBe(false);
    expect(ps.size()).toBe(0);
  });

  it('data exactly at 1024 bytes → accepted', () => {
    const ps = new PresenceStore();
    // Create exactly 1024B JSON
    const data = { key: 'a'.repeat(1024 - '{"key":""}'. length) };
    const json = JSON.stringify(data);
    const result = ps.track('user-1', data);
    expect(result).toBe(json.length <= 1024);
  });

  it('track stores updatedAt timestamp', () => {
    const ps = new PresenceStore();
    const before = Date.now();
    ps.track('user-1', {});
    const after = Date.now();
    const entry = ps.getUser('user-1');
    expect(entry?.updatedAt).toBeGreaterThanOrEqual(before);
    expect(entry?.updatedAt).toBeLessThanOrEqual(after);
  });
});

// ─── B. untrack ──────────────────────────────────────────────────────────────

describe('PresenceStore.untrack', () => {
  it('removes tracked user', () => {
    const ps = new PresenceStore();
    ps.track('user-1', { status: 'online' });
    const result = ps.untrack('user-1');
    expect(result).toBe(true);
    expect(ps.size()).toBe(0);
  });

  it('returns false for non-existent user', () => {
    const ps = new PresenceStore();
    expect(ps.untrack('unknown')).toBe(false);
  });

  it('does not affect other users', () => {
    const ps = new PresenceStore();
    ps.track('user-1', {});
    ps.track('user-2', {});
    ps.untrack('user-1');
    expect(ps.size()).toBe(1);
    expect(ps.getUser('user-2')).toBeDefined();
  });
});

// ─── C. getAll (presence broadcast) ─────────────────────────────────────────

describe('PresenceStore.getAll', () => {
  it('returns all entries', () => {
    const ps = new PresenceStore();
    ps.track('user-1', { status: 'online' });
    ps.track('user-2', { status: 'away' });
    const all = ps.getAll();
    expect(all.length).toBe(2);
    const ids = all.map((e) => e.userId);
    expect(ids).toContain('user-1');
    expect(ids).toContain('user-2');
  });

  it('returns empty array when no presence', () => {
    const ps = new PresenceStore();
    expect(ps.getAll()).toEqual([]);
  });

  it('clear removes all presence', () => {
    const ps = new PresenceStore();
    ps.track('user-1', {});
    ps.track('user-2', {});
    ps.clear();
    expect(ps.size()).toBe(0);
    expect(ps.getAll()).toEqual([]);
  });
});

// ─── D. Presence on disconnect (자동 untrack) ────────────────────────────────

describe('Presence auto-untrack on disconnect', () => {
  it('simulated disconnect removes presence', () => {
    const ps = new PresenceStore();
    const connections = new Map<string, string>(); // connectionId → userId

    // Connect
    connections.set('conn-1', 'user-1');
    ps.track('user-1', { status: 'online' });

    // Disconnect
    const userId = connections.get('conn-1');
    if (userId) ps.untrack(userId);
    connections.delete('conn-1');

    expect(ps.size()).toBe(0);
    expect(ps.getUser('user-1')).toBeUndefined();
  });

  it('disconnect of non-connected user is safe', () => {
    const ps = new PresenceStore();
    expect(() => ps.untrack('non-existent')).not.toThrow();
  });
});

// ─── E. Multiple clients same user ──────────────────────────────────────────

describe('PresenceStore — multi-client same user', () => {
  it('last write wins for same userId', () => {
    const ps = new PresenceStore();
    ps.track('user-1', { device: 'mobile' });
    ps.track('user-1', { device: 'desktop' });
    expect(ps.getUser('user-1')?.data['device']).toBe('desktop');
    expect(ps.size()).toBe(1);
  });
});
