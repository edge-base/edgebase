/**
 * query.test.ts — 120개 (query engine pure unit tests)
 *
 * 테스트 대상: src/lib/query-engine.ts
 *   buildListQuery, buildCountQuery, buildGetQuery,
 *   buildSearchQuery, parseQueryParams
 *
 * Note: 순수 SQL builder이므로 HTTP/DB 불필요.
 *        반환된 SQL 문자열과 params를 검증.
 */
import { describe, it, expect } from 'vitest';
import {
  buildListQuery,
  buildCountQuery,
  buildGetQuery,
  buildSearchQuery,
  parseQueryParams,
} from '../../src/lib/query-engine.js';

// ─── 1. buildListQuery — 기본 ─────────────────────────────────────────────────

describe('1-04 query — buildListQuery 기본', () => {
  it('기본 — SELECT * FROM "posts" ORDER BY "id" ASC LIMIT ?', () => {
    const { sql, params } = buildListQuery('posts', {});
    expect(sql).toContain('SELECT "posts".* FROM "posts"');
    expect(sql).toContain('ORDER BY "id" ASC');
    expect(sql).toContain('LIMIT ?');
    expect(params).toContain(100); // default limit
  });

  it('fields 지정 → SELECT "title", "content"', () => {
    const { sql } = buildListQuery('posts', { fields: ['title', 'content'] });
    expect(sql).toContain('"posts"."title", "posts"."content"');
  });

  it('limit 지정', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { limit: 50 } });
    expect(params).toContain(50);
  });

  it('limit=0 → LIMIT 0', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { limit: 0 } });
    expect(params[params.indexOf(0)]).toBe(0);
  });

  it('offset 지정 — LIMIT ? OFFSET ?', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { limit: 10, offset: 20 } });
    expect(sql).toContain('LIMIT ? OFFSET ?');
    expect(params).toContain(10);
    expect(params).toContain(20);
  });

  it('offset=0 → OFFSET 0 포함', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { limit: 10, offset: 0 } });
    expect(params).toContain(0);
  });

  it('정렬 ASC', () => {
    const { sql } = buildListQuery('posts', { sort: [{ field: 'createdAt', direction: 'asc' }] });
    expect(sql).toContain('"createdAt" ASC');
  });

  it('정렬 DESC', () => {
    const { sql } = buildListQuery('posts', { sort: [{ field: 'views', direction: 'desc' }] });
    expect(sql).toContain('"views" DESC');
  });

  it('countSql 기본 생성됨', () => {
    const { countSql } = buildListQuery('posts', {});
    expect(countSql).toContain('SELECT COUNT(*) as total FROM "posts"');
  });
});

// ─── 2. buildListQuery — WHERE 필터 ──────────────────────────────────────────

describe('1-04 query — buildListQuery WHERE 필터', () => {
  it('== 연산자', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['isPublished', '==', true]] });
    expect(sql).toContain('"isPublished" = ?');
    expect(params).toContain(true);
  });

  it('!= 연산자', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['status', '!=', 'draft']] });
    expect(sql).toContain('"status" != ?');
    expect(params).toContain('draft');
  });

  it('> < >= <= 연산자', () => {
    const gt = buildListQuery('posts', { filters: [['views', '>', 100]] });
    expect(gt.sql).toContain('"views" > ?');
    const lt = buildListQuery('posts', { filters: [['views', '<', 50]] });
    expect(lt.sql).toContain('"views" < ?');
    const gte = buildListQuery('posts', { filters: [['views', '>=', 10]] });
    expect(gte.sql).toContain('"views" >= ?');
    const lte = buildListQuery('posts', { filters: [['views', '<=', 200]] });
    expect(lte.sql).toContain('"views" <= ?');
  });

  it('contains → INSTR(col, ?) > 0', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['title', 'contains', 'hello']] });
    expect(sql).toContain('INSTR("title", ?) > 0');
    expect(params).toContain('hello');
  });

  it('in → IN (?, ?, ?)', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['authorId', 'in', ['a', 'b', 'c']]] });
    expect(sql).toContain('"authorId" IN (?, ?, ?)');
    expect(params).toContain('a');
    expect(params).toContain('b');
    expect(params).toContain('c');
  });

  it('not in', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['status', 'not in', ['deleted', 'banned']]] });
    expect(sql).toContain('"status" NOT IN (?, ?)');
  });

  it('빈 배열 in → IN ()', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['id', 'in', []]] });
    expect(sql).toContain('IN ()');
    expect(params).toHaveLength(1); // only LIMIT default
  });

  it('복합 AND 조건', () => {
    const { sql } = buildListQuery('posts', {
      filters: [['isPublished', '==', true], ['authorId', '==', 'user-001']],
    });
    expect(sql).toContain('"isPublished" = ?');
    expect(sql).toContain('"authorId" = ?');
    expect(sql).toContain('AND');
  });

  it('OR 필터', () => {
    const { sql } = buildListQuery('posts', {
      orFilters: [['status', '==', 'active'], ['status', '==', 'pending']],
    });
    expect(sql).toContain('OR');
    expect(sql).toContain('"status" = ?');
  });

  it('OR 필터 5개 초과 → throws', () => {
    expect(() => buildListQuery('posts', {
      orFilters: Array.from({ length: 6 }, (_, i) => ['f', '==', i] as [string, '==', number]),
    })).toThrow('OR_FILTER_LIMIT_EXCEEDED');
  });
});

