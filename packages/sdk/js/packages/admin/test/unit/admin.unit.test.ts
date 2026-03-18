/**
 * @edgebase-fun/admin — 단위 테스트
 *
 * 테스트 대상: src/client.ts (AdminEdgeBase), src/kv.ts (KvClient)
 *
 * 실행: cd packages/sdk/js/packages/admin && npx vitest run
 *
 * 원칙: 서버 불필요 — 순수 TypeScript 객체 구성/반환 타입 검증
 */

import { describe, it, expect } from 'vitest';
import { createAdminClient } from '../../src/index.js';

const DUMMY_URL = 'https://dummy.edgebase.fun';
const DUMMY_SK = 'sk-test-dummy-key';

// ─── A. createAdminClient — 생성 검증 ─────────────────────────────────────────

describe('AdminEdgeBase — 생성', () => {
  it('인스턴스 생성 성공', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(admin).toBeTruthy();
    admin.destroy();
  });

  it('auth 프로퍼티 존재', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(admin.auth).toBeTruthy();
    admin.destroy();
  });

  it('storage 프로퍼티 존재', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(admin.storage).toBeTruthy();
    admin.destroy();
  });

  it('push 프로퍼티 존재', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(admin.push).toBeTruthy();
    admin.destroy();
  });

  it('analytics 프로퍼티 존재', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(admin.analytics).toBeTruthy();
    admin.destroy();
  });

});

// ─── B. admin.db() — DbRef 반환 ───────────────────────────────────────────────

describe('AdminEdgeBase — db()', () => {
  it('db("shared")는 DbRef 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const db = admin.db('shared');
    expect(db).toBeTruthy();
    admin.destroy();
  });

  it('db("shared").table("posts") — TableRef 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const table = admin.db('shared').table('posts');
    expect(table).toBeTruthy();
    admin.destroy();
  });

  it('db("workspace", "ws-123") — instance ID 지원', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const db = admin.db('workspace', 'ws-123');
    expect(db).toBeTruthy();
    admin.destroy();
  });

  it('TableRef.where() — 새 인스턴스 반환 (불변)', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const t1 = admin.db('shared').table('posts');
    const t2 = t1.where('status', '==', 'published');
    expect(t1).not.toBe(t2);
    admin.destroy();
  });

  it('TableRef.limit() — 새 인스턴스 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const t1 = admin.db('shared').table('posts');
    const t2 = t1.limit(10);
    expect(t1).not.toBe(t2);
    admin.destroy();
  });

  it('TableRef.orderBy() — 새 인스턴스 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const t1 = admin.db('shared').table('posts');
    const t2 = t1.orderBy('createdAt', 'desc');
    expect(t1).not.toBe(t2);
    admin.destroy();
  });

  it('TableRef.after() — 새 인스턴스 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const t1 = admin.db('shared').table('posts');
    const t2 = t1.after('some-cursor');
    expect(t1).not.toBe(t2);
    admin.destroy();
  });

  it('TableRef.before() — 새 인스턴스 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const t1 = admin.db('shared').table('posts');
    const t2 = t1.before('some-cursor');
    expect(t1).not.toBe(t2);
    admin.destroy();
  });

  it('TableRef.page() — 새 인스턴스 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const t1 = admin.db('shared').table('posts');
    const t2 = t1.page(2);
    expect(t1).not.toBe(t2);
    admin.destroy();
  });

  it('TableRef.offset() — 새 인스턴스 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const t1 = admin.db('shared').table('posts');
    const t2 = t1.offset(20);
    expect(t1).not.toBe(t2);
    admin.destroy();
  });

  it('TableRef.or() — 새 인스턴스 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const t1 = admin.db('shared').table('posts');
    const t2 = t1.or(q => q.where('x', '==', 1));
    expect(t1).not.toBe(t2);
    admin.destroy();
  });

  it('TableRef 체인 — 여러 where 누적', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const t = admin.db('shared').table('posts')
      .where('status', '==', 'published')
      .where('views', '>', 100)
      .orderBy('createdAt', 'desc')
      .limit(20);
    expect(t).toBeTruthy();
    admin.destroy();
  });
});

// ─── C. admin.kv() — KvClient ────────────────────────────────────────────────

describe('AdminEdgeBase — kv()', () => {
  it('kv("cache") → KvClient 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const kv = admin.kv('cache');
    expect(kv).toBeTruthy();
    admin.destroy();
  });

  it('다른 namespace → 독립 인스턴스', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const kv1 = admin.kv('ns1');
    const kv2 = admin.kv('ns2');
    expect(kv1).not.toBe(kv2);
    admin.destroy();
  });
});

// ─── D. admin.d1() ───────────────────────────────────────────────────────────

describe('AdminEdgeBase — d1()', () => {
  it('d1("analytics") → D1Client 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const d1 = admin.d1('analytics');
    expect(d1).toBeTruthy();
    admin.destroy();
  });

  it('d1("db1") ≠ d1("db2")', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const d1a = admin.d1('db1');
    const d1b = admin.d1('db2');
    expect(d1a).not.toBe(d1b);
    admin.destroy();
  });
});

// ─── E. admin.vector() ───────────────────────────────────────────────────────

describe('AdminEdgeBase — vector()', () => {
  it('vector("embeddings") → VectorizeClient 반환', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const vec = admin.vector('embeddings');
    expect(vec).toBeTruthy();
    admin.destroy();
  });

  it('vector("idx1") ≠ vector("idx2")', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const v1 = admin.vector('idx1');
    const v2 = admin.vector('idx2');
    expect(v1).not.toBe(v2);
    admin.destroy();
  });
});

// ─── F. storage URL 빌드 ──────────────────────────────────────────────────────

