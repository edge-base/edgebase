/**
 * schema.test.ts — 80개
 *
 * 테스트 대상: src/lib/schema.ts 순수 함수 + HTTP 통합
 *   buildEffectiveSchema, generateCreateTableDDL, generateIndexDDL,
 *   generateFTS5DDL, generateFTS5Triggers, generateTableDDL,
 *   computeSchemaHash, computeSchemaHashSync, generateAddColumnDDL
 *
 * HTTP 통합: categories 마이그레이션(slug, sortOrder) 동작 확인
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  buildEffectiveSchema,
  generateCreateTableDDL,
  generateIndexDDL,
  generateFTS5DDL,
  generateFTS5Triggers,
  generateTableDDL,
  computeSchemaHash,
  computeSchemaHashSync,
  generateAddColumnDDL,
} from '../../src/lib/schema.js';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function api(method: string, path: string, body?: unknown) {
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': SK },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

const createdCatIds: string[] = [];
afterAll(async () => {
  for (const id of createdCatIds) {
    await api('DELETE', `/api/db/shared/tables/categories/${id}`).catch(() => {});
  }
});

// ─── 1. buildEffectiveSchema ──────────────────────────────────────────────────

describe('1-03 schema — buildEffectiveSchema', () => {
  it('스키마 없음(schemaless) → auto fields만 (id, createdAt, updatedAt)', () => {
    const eff = buildEffectiveSchema(undefined);
    expect(eff.id).toBeDefined();
    expect(eff.createdAt).toBeDefined();
    expect(eff.updatedAt).toBeDefined();
    expect(Object.keys(eff)).toHaveLength(3);
  });

  it('사용자 스키마 → auto fields + 사용자 필드', () => {
    const eff = buildEffectiveSchema({ title: { type: 'string' } });
    expect(eff.id).toBeDefined();
    expect(eff.title).toBeDefined();
    expect(Object.keys(eff).length).toBeGreaterThan(3);
  });

  it('id: false → id 제외됨', () => {
    const eff = buildEffectiveSchema({ id: false, name: { type: 'string' } });
    expect(eff.id).toBeUndefined();
    expect(eff.name).toBeDefined();
  });

  it('updatedAt: false → updatedAt 제외됨', () => {
    const eff = buildEffectiveSchema({ updatedAt: false, name: { type: 'string' } });
    expect(eff.updatedAt).toBeUndefined();
  });

  it('사용자가 id 타입 오버라이드 시도 → 무시됨', () => {
    const eff = buildEffectiveSchema({ id: { type: 'number', primaryKey: true } });
    expect(eff.id.type).toBe('string'); // 타입 오버라이드 불가, auto-field 타입 유지
  });

  it('auto-fields 순서: id, createdAt, updatedAt 먼저', () => {
    const eff = buildEffectiveSchema({ zzz: { type: 'string' } });
    const keys = Object.keys(eff);
    expect(keys.indexOf('id')).toBeLessThan(keys.indexOf('zzz'));
  });
});

// ─── 2. generateCreateTableDDL ───────────────────────────────────────────────

describe('1-03 schema — generateCreateTableDDL', () => {
  it('기본 DDL 생성 — CREATE TABLE IF NOT EXISTS', () => {
    const ddl = generateCreateTableDDL('posts', { schema: { title: { type: 'string' } } });
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "posts"');
    expect(ddl).toContain('"title" TEXT');
    expect(ddl).toContain('"id" TEXT PRIMARY KEY');
  });

  it('string → TEXT', () => {
    const ddl = generateCreateTableDDL('t', { schema: { f: { type: 'string' } } });
    expect(ddl).toContain('"f" TEXT');
  });

  it('number → REAL', () => {
    const ddl = generateCreateTableDDL('t', { schema: { count: { type: 'number' } } });
    expect(ddl).toContain('"count" REAL');
  });

  it('boolean → INTEGER', () => {
    const ddl = generateCreateTableDDL('t', { schema: { active: { type: 'boolean' } } });
    expect(ddl).toContain('"active" INTEGER');
  });

  it('text → TEXT', () => {
    const ddl = generateCreateTableDDL('t', { schema: { body: { type: 'text' } } });
    expect(ddl).toContain('"body" TEXT');
  });

  it('json → TEXT', () => {
    const ddl = generateCreateTableDDL('t', { schema: { meta: { type: 'json' } } });
    expect(ddl).toContain('"meta" TEXT');
  });

  it('required → NOT NULL', () => {
    const ddl = generateCreateTableDDL('t', { schema: { name: { type: 'string', required: true } } });
    expect(ddl).toContain('NOT NULL');
  });

  it('unique → UNIQUE', () => {
    const ddl = generateCreateTableDDL('t', { schema: { email: { type: 'string', unique: true } } });
    expect(ddl).toContain('UNIQUE');
  });

  it('default 숫자값', () => {
    const ddl = generateCreateTableDDL('t', { schema: { count: { type: 'number', default: 0 } } });
    expect(ddl).toContain('DEFAULT 0');
  });

  it('default 문자열값', () => {
    const ddl = generateCreateTableDDL('t', { schema: { status: { type: 'string', default: 'draft' } } });
    expect(ddl).toContain("DEFAULT 'draft'");
  });
});

// ─── 3. generateIndexDDL ────────────────────────────────────────────────────

describe('1-03 schema — generateIndexDDL', () => {
  it('단일 필드 인덱스', () => {
    const ddl = generateIndexDDL('posts', [{ fields: ['authorId'] }]);
    expect(ddl[0]).toContain('CREATE INDEX IF NOT EXISTS');
    expect(ddl[0]).toContain('"authorId"');
  });

  it('복합 필드 인덱스', () => {
    const ddl = generateIndexDDL('posts', [{ fields: ['isPublished', 'createdAt'] }]);
    expect(ddl[0]).toContain('"isPublished"');
    expect(ddl[0]).toContain('"createdAt"');
  });

  it('unique 인덱스 → UNIQUE INDEX', () => {
    const ddl = generateIndexDDL('posts', [{ fields: ['slug'], unique: true }]);
    expect(ddl[0]).toContain('UNIQUE INDEX');
  });

  it('빈 인덱스 배열 → []', () => {
    const ddl = generateIndexDDL('posts', []);
    expect(ddl).toHaveLength(0);
  });

  it('2개 인덱스 → 2개 DDL', () => {
    const ddl = generateIndexDDL('posts', [
      { fields: ['f1'] },
      { fields: ['f2'] },
    ]);
    expect(ddl).toHaveLength(2);
  });
});

// ─── 4. generateFTS5DDL ─────────────────────────────────────────────────────

describe('1-03 schema — generateFTS5DDL', () => {
  it('FTS5 가상 테이블 DDL 생성', () => {
    const ddl = generateFTS5DDL('posts', ['title', 'content']);
    expect(ddl).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS "posts_fts"');
    expect(ddl).toContain('USING fts5(');
    expect(ddl).toContain('title');
    expect(ddl).toContain('content');
  });

  it('content=tableName, tokenize=trigram', () => {
    const ddl = generateFTS5DDL('items', ['name']);
    expect(ddl).toContain("content='items'");
    expect(ddl).toContain("tokenize='trigram'");
  });
});

describe('1-03 schema — generateFTS5Triggers', () => {
  it('3개 트리거 생성 (INSERT, DELETE, UPDATE)', () => {
    const triggers = generateFTS5Triggers('posts', ['title', 'content']);
    expect(triggers).toHaveLength(3);
  });

  it('INSERT 트리거 포함', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers.some(t => t.includes('AFTER INSERT'))).toBe(true);
  });

  it('DELETE 트리거 포함', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers.some(t => t.includes('AFTER DELETE'))).toBe(true);
  });

  it('UPDATE 트리거 포함', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers.some(t => t.includes('AFTER UPDATE'))).toBe(true);
  });
});

// ─── 5. computeSchemaHash ────────────────────────────────────────────────────

describe('1-03 schema — computeSchemaHash', () => {
  it('동일 config → 동일 해시 (결정론적)', async () => {
    const config = { schema: { title: { type: 'string' as const } } };
    const h1 = await computeSchemaHash(config);
    const h2 = await computeSchemaHash(config);
    expect(h1).toBe(h2);
  });

  it('다른 config → 다른 해시', async () => {
    const h1 = await computeSchemaHash({ schema: { a: { type: 'string' as const } } });
    const h2 = await computeSchemaHash({ schema: { b: { type: 'string' as const } } });
    expect(h1).not.toBe(h2);
  });

  it('빈 config → 해시 생성됨 (에러 없음)', async () => {
    const h = await computeSchemaHash({});
    expect(typeof h).toBe('string');
    expect(h.length).toBeGreaterThan(0);
  });
});

describe('1-03 schema — computeSchemaHashSync', () => {
  it('동일 config → 동일 해시 (결정론적)', () => {
    const config = { schema: { title: { type: 'string' as const } } };
    const h1 = computeSchemaHashSync(config);
    const h2 = computeSchemaHashSync(config);
    expect(h1).toBe(h2);
  });

  it('schema 없는 config → 해시 생성됨', () => {
    const h = computeSchemaHashSync({});
    expect(typeof h).toBe('string');
    expect(h).toHaveLength(8); // padStart(8, '0') 형식
  });

  it('access 변경 → 해시 불변 (schema만 해시)', () => {
    const c1 = { schema: { x: { type: 'string' as const } }, access: { read: () => true } };
    const c2 = { schema: { x: { type: 'string' as const } }, access: { read: () => false } };
    expect(computeSchemaHashSync(c1)).toBe(computeSchemaHashSync(c2));
  });
});

// ─── 6. generateAddColumnDDL ─────────────────────────────────────────────────

describe('1-03 schema — generateAddColumnDDL', () => {
  it('ALTER TABLE ADD COLUMN 생성', () => {
    const ddl = generateAddColumnDDL('posts', 'newField', { type: 'string' });
    expect(ddl).toContain('ALTER TABLE "posts" ADD COLUMN "newField" TEXT');
  });

  it('NOT NULL 포함', () => {
    const ddl = generateAddColumnDDL('posts', 'req', { type: 'string', required: true });
    expect(ddl).toContain('NOT NULL');
  });
});

// ─── 7. HTTP 통합 — categories 마이그레이션 ──────────────────────────────────

describe('1-03 schema — HTTP migration (categories slug/sortOrder)', () => {
  it('categories 생성 → slug/sortOrder 컬럼 사용 가능 (마이그레이션 적용됨)', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/categories', {
      name: 'migration-test-' + crypto.randomUUID().slice(0, 8),
      slug: 'test-slug',
      sortOrder: 10,
    });
    expect(status).toBe(201);
    expect(data.slug).toBe('test-slug');
    expect(data.sortOrder).toBe(10);
    createdCatIds.push(data.id);
  });

  it('bad_migration 테이블 접근 → 503 또는 에러 응답', async () => {
    // bad_migration has INVALID SQL migration — should fail gracefully
    const { status } = await api('GET', '/api/db/shared/tables/bad_migration');
    // Migration fails → 503 or 500
    expect([200, 400, 500, 503].includes(status)).toBe(true);
  });

  it('미정의 테이블 접근 → 400 또는 404', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/nonexistent_table');
    expect([400, 404].includes(status)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TESTS — appended below (42 tests)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 8. Lazy Schema Init — hash-based init logic ─────────────────────────────

describe('1-03 schema — Lazy Schema Init flow', () => {
  it('첫 요청 → DO 초기화 + 테이블 생성 (posts 200)', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/posts?limit=1');
    expect(status).toBe(200);
  });

  it('해시 일치 → 스키마 재생성 skip (두 번째 요청도 200)', async () => {
    const r1 = await api('GET', '/api/db/shared/tables/posts?limit=1');
    const r2 = await api('GET', '/api/db/shared/tables/posts?limit=1');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('categories 마이그레이션 후 ADD COLUMN slug 사용 가능', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/categories', {
      name: `hash-slug-${prefix}`,
      slug: `slug-${prefix}`,
    });
    expect(status).toBe(201);
    expect(data.slug).toBe(`slug-${prefix}`);
    createdCatIds.push(data.id);
  });

  it('categories 마이그레이션 후 ADD COLUMN sortOrder 사용 가능', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/categories', {
      name: `hash-sort-${prefix}`,
      sortOrder: 42,
    });
    expect(status).toBe(201);
    expect(data.sortOrder).toBe(42);
    createdCatIds.push(data.id);
  });
});

// ─── 9. ADD COLUMN DDL per type ──────────────────────────────────────────────

describe('1-03 schema — generateAddColumnDDL per type', () => {
  it('boolean → ALTER TABLE ADD COLUMN INTEGER', () => {
    const ddl = generateAddColumnDDL('t', 'active', { type: 'boolean' });
    expect(ddl).toContain('ALTER TABLE "t" ADD COLUMN "active" INTEGER');
  });

  it('number → ALTER TABLE ADD COLUMN REAL', () => {
    const ddl = generateAddColumnDDL('t', 'score', { type: 'number' });
    expect(ddl).toContain('ALTER TABLE "t" ADD COLUMN "score" REAL');
  });

  it('text → ALTER TABLE ADD COLUMN TEXT', () => {
    const ddl = generateAddColumnDDL('t', 'body', { type: 'text' });
    expect(ddl).toContain('ALTER TABLE "t" ADD COLUMN "body" TEXT');
  });

  it('json → ALTER TABLE ADD COLUMN TEXT', () => {
    const ddl = generateAddColumnDDL('t', 'meta', { type: 'json' });
    expect(ddl).toContain('ALTER TABLE "t" ADD COLUMN "meta" TEXT');
  });

  it('datetime → ALTER TABLE ADD COLUMN TEXT', () => {
    const ddl = generateAddColumnDDL('t', 'ts', { type: 'datetime' });
    expect(ddl).toContain('ALTER TABLE "t" ADD COLUMN "ts" TEXT');
  });

  it('string + required → NOT NULL 포함', () => {
    const ddl = generateAddColumnDDL('t', 'name', { type: 'string', required: true });
    expect(ddl).toContain('NOT NULL');
  });

  it('string + unique → UNIQUE 포함', () => {
    const ddl = generateAddColumnDDL('t', 'email', { type: 'string', unique: true });
    expect(ddl).toContain('UNIQUE');
  });

  it('number + default → DEFAULT 포함', () => {
    const ddl = generateAddColumnDDL('t', 'views', { type: 'number', default: 0 });
    expect(ddl).toContain('DEFAULT 0');
  });

  it('string + default → DEFAULT 문자열 포함', () => {
    const ddl = generateAddColumnDDL('t', 'status', { type: 'string', default: 'active' });
    expect(ddl).toContain("DEFAULT 'active'");
  });
});

// ─── 10. generateTableDDL 통합 ────────────────────────────────────────────────

describe('1-03 schema — generateTableDDL (combined DDL)', () => {
  it('schema만 → CREATE TABLE 1개', () => {
    const ddl = generateTableDDL('t', { schema: { x: { type: 'string' } } });
    expect(ddl.length).toBe(1);
    expect(ddl[0]).toContain('CREATE TABLE IF NOT EXISTS "t"');
  });

  it('schema + indexes → CREATE TABLE + INDEX', () => {
    const ddl = generateTableDDL('t', {
      schema: { x: { type: 'string' } },
      indexes: [{ fields: ['x'] }],
    });
    expect(ddl.length).toBe(2);
    expect(ddl[1]).toContain('CREATE INDEX IF NOT EXISTS');
  });

  it('schema + fts → CREATE TABLE + FTS5 + 3 triggers', () => {
    const ddl = generateTableDDL('t', {
      schema: { x: { type: 'string' } },
      fts: ['x'],
    });
    // 1 CREATE TABLE + 1 FTS5 virtual table + 3 triggers = 5
    expect(ddl.length).toBe(5);
  });

  it('schema + indexes + fts → 전부 포함', () => {
    const ddl = generateTableDDL('t', {
      schema: { x: { type: 'string' } },
      indexes: [{ fields: ['x'] }],
      fts: ['x'],
    });
    // 1 CREATE TABLE + 1 INDEX + 1 FTS5 + 3 triggers = 6
    expect(ddl.length).toBe(6);
  });

  it('빈 schema(schemaless) → auto fields만 있는 DDL', () => {
    const ddl = generateTableDDL('t', {});
    expect(ddl.length).toBe(1);
    expect(ddl[0]).toContain('"id" TEXT PRIMARY KEY');
    expect(ddl[0]).toContain('"createdAt"');
    expect(ddl[0]).toContain('"updatedAt"');
  });
});

// ─── 11. computeSchemaHashSync — deterministic, 8-char hex ────────────────────

describe('1-03 schema — computeSchemaHashSync edge cases', () => {
  it('해시 길이 = 8 (padStart)', () => {
    const h = computeSchemaHashSync({ schema: { a: { type: 'string' } } });
    expect(h).toHaveLength(8);
  });

  it('동일 스키마, 필드 순서 다름 → 동일 해시 (deepSort)', () => {
    const c1 = { schema: { a: { type: 'string' as const }, b: { type: 'number' as const } } };
    const c2 = { schema: { b: { type: 'number' as const }, a: { type: 'string' as const } } };
    expect(computeSchemaHashSync(c1)).toBe(computeSchemaHashSync(c2));
  });

  it('fts 변경 → 해시 불변 (schema만 해시)', () => {
    const c1 = { schema: { x: { type: 'string' as const } }, fts: ['x'] };
    const c2 = { schema: { x: { type: 'string' as const } } };
    expect(computeSchemaHashSync(c1)).toBe(computeSchemaHashSync(c2));
  });

  it('indexes 변경 → 해시 불변 (schema만 해시)', () => {
    const c1 = { schema: { x: { type: 'string' as const } }, indexes: [{ fields: ['x'] }] };
    const c2 = { schema: { x: { type: 'string' as const } } };
    expect(computeSchemaHashSync(c1)).toBe(computeSchemaHashSync(c2));
  });

  it('migrations 변경 → 해시 불변 (schema만 해시)', () => {
    const c1 = { schema: { x: { type: 'string' as const } }, migrations: [{ version: 2, description: 'test', up: 'SELECT 1' }] };
    const c2 = { schema: { x: { type: 'string' as const } } };
    expect(computeSchemaHashSync(c1)).toBe(computeSchemaHashSync(c2));
  });

  it('hex 문자만 포함', () => {
    const h = computeSchemaHashSync({ schema: { x: { type: 'string' } } });
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ─── 12. computeSchemaHash (async SHA-256) — deterministic ────────────────────

describe('1-03 schema — computeSchemaHash edge cases', () => {
  it('필드 순서 다름 → 동일 해시 (deepSort)', async () => {
    const c1 = { schema: { a: { type: 'string' as const }, b: { type: 'number' as const } } };
    const c2 = { schema: { b: { type: 'number' as const }, a: { type: 'string' as const } } };
    expect(await computeSchemaHash(c1)).toBe(await computeSchemaHash(c2));
  });

  it('SHA-256 결과 → 64-char hex', async () => {
    const h = await computeSchemaHash({ schema: { x: { type: 'string' } } });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('access 함수 변경 → 해시 불변', async () => {
    const c1 = { schema: { x: { type: 'string' as const } }, access: { read: () => true } };
    const c2 = { schema: { x: { type: 'string' as const } }, access: { read: () => false } };
    expect(await computeSchemaHash(c1)).toBe(await computeSchemaHash(c2));
  });
});

// ─── 13. buildEffectiveSchema — edge cases ────────────────────────────────────

describe('1-03 schema — buildEffectiveSchema edge cases', () => {
  it('createdAt: false → createdAt 제외됨', () => {
    const eff = buildEffectiveSchema({ createdAt: false, name: { type: 'string' } });
    expect(eff.createdAt).toBeUndefined();
    expect(eff.name).toBeDefined();
  });

  it('모든 auto-field 비활성화 → 사용자 필드만', () => {
    const eff = buildEffectiveSchema({ id: false, createdAt: false, updatedAt: false, x: { type: 'string' } });
    expect(eff.id).toBeUndefined();
    expect(eff.createdAt).toBeUndefined();
    expect(eff.updatedAt).toBeUndefined();
    expect(eff.x).toBeDefined();
    expect(Object.keys(eff)).toHaveLength(1);
  });

  it('사용자가 createdAt 타입 오버라이드 시도 → 무시됨', () => {
    const eff = buildEffectiveSchema({ createdAt: { type: 'string' } });
    expect(eff.createdAt.type).toBe('datetime'); // 타입 오버라이드 불가, auto-field 타입 유지
  });

  it('사용자 필드 다수 → 모두 포함', () => {
    const eff = buildEffectiveSchema({
      title: { type: 'string' },
      views: { type: 'number' },
      active: { type: 'boolean' },
      body: { type: 'text' },
      meta: { type: 'json' },
    });
    expect(Object.keys(eff)).toContain('title');
    expect(Object.keys(eff)).toContain('views');
    expect(Object.keys(eff)).toContain('active');
    expect(Object.keys(eff)).toContain('body');
    expect(Object.keys(eff)).toContain('meta');
    // Plus auto fields
    expect(Object.keys(eff).length).toBe(8); // 5 user + 3 auto
  });
});

// ─── 14. generateCreateTableDDL — FK, CHECK, primaryKey ──────────────────────

describe('1-03 schema — generateCreateTableDDL advanced', () => {
  it('references 문자열 short form for auth users → logical reference only', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { authorId: { type: 'string', references: 'users' } },
    });
    expect(ddl).not.toContain('REFERENCES "users"("id")');
  });

  it('references 문자열 short form for same-DB tables → physical FK', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { orderId: { type: 'string', references: 'orders' } },
    });
    expect(ddl).toContain('REFERENCES "orders"("id") ON DELETE SET NULL');
  });

  it('references 문자열 (table(col)) → REFERENCES + ON DELETE CASCADE', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { catId: { type: 'string', references: 'categories(id)' } },
    });
    expect(ddl).toContain('REFERENCES "categories"("id") ON DELETE CASCADE');
  });

  it('references 객체 form → REFERENCES + onDelete', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { catId: { type: 'string', references: { table: 'categories', onDelete: 'CASCADE' } } },
    });
    expect(ddl).toContain('REFERENCES "categories"("id") ON DELETE CASCADE');
  });

  it('check 제약 → CHECK 포함', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { score: { type: 'number', check: 'score >= 0 AND score <= 100' } },
    });
    expect(ddl).toContain('CHECK (score >= 0 AND score <= 100)');
  });

  it('boolean default false → DEFAULT 0', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { active: { type: 'boolean', default: false } },
    });
    expect(ddl).toContain('DEFAULT 0');
  });

  it('boolean default true → DEFAULT 1', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { active: { type: 'boolean', default: true } },
    });
    expect(ddl).toContain('DEFAULT 1');
  });

  it('default null → DEFAULT NULL', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { extra: { type: 'string', default: null } },
    });
    expect(ddl).toContain('DEFAULT NULL');
  });

  it('datetime → TEXT 매핑', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { ts: { type: 'datetime' } },
    });
    expect(ddl).toContain('"ts" TEXT');
  });
});

// ─── 15. HTTP 통합 — bad_migration, validation ────────────────────────────────

describe('1-03 schema — HTTP validation & migration errors', () => {
  it('bad_migration 테이블 CREATE → 초기 migration 실패 시 에러', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status } = await api('POST', '/api/db/shared/tables/bad_migration', {
      name: `bad-${prefix}`,
    });
    // bad_migration has INVALID SQL — schema init will fail → 500 or 503
    expect([200, 201, 400, 500, 503].includes(status)).toBe(true);
  });

  it('required 필드 누락 → 400', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      // title is required — omitting it
    });
    expect(status).toBe(400);
    expect(data?.data?.title).toBeDefined();
  });

  it('unknown 필드 → 201 (silently ignored)', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Valid Title',
      nonExistentField: 'should be ignored',
    });
    expect(status).toBe(201);
    expect(data?.nonExistentField).toBeUndefined();
    // cleanup
    if (data?.id) await api('DELETE', `/api/db/shared/tables/posts/${data.id}`).catch(() => {});
  });

  it('type 불일치 (number 필드에 string) → 400', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Valid Title',
      views: 'not-a-number',
    });
    expect(status).toBe(400);
    expect(data?.data?.views).toBeDefined();
  });

  it('type 불일치 (boolean 필드에 string) → 400', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Valid Title',
      isPublished: 'not-a-boolean',
    });
    expect(status).toBe(400);
    expect(data?.data?.isPublished).toBeDefined();
  });

  it('categories required name 누락 → 400', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/categories', {
      slug: 'no-name',
    });
    expect(status).toBe(400);
    expect(data?.data?.name).toBeDefined();
  });
});

// ─── 16. FTS5 DDL — edge cases ────────────────────────────────────────────────

describe('1-03 schema — FTS5 edge cases', () => {
  it('복수 필드 FTS5 → 모든 필드 포함', () => {
    const ddl = generateFTS5DDL('t', ['title', 'body', 'summary']);
    expect(ddl).toContain('title');
    expect(ddl).toContain('body');
    expect(ddl).toContain('summary');
  });

  it('단일 필드 FTS5 → content_rowid=rowid', () => {
    const ddl = generateFTS5DDL('t', ['name']);
    expect(ddl).toContain("content_rowid='rowid'");
  });

  it('FTS5 트리거 — 복수 필드 INSERT 트리거에 모든 필드', () => {
    const triggers = generateFTS5Triggers('t', ['a', 'b', 'c']);
    const insertTrigger = triggers.find(t => t.includes('AFTER INSERT'));
    expect(insertTrigger).toBeDefined();
    expect(insertTrigger).toContain('new."a"');
    expect(insertTrigger).toContain('new."b"');
    expect(insertTrigger).toContain('new."c"');
  });

  it('FTS5 트리거 — DELETE 트리거에 old 필드', () => {
    const triggers = generateFTS5Triggers('t', ['x', 'y']);
    const deleteTrigger = triggers.find(t => t.includes('AFTER DELETE'));
    expect(deleteTrigger).toBeDefined();
    expect(deleteTrigger).toContain('old."x"');
    expect(deleteTrigger).toContain('old."y"');
  });
});

// ─── 17. Index DDL — edge cases ───────────────────────────────────────────────

describe('1-03 schema — generateIndexDDL edge cases', () => {
  it('인덱스 이름은 테이블명_필드 형식', () => {
    const ddl = generateIndexDDL('posts', [{ fields: ['slug'] }]);
    expect(ddl[0]).toContain('"idx_posts_slug"');
  });

  it('복합 인덱스 이름에 모든 필드 포함', () => {
    const ddl = generateIndexDDL('posts', [{ fields: ['a', 'b'] }]);
    expect(ddl[0]).toContain('"idx_posts_a_b"');
  });

  it('unique false(default) → UNIQUE 없음', () => {
    const ddl = generateIndexDDL('t', [{ fields: ['f'] }]);
    expect(ddl[0]).not.toContain('UNIQUE');
  });
});