// ─── 3. buildListQuery — 커서 페이지네이션 ────────────────────────────────────

describe('1-04 query — cursor pagination', () => {
  it('after → WHERE "id" > ?', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { after: 'cursor-abc' } });
    expect(sql).toContain('"id" > ?');
    expect(params).toContain('cursor-abc');
  });

  it('before → WHERE "id" < ?', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { before: 'cursor-xyz' } });
    expect(sql).toContain('"id" < ?');
    expect(params).toContain('cursor-xyz');
  });

  it('before → ORDER BY "id" DESC', () => {
    const { sql } = buildListQuery('posts', { pagination: { before: 'cursor-xyz' } });
    expect(sql).toContain('"id" DESC');
  });

  it('cursor 시 countSql 없음', () => {
    const { countSql } = buildListQuery('posts', { pagination: { after: 'some-cursor' } });
    expect(countSql).toBeUndefined();
  });
});

// ─── 4. buildCountQuery ───────────────────────────────────────────────────────

describe('1-04 query — buildCountQuery', () => {
  it('필터 없음 → SELECT COUNT(*) as total FROM "posts"', () => {
    const { sql, params } = buildCountQuery('posts');
    expect(sql).toBe('SELECT COUNT(*) as total FROM "posts"');
    expect(params).toHaveLength(0);
  });

  it('필터 있음 → WHERE 절 추가', () => {
    const { sql, params } = buildCountQuery('posts', [['isPublished', '==', true]]);
    expect(sql).toContain('WHERE "isPublished" = ?');
    expect(params).toContain(true);
  });
});

// ─── 5. buildGetQuery ─────────────────────────────────────────────────────────

describe('1-04 query — buildGetQuery', () => {
  it('기본 — SELECT * FROM "posts" WHERE "id" = ?', () => {
    const { sql, params } = buildGetQuery('posts', 'id-001');
    expect(sql).toBe('SELECT * FROM "posts" WHERE "id" = ?');
    expect(params).toEqual(['id-001']);
  });

  it('fields 지정 → SELECT "title", "views"', () => {
    const { sql } = buildGetQuery('posts', 'id-001', ['title', 'views']);
    expect(sql).toContain('"title", "views"');
    expect(sql).toContain('WHERE "id" = ?');
  });
});

// ─── 6. buildSearchQuery ──────────────────────────────────────────────────────

describe('1-04 query — buildSearchQuery', () => {
  it('FTS 쿼리 생성 — FTS 테이블 JOIN, MATCH, rank 정렬', () => {
    const { sql, params } = buildSearchQuery('posts', 'hello world');
    expect(sql).toContain('posts_fts');
    expect(sql).toContain('MATCH ?');
    expect(sql).toContain('ORDER BY');
    expect(params[0]).toBe('"hello"* "world"*');
  });

  it('highlight 옵션 — highlight() 컬럼 추가', () => {
    const { sql } = buildSearchQuery('posts', 'test', {
      ftsFields: ['title', 'content'],
      highlightPre: '<b>',
      highlightPost: '</b>',
    });
    expect(sql).toContain('highlight(');
    expect(sql).toContain('<b>');
    expect(sql).toContain('</b>');
  });

  it('custom limit/offset', () => {
    const { params } = buildSearchQuery('posts', 'search', { limit: 5, offset: 10 });
    expect(params).toContain(5);
    expect(params).toContain(10);
  });

  it('기본 limit = 100, offset = 0', () => {
    const { params } = buildSearchQuery('posts', 'search');
    expect(params).toContain(100);
    expect(params).not.toContain(0);
  });

  it('쌍따옴표 포함 검색어 → escape 처리', () => {
    const { params } = buildSearchQuery('posts', 'say "hello"');
    // Internal " are doubled in FTS5, then wrapped in outer "
    expect((params[0] as string).startsWith('"')).toBe(true);
  });
});