describe('AdminEdgeBase — storage.getUrl()', () => {
  it('storage getUrl("avatars", "profile.png") → URL 포함', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const url = admin.storage.getUrl('avatars', 'profile.png');
    expect(url).toContain('avatars');
    expect(url).toContain('profile.png');
    admin.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Phase 2 additions below
// ═══════════════════════════════════════════════════════════════════════════════

import { AnalyticsClient } from '../../src/analytics.js';
import { KvClient } from '../../src/kv.js';
import { D1Client } from '../../src/d1.js';
import { VectorizeClient } from '../../src/vectorize.js';
import { PushClient } from '../../src/push.js';
import { AdminAuthClient } from '../../src/admin-auth.js';

// ─── H. KvClient — method signatures ────────────────────────────────────────

describe('KvClient — method signatures', () => {
  it('get is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const kv = admin.kv('test');
    expect(typeof kv.get).toBe('function');
    admin.destroy();
  });

  it('set is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const kv = admin.kv('test');
    expect(typeof kv.set).toBe('function');
    admin.destroy();
  });

  it('delete is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const kv = admin.kv('test');
    expect(typeof kv.delete).toBe('function');
    admin.destroy();
  });

  it('list is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const kv = admin.kv('test');
    expect(typeof kv.list).toBe('function');
    admin.destroy();
  });
});

// ─── I. D1Client — method signatures ────────────────────────────────────────

describe('D1Client — method signatures', () => {
  it('exec is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const d1 = admin.d1('analytics');
    expect(typeof d1.exec).toBe('function');
    admin.destroy();
  });

  it('query is a function (alias of exec)', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const d1 = admin.d1('analytics');
    expect(typeof d1.query).toBe('function');
    admin.destroy();
  });
});

// ─── J. VectorizeClient — method signatures ─────────────────────────────────

describe('VectorizeClient — method signatures', () => {
  it('upsert is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const vec = admin.vector('embeddings');
    expect(typeof vec.upsert).toBe('function');
    admin.destroy();
  });

  it('insert is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const vec = admin.vector('embeddings');
    expect(typeof vec.insert).toBe('function');
    admin.destroy();
  });

  it('search is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const vec = admin.vector('embeddings');
    expect(typeof vec.search).toBe('function');
    admin.destroy();
  });

  it('queryById is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const vec = admin.vector('embeddings');
    expect(typeof vec.queryById).toBe('function');
    admin.destroy();
  });

  it('getByIds is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const vec = admin.vector('embeddings');
    expect(typeof vec.getByIds).toBe('function');
    admin.destroy();
  });

  it('delete is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const vec = admin.vector('embeddings');
    expect(typeof vec.delete).toBe('function');
    admin.destroy();
  });

  it('describe is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    const vec = admin.vector('embeddings');
    expect(typeof vec.describe).toBe('function');
    admin.destroy();
  });
});

// ─── K. PushClient — method signatures ──────────────────────────────────────

describe('PushClient — method signatures', () => {
  it('send is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.push.send).toBe('function');
    admin.destroy();
  });

  it('sendMany is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.push.sendMany).toBe('function');
    admin.destroy();
  });

  it('sendToToken is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.push.sendToToken).toBe('function');
    admin.destroy();
  });

  it('getTokens is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.push.getTokens).toBe('function');
    admin.destroy();
  });

  it('getLogs is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.push.getLogs).toBe('function');
    admin.destroy();
  });

  it('sendToTopic is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.push.sendToTopic).toBe('function');
    admin.destroy();
  });

  it('broadcast is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.push.broadcast).toBe('function');
    admin.destroy();
  });
});

// ─── L. AdminAuthClient — method signatures ─────────────────────────────────

describe('AdminAuthClient — method signatures', () => {
  it('getUser is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.auth.getUser).toBe('function');
    admin.destroy();
  });

  it('listUsers is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.auth.listUsers).toBe('function');
    admin.destroy();
  });

  it('createUser is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.auth.createUser).toBe('function');
    admin.destroy();
  });

  it('updateUser is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.auth.updateUser).toBe('function');
    admin.destroy();
  });

  it('deleteUser is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.auth.deleteUser).toBe('function');
    admin.destroy();
  });

  it('setCustomClaims is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.auth.setCustomClaims).toBe('function');
    admin.destroy();
  });

  it('revokeAllSessions is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.auth.revokeAllSessions).toBe('function');
    admin.destroy();
  });
});

// ─── N. AnalyticsClient — method signatures ──────────────────────────────────

describe('AnalyticsClient — method signatures', () => {
  it('overview is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.analytics.overview).toBe('function');
    admin.destroy();
  });

  it('timeSeries is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.analytics.timeSeries).toBe('function');
    admin.destroy();
  });

  it('breakdown is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.analytics.breakdown).toBe('function');
    admin.destroy();
  });

  it('topEndpoints is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.analytics.topEndpoints).toBe('function');
    admin.destroy();
  });

  it('track is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.analytics.track).toBe('function');
    admin.destroy();
  });

  it('trackBatch is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.analytics.trackBatch).toBe('function');
    admin.destroy();
  });

  it('queryEvents is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.analytics.queryEvents).toBe('function');
    admin.destroy();
  });
});

// ─── M. AdminEdgeBase — sql/broadcast signatures ────────────────────────────

describe('AdminEdgeBase — additional methods', () => {
  it('sql is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.sql).toBe('function');
    admin.destroy();
  });

  it('broadcast is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.broadcast).toBe('function');
    admin.destroy();
  });

  it('destroy is a function', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(typeof admin.destroy).toBe('function');
    admin.destroy();
  });

  it('destroy multiple calls no error', () => {
    const admin = createAdminClient(DUMMY_URL, { serviceKey: DUMMY_SK });
    expect(() => {
      admin.destroy();
      admin.destroy();
    }).not.toThrow();
  });
});