// ─── 7. parseQueryParams ──────────────────────────────────────────────────────

describe('1-04 query — parseQueryParams', () => {
  it('빈 params → 기본 pagination 객체', () => {
    const opts = parseQueryParams({});
    expect(opts.pagination).toBeDefined();
    expect(opts.filters).toBeUndefined();
  });

  it('limit, offset 파싱', () => {
    const opts = parseQueryParams({ limit: '50', offset: '10' });
    expect(opts.pagination?.limit).toBe(50);
    expect(opts.pagination?.offset).toBe(10);
  });

  it('filter JSON 파싱', () => {
    const filter = JSON.stringify([['isPublished', '==', true]]);
    const opts = parseQueryParams({ filter });
    expect(opts.filters?.[0]).toEqual(['isPublished', '==', true]);
  });

  it('잘못된 filter JSON → 무시 (에러 아님)', () => {
    const opts = parseQueryParams({ filter: 'invalid json' });
    expect(opts.filters).toBeUndefined();
  });

  it('sort 파싱 — "views:desc,title:asc"', () => {
    const opts = parseQueryParams({ sort: 'views:desc,title:asc' });
    expect(opts.sort?.[0]).toEqual({ field: 'views', direction: 'desc' });
    expect(opts.sort?.[1]).toEqual({ field: 'title', direction: 'asc' });
  });

  it('after cursor 파싱', () => {
    const opts = parseQueryParams({ after: 'cursor-123' });
    expect(opts.pagination?.after).toBe('cursor-123');
  });

  it('fields 파싱 — "title,content"', () => {
    const opts = parseQueryParams({ fields: 'title,content' });
    expect(opts.fields).toEqual(['title', 'content']);
  });

  it('search 파싱', () => {
    const opts = parseQueryParams({ search: 'hello' });
    expect(opts.search).toBe('hello');
  });

  it('orFilter JSON 파싱', () => {
    const orFilter = JSON.stringify([['status', '==', 'active'], ['status', '==', 'pending']]);
    const opts = parseQueryParams({ orFilter });
    expect(opts.orFilters).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 아래부터 추가 테스트 — 기존 41개 + 79 = 총 120개
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 8. WHERE 연산자 — 개별 정밀 검증 + 엣지 케이스 ──────────────────────────

describe('1-04 query — WHERE == 엣지 케이스', () => {
  it('== null 비교', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['deletedAt', '==', null]] });
    expect(sql).toContain('"deletedAt" = ?');
    expect(params).toContain(null);
  });

  it('== 빈 문자열', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['title', '==', '']] });
    expect(sql).toContain('"title" = ?');
    expect(params).toContain('');
  });

  it('== 숫자 0', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['views', '==', 0]] });
    expect(sql).toContain('"views" = ?');
    expect(params).toContain(0);
  });

  it('== boolean false', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['isPublished', '==', false]] });
    expect(sql).toContain('"isPublished" = ?');
    expect(params).toContain(false);
  });
});

describe('1-04 query — WHERE != 엣지 케이스', () => {
  it('!= null', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['deletedAt', '!=', null]] });
    expect(sql).toContain('"deletedAt" != ?');
    expect(params).toContain(null);
  });

  it('!= 빈 문자열', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['title', '!=', '']] });
    expect(sql).toContain('"title" != ?');
    expect(params).toContain('');
  });
});

describe('1-04 query — WHERE > 엣지 케이스', () => {
  it('> 음수 값', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['views', '>', -1]] });
    expect(sql).toContain('"views" > ?');
    expect(params).toContain(-1);
  });
});

describe('1-04 query — WHERE < 엣지 케이스', () => {
  it('< 0', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['views', '<', 0]] });
    expect(sql).toContain('"views" < ?');
    expect(params).toContain(0);
  });

  it('< 소수점', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['score', '<', 3.14]] });
    expect(sql).toContain('"score" < ?');
    expect(params).toContain(3.14);
  });
});

describe('1-04 query — WHERE >= 엣지 케이스', () => {
  it('>= 문자열 날짜 비교', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['createdAt', '>=', '2024-01-01']] });
    expect(sql).toContain('"createdAt" >= ?');
    expect(params).toContain('2024-01-01');
  });
});

describe('1-04 query — WHERE <= 엣지 케이스', () => {
  it('<= 문자열 날짜 비교', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['createdAt', '<=', '2024-12-31']] });
    expect(sql).toContain('"createdAt" <= ?');
    expect(params).toContain('2024-12-31');
  });
});

describe('1-04 query — WHERE contains 엣지 케이스', () => {
  it('contains 빈 문자열 → INSTR matches all', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['title', 'contains', '']] });
    expect(sql).toContain('INSTR("title", ?) > 0');
    expect(params).toContain('');
  });

  it('contains 긴 문자열 (500자)', () => {
    const longStr = 'a'.repeat(500);
    const { params } = buildListQuery('posts', { filters: [['content', 'contains', longStr]] });
    expect(params).toContain(longStr);
  });

  it('contains 한국어 CJK 문자열', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['title', 'contains', '안녕하세요']] });
    expect(sql).toContain('INSTR("title", ?) > 0');
    expect(params).toContain('안녕하세요');
  });
});

describe('1-04 query — WHERE in 엣지 케이스', () => {
  it('in 단일 값 배열', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['authorId', 'in', ['only-one']]] });
    expect(sql).toContain('"authorId" IN (?)');
    expect(params).toContain('only-one');
  });

  it('in 숫자 배열', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['views', 'in', [10, 20, 30]]] });
    expect(sql).toContain('"views" IN (?, ?, ?)');
    expect(params).toContain(10);
    expect(params).toContain(20);
    expect(params).toContain(30);
  });

  it('in 많은 값 (20개)', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`);
    const { sql } = buildListQuery('posts', { filters: [['id', 'in', ids]] });
    const placeholders = ids.map(() => '?').join(', ');
    expect(sql).toContain(`"id" IN (${placeholders})`);
  });
});

describe('1-04 query — WHERE not in 엣지 케이스', () => {
  it('not in 빈 배열', () => {
    const { sql } = buildListQuery('posts', { filters: [['status', 'not in', []]] });
    expect(sql).toContain('"status" NOT IN ()');
  });

  it('not in 단일 값', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['status', 'not in', ['deleted']]] });
    expect(sql).toContain('"status" NOT IN (?)');
    expect(params).toContain('deleted');
  });

});

// ─── 9. 복합 AND / OR / 중첩 조합 ──────────────────────────────────────────

describe('1-04 query — complex AND/OR 조합', () => {
  it('3개 AND 필터 결합', () => {
    const { sql, params } = buildListQuery('posts', {
      filters: [
        ['isPublished', '==', true],
        ['views', '>', 100],
        ['title', 'contains', 'test'],
      ],
    });
    // 3 conditions joined with AND
    const whereMatch = sql.match(/AND/g);
    expect(whereMatch?.length).toBe(2);
    expect(params).toContain(true);
    expect(params).toContain(100);
    expect(params).toContain('test');
  });

  it('AND 필터 + OR 필터 동시 사용', () => {
    const { sql, params } = buildListQuery('posts', {
      filters: [['isPublished', '==', true]],
      orFilters: [['status', '==', 'active'], ['status', '==', 'pending']],
    });
    expect(sql).toContain('"isPublished" = ?');
    expect(sql).toContain('AND');
    expect(sql).toContain('OR');
    expect(params).toContain(true);
    expect(params).toContain('active');
    expect(params).toContain('pending');
  });

  it('OR 필터 최대 5개 → 정상 동작', () => {
    const orFilters: [string, '==', number][] = Array.from(
      { length: 5 },
      (_, i) => ['views', '==', i],
    );
    const { sql } = buildListQuery('posts', { orFilters });
    const orMatches = sql.match(/ OR /g);
    expect(orMatches?.length).toBe(4); // 5 conditions → 4 OR connectors
  });

  it('OR 필터 내 다른 연산자 혼합 (==, >, contains)', () => {
    const { sql, params } = buildListQuery('posts', {
      orFilters: [
        ['status', '==', 'active'],
        ['views', '>', 1000],
        ['title', 'contains', 'featured'],
      ],
    });
    expect(sql).toContain('"status" = ?');
    expect(sql).toContain('"views" > ?');
    expect(sql).toContain('INSTR("title", ?) > 0');
    expect(sql).toContain('OR');
    expect(params).toContain('active');
    expect(params).toContain(1000);
    expect(params).toContain('featured');
  });

  it('AND 필터 2개 + OR 필터 2개 + cursor 결합', () => {
    const { sql, params } = buildListQuery('posts', {
      filters: [['isPublished', '==', true], ['views', '>=', 50]],
      orFilters: [['category', '==', 'tech'], ['category', '==', 'science']],
      pagination: { after: 'cursor-abc' },
    });
    expect(sql).toContain('"isPublished" = ?');
    expect(sql).toContain('"views" >= ?');
    expect(sql).toContain('OR');
    expect(sql).toContain('"id" > ?');
    expect(params).toContain(true);
    expect(params).toContain(50);
    expect(params).toContain('cursor-abc');
  });

  it('OR 필터 괄호로 묶임 → (... OR ...)', () => {
    const { sql } = buildListQuery('posts', {
      orFilters: [['a', '==', 1], ['b', '==', 2]],
    });
    // The OR group should be wrapped in parens
    expect(sql).toMatch(/\("a" = \? OR "b" = \?\)/);
  });
});

// ─── 10. orderBy ASC/DESC 확장 ──────────────────────────────────────────────

describe('1-04 query — orderBy 확장', () => {
  it('다중 정렬 — 2개 필드', () => {
    const { sql } = buildListQuery('posts', {
      sort: [
        { field: 'isPublished', direction: 'desc' },
        { field: 'views', direction: 'asc' },
      ],
    });
    expect(sql).toContain('"isPublished" DESC, "views" ASC');
  });

  it('다중 정렬 — 3개 필드', () => {
    const { sql } = buildListQuery('posts', {
      sort: [
        { field: 'isPublished', direction: 'desc' },
        { field: 'createdAt', direction: 'desc' },
        { field: 'title', direction: 'asc' },
      ],
    });
    expect(sql).toContain('"isPublished" DESC, "createdAt" DESC, "title" ASC');
  });

  it('정렬 없을 때 기본값 "id" ASC', () => {
    const { sql } = buildListQuery('posts', {});
    expect(sql).toContain('ORDER BY "id" ASC');
  });

  it('before cursor 시 기본 정렬 "id" DESC', () => {
    const { sql } = buildListQuery('posts', { pagination: { before: 'x' } });
    expect(sql).toContain('"id" DESC');
  });

  it('sort 지정 + before cursor → sort 우선 + id tiebreaker', () => {
    const { sql } = buildListQuery('posts', {
      sort: [{ field: 'views', direction: 'asc' }],
      pagination: { before: 'x' },
    });
    expect(sql).toContain('"views" ASC');
    // Cursor pagination adds "id" as tiebreaker for deterministic keyset pagination
    expect(sql).toContain('"id" DESC');
  });

  it('sort 지정 + after cursor → id ASC tiebreaker 추가', () => {
    const { sql } = buildListQuery('posts', {
      sort: [{ field: 'createdAt', direction: 'asc' }],
      pagination: { after: 'cursor-abc' },
    });
    expect(sql).toContain('"createdAt" ASC, "id" ASC');
  });

  it('sort에 id 포함 시 → tiebreaker 미추가', () => {
    const { sql } = buildListQuery('posts', {
      sort: [{ field: 'id', direction: 'asc' }],
      pagination: { after: 'cursor-abc' },
    });
    // id is already in sort — no duplicate tiebreaker
    expect(sql).toBe('SELECT "posts".* FROM "posts" WHERE "id" > ? ORDER BY "id" ASC LIMIT ?');
  });
});

// ─── 11. limit 엣지 케이스 ──────────────────────────────────────────────────

describe('1-04 query — limit 엣지 케이스', () => {
  it('limit=1', () => {
    const { params } = buildListQuery('posts', { pagination: { limit: 1 } });
    expect(params).toContain(1);
  });

  it('limit=100', () => {
    const { params } = buildListQuery('posts', { pagination: { limit: 100 } });
    expect(params).toContain(100);
  });

  it('perPage 사용 → limit 역할', () => {
    const { params } = buildListQuery('posts', { pagination: { perPage: 15 } });
    expect(params).toContain(15);
  });

  it('page + perPage → offset 자동 계산 (page=3, perPage=10 → offset=20)', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { page: 3, perPage: 10 } });
    expect(sql).toContain('LIMIT ? OFFSET ?');
    expect(params).toContain(10);
    expect(params).toContain(20);
  });

  it('page=1 → offset=0', () => {
    const { params } = buildListQuery('posts', { pagination: { page: 1, perPage: 10 } });
    expect(params).toContain(0); // (1 - 1) * 10 = 0
  });
});

// ─── 12. offset 엣지 케이스 ─────────────────────────────────────────────────

describe('1-04 query — offset 엣지 케이스', () => {
  it('offset=0 → SQL에 OFFSET 0 포함', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { limit: 10, offset: 0 } });
    expect(sql).toContain('OFFSET ?');
    expect(params).toContain(0);
  });

  it('큰 offset 값', () => {
    const { params } = buildListQuery('posts', { pagination: { limit: 10, offset: 1000 } });
    expect(params).toContain(1000);
  });

  it('cursor 사용 시 offset 무시됨 (after)', () => {
    const { sql } = buildListQuery('posts', {
      pagination: { after: 'some-cursor', limit: 10 },
    });
    expect(sql).not.toContain('OFFSET');
  });

  it('cursor 사용 시 offset 무시됨 (before)', () => {
    const { sql } = buildListQuery('posts', {
      pagination: { before: 'some-cursor', limit: 10 },
    });
    expect(sql).not.toContain('OFFSET');
  });
});

// ─── 13. cursor after/before 확장 ───────────────────────────────────────────

describe('1-04 query — cursor 확장', () => {
  it('after + limit 조합', () => {
    const { sql, params } = buildListQuery('posts', {
      pagination: { after: 'uuid-abc', limit: 5 },
    });
    expect(sql).toContain('"id" > ?');
    expect(sql).toContain('LIMIT ?');
    expect(params).toContain('uuid-abc');
    expect(params).toContain(5);
  });

  it('before + limit 조합', () => {
    const { sql, params } = buildListQuery('posts', {
      pagination: { before: 'uuid-xyz', limit: 5 },
    });
    expect(sql).toContain('"id" < ?');
    expect(sql).toContain('LIMIT ?');
    expect(params).toContain('uuid-xyz');
    expect(params).toContain(5);
  });

  it('after + 필터 결합', () => {
    const { sql, params } = buildListQuery('posts', {
      filters: [['isPublished', '==', true]],
      pagination: { after: 'cursor-abc' },
    });
    expect(sql).toContain('"isPublished" = ?');
    expect(sql).toContain('"id" > ?');
    expect(sql).toContain('AND');
    expect(params).toContain(true);
    expect(params).toContain('cursor-abc');
  });

  it('before 시 countSql 없음', () => {
    const { countSql } = buildListQuery('posts', { pagination: { before: 'cursor-xyz' } });
    expect(countSql).toBeUndefined();
  });

  it('cursor 없이 offset → countSql 존재', () => {
    const { countSql } = buildListQuery('posts', { pagination: { limit: 10, offset: 5 } });
    expect(countSql).toBeDefined();
    expect(countSql).toContain('SELECT COUNT(*)');
  });
});

// ─── 14. buildCountQuery 확장 ───────────────────────────────────────────────

describe('1-04 query — buildCountQuery 확장', () => {
  it('다중 AND 필터 카운트', () => {
    const { sql, params } = buildCountQuery('posts', [
      ['isPublished', '==', true],
      ['views', '>', 10],
    ]);
    expect(sql).toContain('"isPublished" = ?');
    expect(sql).toContain('"views" > ?');
    expect(sql).toContain('AND');
    expect(params).toContain(true);
    expect(params).toContain(10);
  });

  it('OR 필터 카운트', () => {
    const { sql } = buildCountQuery(
      'posts',
      undefined,
      [['status', '==', 'active'], ['status', '==', 'pending']],
    );
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain('OR');
  });

  it('AND + OR 필터 카운트', () => {
    const { sql, params } = buildCountQuery(
      'posts',
      [['isPublished', '==', true]],
      [['category', '==', 'tech'], ['category', '==', 'science']],
    );
    expect(sql).toContain('"isPublished" = ?');
    expect(sql).toContain('OR');
    expect(params).toContain(true);
    expect(params).toContain('tech');
    expect(params).toContain('science');
  });

  it('contains 필터 카운트', () => {
    const { sql, params } = buildCountQuery('posts', [['title', 'contains', 'hello']]);
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain('INSTR("title", ?) > 0');
    expect(params).toContain('hello');
  });
});

// ─── 15. buildSearchQuery FTS 확장 ──────────────────────────────────────────

describe('1-04 query — buildSearchQuery 확장', () => {
  it('한국어/CJK 검색어', () => {
    const { sql, params } = buildSearchQuery('posts', '한글 검색');
    expect(sql).toContain('posts_fts');
    expect(sql).toContain('MATCH ?');
    expect(params[0]).toBe('"한글"* "검색"*');
  });

  it('일본어 검색어', () => {
    const { params } = buildSearchQuery('posts', '東京タワー');
    expect(params[0]).toBe('"東京タワー"*');
  });

  it('중국어 검색어', () => {
    const { params } = buildSearchQuery('posts', '你好世界');
    expect(params[0]).toBe('"你好世界"*');
  });

  it('highlightPre/Post 커스텀 — <em>/<strong>', () => {
    const { sql } = buildSearchQuery('posts', 'test', {
      ftsFields: ['title'],
      highlightPre: '<em>',
      highlightPost: '</em>',
    });
    expect(sql).toContain('<em>');
    expect(sql).toContain('</em>');
  });

  it('highlightPre/Post 기본값 — <mark>/</ mark>', () => {
    const { sql } = buildSearchQuery('posts', 'test', {
      ftsFields: ['title'],
    });
    expect(sql).toContain('<mark>');
    expect(sql).toContain('</mark>');
  });

  it('ftsFields 여러 필드 → 여러 highlight 컬럼', () => {
    const { sql } = buildSearchQuery('posts', 'test', {
      ftsFields: ['title', 'content', 'summary'],
      highlightPre: '<b>',
      highlightPost: '</b>',
    });
    expect(sql).toContain('title_highlighted');
    expect(sql).toContain('content_highlighted');
    expect(sql).toContain('summary_highlighted');
  });

  it('ftsFields 없으면 highlight 컬럼 없음', () => {
    const { sql } = buildSearchQuery('posts', 'test');
    expect(sql).not.toContain('highlight(');
    expect(sql).not.toContain('_highlighted');
  });

  it('FTS join 구조 — posts_fts JOIN posts ON rowid', () => {
    const { sql } = buildSearchQuery('posts', 'term');
    expect(sql).toContain('FROM "posts_fts"');
    expect(sql).toContain('JOIN "posts" ON "posts".rowid = "posts_fts".rowid');
  });

  it('FTS rank 정렬', () => {
    const { sql } = buildSearchQuery('posts', 'term');
    expect(sql).toContain('ORDER BY "posts_fts".rank');
  });

  it('특수문자 검색어 — 하이픈, 별표 → 리터럴 매칭', () => {
    const { params } = buildSearchQuery('posts', 'hello-world*test');
    expect(params[0]).toBe('"hello-world*test"*');
  });

  it('검색어 내부 쌍따옴표 → FTS5 escape 처리', () => {
    const { params } = buildSearchQuery('posts', 'say "hi" now');
    expect(params[0]).toBe('"say"* "hi"* "now"*');
  });

});

// ─── 16. buildGetQuery 확장 ─────────────────────────────────────────────────

describe('1-04 query — buildGetQuery 확장', () => {
  it('UUID 형식 id', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const { params } = buildGetQuery('posts', uuid);
    expect(params).toEqual([uuid]);
  });

  it('fields 3개 지정', () => {
    const { sql } = buildGetQuery('posts', 'id-1', ['title', 'content', 'views']);
    expect(sql).toContain('"title", "content", "views"');
  });

});

// ─── 17. parseQueryParams 확장 ──────────────────────────────────────────────

describe('1-04 query — parseQueryParams 확장', () => {
  it('before cursor 파싱', () => {
    const opts = parseQueryParams({ before: 'cursor-xyz' });
    expect(opts.pagination?.before).toBe('cursor-xyz');
  });

  it('page 파싱', () => {
    const opts = parseQueryParams({ page: '3' });
    expect(opts.pagination?.page).toBe(3);
  });

  it('perPage 파싱', () => {
    const opts = parseQueryParams({ perPage: '25' });
    expect(opts.pagination?.perPage).toBe(25);
  });

  it('sort 단일 필드 — 방향 미지정 시 기본 asc', () => {
    const opts = parseQueryParams({ sort: 'views' });
    expect(opts.sort?.[0]).toEqual({ field: 'views', direction: 'asc' });
  });

  it('잘못된 orFilter JSON → 무시', () => {
    const opts = parseQueryParams({ orFilter: 'not valid json' });
    expect(opts.orFilters).toBeUndefined();
  });

  it('orFilter 6개 초과 시 무시 (파싱 단계에서 5개 제한)', () => {
    const orFilter = JSON.stringify(
      Array.from({ length: 6 }, (_, i) => ['f', '==', i]),
    );
    const opts = parseQueryParams({ orFilter });
    // parseQueryParams silently drops orFilter > 5 items
    expect(opts.orFilters).toBeUndefined();
  });

  it('모든 파라미터 동시 파싱', () => {
    const opts = parseQueryParams({
      limit: '10',
      offset: '5',
      sort: 'views:desc',
      filter: JSON.stringify([['isPublished', '==', true]]),
      fields: 'title,content',
      search: 'hello',
    });
    expect(opts.pagination?.limit).toBe(10);
    expect(opts.pagination?.offset).toBe(5);
    expect(opts.sort?.[0]).toEqual({ field: 'views', direction: 'desc' });
    expect(opts.filters?.[0]).toEqual(['isPublished', '==', true]);
    expect(opts.fields).toEqual(['title', 'content']);
    expect(opts.search).toBe('hello');
  });

  it('search 파라미터만 사용', () => {
    const opts = parseQueryParams({ search: 'first' });
    expect(opts.search).toBe('first');
  });

  it('fields 공백 트림', () => {
    const opts = parseQueryParams({ fields: ' title , content , views ' });
    expect(opts.fields).toEqual(['title', 'content', 'views']);
  });
});

// ─── 18. 테이블명/필드명 이스케이프 ─────────────────────────────────────────

describe('1-04 query — SQL 이스케이프 안전성', () => {
  it('테이블명에 쌍따옴표 포함 → 이스케이프', () => {
    const { sql } = buildListQuery('my"table', {});
    expect(sql).toContain('"my""table"');
  });

  it('필드명에 쌍따옴표 포함 → 이스케이프', () => {
    const { sql } = buildListQuery('posts', {
      filters: [['field"name', '==', 'val']],
    });
    expect(sql).toContain('"field""name"');
  });

  it('fields 선택에서 특수문자 이스케이프', () => {
    const { sql } = buildListQuery('posts', { fields: ['my"field', 'normal'] });
    expect(sql).toContain('"my""field"');
    expect(sql).toContain('"normal"');
  });

  it('sort 필드에서 특수문자 이스케이프', () => {
    const { sql } = buildListQuery('posts', {
      sort: [{ field: 'my"col', direction: 'asc' }],
    });
    expect(sql).toContain('"my""col" ASC');
  });
});

// ─── 19. countSql / countParams 상세 검증 ───────────────────────────────────

describe('1-04 query — countSql/countParams 상세', () => {
  it('필터 없을 때 countParams 빈 배열', () => {
    const { countParams } = buildListQuery('posts', {});
    expect(countParams).toEqual([]);
  });

  it('필터 있을 때 countParams에 필터 값 포함', () => {
    const { countParams } = buildListQuery('posts', {
      filters: [['isPublished', '==', true]],
    });
    expect(countParams).toContain(true);
  });

  it('countSql에 LIMIT/OFFSET 없음', () => {
    const { countSql } = buildListQuery('posts', {
      pagination: { limit: 10, offset: 5 },
    });
    expect(countSql).not.toContain('LIMIT');
    expect(countSql).not.toContain('OFFSET');
  });

  it('countSql에 ORDER BY 없음', () => {
    const { countSql } = buildListQuery('posts', {
      sort: [{ field: 'views', direction: 'desc' }],
    });
    expect(countSql).not.toContain('ORDER BY');
  });

  it('countSql에 cursor 조건 없음 (필터만 포함)', () => {
    // After cursor → countSql is undefined, so use offset pagination with filter
    const { countSql, countParams } = buildListQuery('posts', {
      filters: [['views', '>', 100]],
      pagination: { limit: 10, offset: 0 },
    });
    expect(countSql).toContain('"views" > ?');
    expect(countParams).toContain(100);
  });
});
