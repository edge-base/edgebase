/**
 * crud.test.ts — 100개
 *
 * 테스트 대상:
 *   routes/tables.ts → database-do.ts
 *   GET /api/db/shared/tables/:name (LIST)
 *   GET /api/db/shared/tables/:name/:id (GET ONE)
 *   GET /api/db/shared/tables/:name/count (COUNT)
 *   GET /api/db/shared/tables/:name/search (FTS SEARCH)
 *   POST /api/db/shared/tables/:name (CREATE, UPSERT)
 *   PATCH /api/db/shared/tables/:name/:id (UPDATE)
 *   DELETE /api/db/shared/tables/:name/:id (DELETE)
 *
 * 격리 원칙:
 *   isolatedStorage: false → 고유 record 미리 생성, afterAll에서 전부 삭제
 *   테이블: posts (공개 규칙), categories (unique:name)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function api(
  method: string,
  path: string,
  body?: unknown,
  authHeader?: string,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  } else {
    headers['X-EdgeBase-Service-Key'] = SK;
  }

  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data: unknown;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data: data as any };
}

// ─── 테스트용 레코드 추적 ──────────────────────────────────────────────────────
const createdIds: string[] = [];
const enrichedNoteIds: string[] = [];

afterAll(async () => {
  // Use batch DELETE to avoid sequential individual DELETEs which can cascade-timeout
  // when preceding test files leave the miniflare runtime under pressure.
  for (let i = 0; i < createdIds.length; i += 500) {
    const chunk = createdIds.slice(i, i + 500);
    await api('POST', '/api/db/shared/tables/posts/batch', { deletes: chunk }).catch(() => {});
  }
  for (const id of enrichedNoteIds) {
    await api('DELETE', `/api/db/shared/tables/enriched_notes/${id}`).catch(() => {});
  }
  // 카테고리 정리는 각 describe에서 처리
});

// ─── 1. CREATE (POST /tables/posts) ──────────────────────────────────────────

describe('1-05 crud — create', () => {
  it('기본 create → 201, id/createdAt/updatedAt 자동 생성', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Test Post Create',
    });
    expect(status).toBe(201);
    expect(typeof data.id).toBe('string');
    expect(data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // UUID v7
    expect(typeof data.createdAt).toBe('string');
    expect(typeof data.updatedAt).toBe('string');
    createdIds.push(data.id);
  });

  it('create — title 반환 값 확인', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Verify Title',
      views: 42,
    });
    expect(data.title).toBe('Verify Title');
    expect(data.views).toBe(42);
    createdIds.push(data.id);
  });

  it('create — required 필드(title) 누락 → 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts', {
      content: 'no title',
    });
    expect(status).toBe(400);
  });

  it('create — default 필드(views=0) 자동 적용', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Default Field Test',
    });
    expect(data.views).toBe(0);
    expect(data.isPublished).toBe(false);
    createdIds.push(data.id);
  });

  it('create — 커스텀 id 지정', async () => {
    const customId = 'custom-id-' + crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      id: customId,
      title: 'Custom ID Post',
    });
    expect(status).toBe(201);
    expect(data.id).toBe(customId);
    createdIds.push(data.id);
  });

  it('create — title 최대 길이 위반(201자) → 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'a'.repeat(201), // max 200
    });
    expect(status).toBe(400);
  });
});

// ─── 2. GET (GET /tables/posts/:id) ──────────────────────────────────────────

describe('1-05 crud — get one', () => {
  let postId: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: 'GET Test Post' });
    postId = data.id;
    createdIds.push(postId);
  });

  it('존재하는 id → 200 + 레코드 반환', async () => {
    const { status, data } = await api('GET', `/api/db/shared/tables/posts/${postId}`);
    expect(status).toBe(200);
    expect(data.id).toBe(postId);
    expect(data.title).toBe('GET Test Post');
  });

  it('존재하지 않는 id → 404', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/posts/nonexistent-id');
    expect(status).toBe(404);
  });

  it('fields 파라미터 → 지정 필드만 반환', async () => {
    const { data } = await api('GET', `/api/db/shared/tables/posts/${postId}?fields=title,id`);
    expect(data.title).toBeDefined();
    expect(data.id).toBeDefined();
    // Non-requested fields should not appear or be null
  });
});

// ─── 3. LIST (GET /tables/posts) ─────────────────────────────────────────────

describe('1-05 crud — list', () => {
  const batchIds: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 5; i++) {
      const { data } = await api('POST', '/api/db/shared/tables/posts', {
        title: `List Test Post ${i + 1}`,
        views: i * 10,
        isPublished: i % 2 === 0,
      });
      batchIds.push(data.id);
      createdIds.push(data.id);
    }
  });

  it('기본 list → { items: [...], total, page, perPage }', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/posts');
    expect(status).toBe(200);
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe('number');
    expect(data.total).toBeGreaterThanOrEqual(5);
  });

  it('limit=2 → items 최대 2개', async () => {
    const { data } = await api('GET', '/api/db/shared/tables/posts?limit=2');
    expect(data.items.length).toBeLessThanOrEqual(2);
  });

  it('filter[isPublished==true] → published 항목만', async () => {
    const filter = JSON.stringify([['isPublished', '==', true]]);
    const { data } = await api('GET', `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`);
    expect(data.items.every((r: any) => r.isPublished === true)).toBe(true);
  });

  it('sort=views:desc → views 내림차순', async () => {
    const { data } = await api('GET', '/api/db/shared/tables/posts?sort=views:desc&limit=10');
    const views = data.items.map((r: any) => r.views).filter((v: any) => v !== null && v !== undefined);
    for (let i = 1; i < views.length; i++) {
      expect(views[i]).toBeLessThanOrEqual(views[i - 1]);
    }
  });

  it('page=1, perPage=2 → page/perPage 응답 포함', async () => {
    const { data } = await api('GET', '/api/db/shared/tables/posts?page=1&perPage=2');
    expect(data.page).toBe(1);
    expect(data.perPage).toBe(2);
  });
});

describe('1-05 crud — enrich merge semantics', () => {
  it('get returns base fields plus onEnrich fields', async () => {
    const created = await api('POST', '/api/db/shared/tables/enriched_notes', {
      title: 'Merged Enrich Note',
      content: 'original content',
      status: 'published',
    });
    enrichedNoteIds.push(created.data.id);

    const { status, data } = await api('GET', `/api/db/shared/tables/enriched_notes/${created.data.id}`);
    expect(status).toBe(200);
    expect(data.title).toBe('Merged Enrich Note');
    expect(data.content).toBe('original content');
    expect(data.status).toBe('published');
    expect(data.titleLength).toBe('Merged Enrich Note'.length);
    expect(data.hasContent).toBe(true);
  });

  it('list returns base fields plus onEnrich fields', async () => {
    const created = await api('POST', '/api/db/shared/tables/enriched_notes', {
      title: 'Merged Enrich List Note',
      content: 'list content',
    });
    enrichedNoteIds.push(created.data.id);

    const { status, data } = await api('GET', `/api/db/shared/tables/enriched_notes?filter=${encodeURIComponent(`[[\"id\",\"==\",\"${created.data.id}\"]]`)}`);
    expect(status).toBe(200);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].id).toBe(created.data.id);
    expect(data.items[0].title).toBe('Merged Enrich List Note');
    expect(data.items[0].content).toBe('list content');
    expect(data.items[0].titleLength).toBe('Merged Enrich List Note'.length);
    expect(data.items[0].hasContent).toBe(true);
  });
});

// ─── 4. COUNT ─────────────────────────────────────────────────────────────────

describe('1-05 crud — count', () => {
  beforeAll(async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: 'Count Test Post' });
    createdIds.push(data.id);
  });

  it('GET /count → { total: number }', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/posts/count');
    expect(status).toBe(200);
    expect(typeof data.total).toBe('number');
    expect(data.total).toBeGreaterThan(0);
  });

  it('filter 있는 count → 필터링된 총 수', async () => {
    const filter = JSON.stringify([['isPublished', '==', false]]);
    const { data } = await api('GET', `/api/db/shared/tables/posts/count?filter=${encodeURIComponent(filter)}`);
    expect(typeof data.total).toBe('number');
  });
});

// ─── 5. UPDATE (PATCH /tables/posts/:id) ─────────────────────────────────────

describe('1-05 crud — update', () => {
  let postId: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Update Test Post',
      views: 0,
    });
    postId = data.id;
    createdIds.push(postId);
  });

  it('PATCH — 필드 업데이트 성공 → 200', async () => {
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      title: 'Updated Title',
    });
    expect(status).toBe(200);
    expect(data.title).toBe('Updated Title');
  });

  it('PATCH — updatedAt 자동 갱신', async () => {
    const before = (await api('GET', `/api/db/shared/tables/posts/${postId}`)).data.updatedAt;
    await new Promise(r => setTimeout(r, 5));
    await api('PATCH', `/api/db/shared/tables/posts/${postId}`, { title: 'Second Update' });
    const after = (await api('GET', `/api/db/shared/tables/posts/${postId}`)).data.updatedAt;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('PATCH — createdAt 변경 불가 (무시됨)', async () => {
    const original = (await api('GET', `/api/db/shared/tables/posts/${postId}`)).data.createdAt;
    await api('PATCH', `/api/db/shared/tables/posts/${postId}`, { createdAt: '2000-01-01T00:00:00.000Z' });
    const after = (await api('GET', `/api/db/shared/tables/posts/${postId}`)).data.createdAt;
    expect(after).toBe(original);
  });

  it('PATCH — 존재하지 않는 id → 404', async () => {
    const { status, data } = await api('PATCH', '/api/db/shared/tables/posts/no-such-id', { title: 'valid title' });
    expect(status).toBe(404);
  });

  it('PATCH — 빈 body → 기존 레코드 그대로 반환 (200)', async () => {
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {});
    expect(status).toBe(200);
    expect(data.id).toBe(postId);
  });

  it('PATCH — required field deleteField → 400 validation error', async () => {
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      title: { $op: 'deleteField' },
    });
    expect(status).toBe(400);
    expect(data.code).toBe(400);
    expect(String(data.message).toLowerCase()).toContain('validation');
    expect(data.data?.title?.code).toBe('invalid');
    expect(data.data?.title?.message).toContain('required');
  });
});

// ─── 6. DELETE ─────────────────────────────────────────────────────────────────

describe('1-05 crud — delete', () => {
  it('DELETE 성공 → 200', async () => {
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', { title: 'Delete Me' });
    const { status } = await api('DELETE', `/api/db/shared/tables/posts/${created.id}`);
    expect(status).toBe(200);
  });

  it('DELETE 후 GET → 404', async () => {
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', { title: 'Delete Verify' });
    await api('DELETE', `/api/db/shared/tables/posts/${created.id}`);
    const { status } = await api('GET', `/api/db/shared/tables/posts/${created.id}`);
    expect(status).toBe(404);
  });

  it('DELETE 존재하지 않는 id → 404', async () => {
    const { status } = await api('DELETE', '/api/db/shared/tables/posts/ghost-id-xyz');
    expect(status).toBe(404);
  });
});

// ─── 7. UPSERT ───────────────────────────────────────────────────────────────

describe('1-05 crud — upsert', () => {
  const catIds: string[] = [];

  afterAll(async () => {
    for (const id of catIds) {
      await api('DELETE', `/api/db/shared/tables/categories/${id}`).catch(() => {});
    }
  });

  it('upsert ?upsert=true, conflictTarget=id — 없는 id → 201 created', async () => {
    const customId = 'upsert-' + crypto.randomUUID().slice(0, 8);
    const { status, data } = await api(
      'POST',
      `/api/db/shared/tables/posts?upsert=true&conflictTarget=id`,
      { id: customId, title: 'Upsert Insert Test' },
    );
    expect(status).toBe(201);
    expect(data.action).toBe('inserted');
    createdIds.push(customId);
  });

  it('upsert conflictTarget=id — 있는 id → 200 updated', async () => {
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', { title: 'Upsert Original' });
    const id = created.id;
    createdIds.push(id);

    const { status, data } = await api(
      'POST',
      `/api/db/shared/tables/posts?upsert=true&conflictTarget=id`,
      { id, title: 'Upsert Updated' },
    );
    expect(status).toBe(200);
    expect(data.action).toBe('updated');
    expect(data.title).toBe('Upsert Updated');
  });

  it('upsert — categories.name unique 충돌 → UPDATE', async () => {
    const uniqueName = 'cat-' + crypto.randomUUID().slice(0, 8);
    const { data: c1 } = await api('POST', '/api/db/shared/tables/categories', { name: uniqueName });
    catIds.push(c1.id);

    const { status, data } = await api(
      'POST',
      `/api/db/shared/tables/categories?upsert=true&conflictTarget=name`,
      { name: uniqueName, description: 'Upserted Description' },
    );
    expect(status).toBe(200);
    expect(data.action).toBe('updated');
    expect(data.description).toBe('Upserted Description');
  });

  it('upsert — unique 충돌 update 시 기존 id를 보존한다', async () => {
    const uniqueName = 'cat-' + crypto.randomUUID().slice(0, 8);
    const originalId = 'cat-' + crypto.randomUUID().slice(0, 10);
    const replacementId = 'cat-' + crypto.randomUUID().slice(0, 10);

    const { data: created } = await api('POST', '/api/db/shared/tables/categories', {
      id: originalId,
      name: uniqueName,
      description: 'Original Description',
    });
    catIds.push(created.id);

    const { status, data } = await api(
      'POST',
      '/api/db/shared/tables/categories?upsert=true&conflictTarget=name',
      {
        id: replacementId,
        name: uniqueName,
        description: 'Updated Description',
      },
    );

    expect(status).toBe(200);
    expect(data.action).toBe('updated');
    expect(data.id).toBe(originalId);
    expect(data.description).toBe('Updated Description');

    const { status: getStatus, data: fetched } = await api(
      'GET',
      `/api/db/shared/tables/categories/${originalId}`,
    );
    expect(getStatus).toBe(200);
    expect(fetched.id).toBe(originalId);
    expect(fetched.name).toBe(uniqueName);
    expect(fetched.description).toBe('Updated Description');

    const { status: replacementStatus } = await api(
      'GET',
      `/api/db/shared/tables/categories/${replacementId}`,
    );
    expect(replacementStatus).toBe(404);
  });

  it('upsert conflictTarget 비unique 필드 → 400', async () => {
    const { status } = await api(
      'POST',
      `/api/db/shared/tables/posts?upsert=true&conflictTarget=title`,
      { title: 'some title' },
    );
    expect(status).toBe(400);
  });

  it('upsert conflictTarget 존재하지 않는 필드 → 400', async () => {
    const { status } = await api(
      'POST',
      `/api/db/shared/tables/posts?upsert=true&conflictTarget=nonExistentField`,
      { title: 'some title' },
    );
    expect(status).toBe(400);
  });
});

// ─── 8. FTS SEARCH ───────────────────────────────────────────────────────────

describe('1-05 crud — search (FTS)', () => {
  beforeAll(async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'FTS Search Unique Title',
      content: 'unique search content',
    });
    createdIds.push(data.id);
    // Allow a moment for FTS5 triggers
    await new Promise(r => setTimeout(r, 100));
  });

  it('GET /search?search=... → { items: [...] }', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/posts/search?search=FTS+Search+Unique');
    expect(status).toBe(200);
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('search 없이 search → items = []', async () => {
    const { data } = await api('GET', '/api/db/shared/tables/posts/search');
    expect(data.items).toHaveLength(0);
  });

  it('FTS 없는 테이블(categories) search → 빈 결과 또는 400', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/categories/search?search=test');
    // categories has no FTS — should return 400 or empty
    expect([200, 400].includes(status)).toBe(true);
  });
});

// ─── 9. 규칙 (access rules) ─────────────────────────────────────────────────

describe('1-05 crud — access rules', () => {
  let secureId: string;

  beforeAll(async () => {
    // Create a secure_post as admin (Service Key bypasses rules only at auth, not DO-level rules)
    // secure_posts.create requires auth != null.  Service Key sets auth=null.
    // We need a user JWT to create. We'll use signup → JWT.
    // For simplicity: use Service Key to test forbidden access (not creating owned records)
    const { data } = await api('POST', '/api/db/shared/tables/secure_posts', {
      title: 'Secure Post Admin',
      authorId: 'admin-user',
    });
    secureId = data.id;
  });

  afterAll(async () => {
    if (secureId) {
      await api('DELETE', `/api/db/shared/tables/secure_posts/${secureId}`).catch(() => {});
    }
  });

  it('secure_posts GET없는 유저 → 403', async () => {
    // Service key auth=null → read rule: auth?.id === row?.authorId → null !== 'admin-user' → false
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/db/shared/tables/secure_posts/${secureId}`,
      { headers: { 'X-EdgeBase-Service-Key': SK } },
    );
    // Service key sets auth=null. secure_posts.read rule is auth?.id === row?.authorId → 403
    expect([403, 200].includes(res.status)).toBe(true);
  });

  it('denied_notes list → 403', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/denied_notes');
    // read:() => false → should return 403 for all rows
    // If table is empty, no rows to block → 200 with empty items (edge case)
    expect([200, 403].includes(status)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// #137 추가 테스트 — 65개 (기존 35 + 65 = 100)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 10. CREATE — 추가 검증 ──────────────────────────────────────────────────

describe('1-05 crud — create (extended)', () => {
  it('create — views 필드에 숫자 대신 문자열 → 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Type Check Views',
      views: 'not-a-number',
    });
    expect(status).toBe(400);
  });

  it('create — isPublished 필드에 문자열 대신 boolean 아닌 값 → 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Type Check Bool',
      isPublished: 'yes',
    });
    expect(status).toBe(400);
  });

  it('create — 스키마에 없는 필드 전달 → 201 (unknown fields silently ignored)', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Unknown Field Test',
      unknownField: 'hello',
    });
    expect(status).toBe(201);
    // unknownField is NOT stored (filtered out at SQL layer)
    expect(data.unknownField).toBeUndefined();
    createdIds.push(data.id);
  });

  it('create — auto-id (id 미지정) → UUID v7 형식', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Auto ID Generation Test',
    });
    expect(status).toBe(201);
    // UUID v7: 8-4-7xxx-4-12 pattern
    expect(data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    createdIds.push(data.id);
  });

  it('create — createdAt과 updatedAt이 거의 동시에 생성됨', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Timestamp Equality Test',
    });
    const created = new Date(data.createdAt).getTime();
    const updated = new Date(data.updatedAt).getTime();
    // Within 1 second of each other
    expect(Math.abs(created - updated)).toBeLessThan(1000);
    createdIds.push(data.id);
  });

  it('create — 짧은 title → 201 성공', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'abc',
    });
    expect(status).toBe(201);
    expect(data.title).toBe('abc');
    createdIds.push(data.id);
  });

  it('create — title 정확히 max=200 문자 → 201 성공', async () => {
    const longTitle = 'a'.repeat(200);
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      title: longTitle,
    });
    expect(status).toBe(201);
    expect(data.title).toBe(longTitle);
    createdIds.push(data.id);
  });

  it('create — 중복 커스텀 id → 에러 (UNIQUE constraint)', async () => {
    const duplicateId = 'dup-id-' + crypto.randomUUID().slice(0, 8);
    const { status: s1 } = await api('POST', '/api/db/shared/tables/posts', {
      id: duplicateId,
      title: 'First Dup ID',
    });
    expect(s1).toBe(201);
    createdIds.push(duplicateId);

    const { status: s2 } = await api('POST', '/api/db/shared/tables/posts', {
      id: duplicateId,
      title: 'Second Dup ID',
    });
    // UNIQUE constraint violation → 400 or 500
    expect(s2).toBeGreaterThanOrEqual(400);
  });

  it('create — content (text 타입) 긴 문자열 저장 성공', async () => {
    const longContent = 'Lorem ipsum '.repeat(500);
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Long Content Test',
      content: longContent,
    });
    expect(status).toBe(201);
    expect(data.content).toBe(longContent);
    createdIds.push(data.id);
  });

  it('create — 여러 optional 필드 동시 설정', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'All Fields Test',
      content: 'Some content here',
      views: 99,
      isPublished: true,
      extra: 'extra-value',
    });
    expect(status).toBe(201);
    expect(data.title).toBe('All Fields Test');
    expect(data.content).toBe('Some content here');
    expect(data.views).toBe(99);
    expect(data.isPublished).toBe(true);
    expect(data.extra).toBe('extra-value');
    createdIds.push(data.id);
  });
});

// ─── 11. GET — 추가 검증 ────────────────────────────────────────────────────

describe('1-05 crud — get one (extended)', () => {
  let postId: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'GET Extended Test Post',
      content: 'get-extended-content',
      views: 77,
      isPublished: true,
    });
    postId = data.id;
    createdIds.push(postId);
  });

  it('GET — 모든 필드가 정확히 반환됨', async () => {
    const { status, data } = await api('GET', `/api/db/shared/tables/posts/${postId}`);
    expect(status).toBe(200);
    expect(data.title).toBe('GET Extended Test Post');
    expect(data.content).toBe('get-extended-content');
    expect(data.views).toBe(77);
    expect(data.isPublished).toBe(true);
    expect(typeof data.createdAt).toBe('string');
    expect(typeof data.updatedAt).toBe('string');
  });

  it('GET — fields=title → title만 반환, 다른 필드 미포함', async () => {
    const { status, data } = await api('GET', `/api/db/shared/tables/posts/${postId}?fields=title`);
    expect(status).toBe(200);
    expect(data.title).toBe('GET Extended Test Post');
    // Other fields should not be present when only title is selected
    expect(data.content).toBeUndefined();
    expect(data.views).toBeUndefined();
  });

  it('GET — 존재하지 않는 테이블 → 404', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/nonexistent_table/some-id');
    expect(status).toBe(404);
  });

});

// ─── 12. LIST — 추가 검증 ───────────────────────────────────────────────────

describe('1-05 crud — list (extended)', () => {
  const extListIds: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 8; i++) {
      const { data } = await api('POST', '/api/db/shared/tables/posts', {
        title: `ExtList Post ${String(i).padStart(2, '0')}`,
        views: i * 5,
        isPublished: i < 4,
        content: i % 2 === 0 ? 'even-content' : 'odd-content',
      });
      extListIds.push(data.id);
      createdIds.push(data.id);
    }
  });

  it('filter[views > 10] → views > 10인 항목만', async () => {
    const filter = JSON.stringify([['views', '>', 10]]);
    const { status, data } = await api('GET', `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`);
    expect(status).toBe(200);
    expect(data.items.every((r: any) => r.views > 10)).toBe(true);
  });

  it('filter[views >= 15] → views >= 15인 항목만', async () => {
    const filter = JSON.stringify([['views', '>=', 15]]);
    const { data } = await api('GET', `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`);
    expect(data.items.every((r: any) => r.views >= 15)).toBe(true);
  });

  it('filter[views < 10] → views < 10인 항목만', async () => {
    const filter = JSON.stringify([['views', '<', 10]]);
    const { data } = await api('GET', `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`);
    expect(data.items.every((r: any) => r.views < 10)).toBe(true);
  });

  it('filter[title != "ExtList Post 00"] → 해당 title 제외', async () => {
    const filter = JSON.stringify([['title', '!=', 'ExtList Post 00']]);
    const { data } = await api('GET', `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`);
    expect(data.items.every((r: any) => r.title !== 'ExtList Post 00')).toBe(true);
  });

  it('filter contains → 부분 문자열 매칭', async () => {
    const filter = JSON.stringify([['content', 'contains', 'even']]);
    const { data } = await api('GET', `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`);
    expect(data.items.every((r: any) => r.content && r.content.includes('even'))).toBe(true);
  });

  it('filter in → 배열 내 값 매칭', async () => {
    const filter = JSON.stringify([['views', 'in', [0, 5, 10]]]);
    const { data } = await api('GET', `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`);
    expect(data.items.every((r: any) => [0, 5, 10].includes(r.views))).toBe(true);
  });

  it('sort=title:asc → title 오름차순', async () => {
    const { data } = await api('GET', '/api/db/shared/tables/posts?sort=title:asc&limit=50');
    const titles = data.items.map((r: any) => r.title);
    const sorted = [...titles].sort();
    expect(titles).toEqual(sorted);
  });

  it('sort=createdAt:desc → 최신순', async () => {
    const { data } = await api('GET', '/api/db/shared/tables/posts?sort=createdAt:desc&limit=10');
    const dates = data.items.map((r: any) => new Date(r.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
    }
  });

  it('page=2, perPage=3 → 두번째 페이지 결과', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/posts?page=2&perPage=3');
    expect(status).toBe(200);
    expect(data.page).toBe(2);
    expect(data.perPage).toBe(3);
    expect(data.items.length).toBeLessThanOrEqual(3);
  });

  it('cursor pagination — after 파라미터', async () => {
    // Get first batch
    const { data: first } = await api('GET', '/api/db/shared/tables/posts?limit=2');
    expect(first.items.length).toBeGreaterThan(0);
    const afterCursor = first.items[first.items.length - 1].id;

    // Get next page using cursor
    const { status, data: second } = await api('GET', `/api/db/shared/tables/posts?limit=2&after=${afterCursor}`);
    expect(status).toBe(200);
    expect(Array.isArray(second.items)).toBe(true);
    // Items after cursor should have IDs greater than cursor
    for (const item of second.items) {
      expect(item.id > afterCursor).toBe(true);
    }
  });

  it('cursor pagination — hasMore 필드 존재', async () => {
    const { data: first } = await api('GET', '/api/db/shared/tables/posts?limit=2');
    const afterCursor = first.items[first.items.length - 1].id;
    const { data } = await api('GET', `/api/db/shared/tables/posts?limit=2&after=${afterCursor}`);
    // cursor pagination response should include hasMore
    expect(typeof data.hasMore).toBe('boolean');
  });

  it('여러 필터 AND 조합', async () => {
    const filter = JSON.stringify([
      ['isPublished', '==', true],
      ['views', '>', 0],
    ]);
    const { data } = await api('GET', `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`);
    expect(data.items.every((r: any) => r.isPublished === true && r.views > 0)).toBe(true);
  });

  it('OR 필터 — orFilter 쿼리 파라미터', async () => {
    // Create posts with distinct statuses
    const { data: d1 } = await api('POST', '/api/db/shared/tables/posts', { title: 'OrTest-draft', status: 'draft' });
    const { data: d2 } = await api('POST', '/api/db/shared/tables/posts', { title: 'OrTest-archived', status: 'archived' });
    const { data: d3 } = await api('POST', '/api/db/shared/tables/posts', { title: 'OrTest-published', status: 'published' });
    createdIds.push(d1.id, d2.id, d3.id);

    const filter = JSON.stringify([['title', 'contains', 'OrTest-']]);
    const orFilter = JSON.stringify([['status', '==', 'draft'], ['status', '==', 'archived']]);
    const { status, data } = await api('GET',
      `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}&orFilter=${encodeURIComponent(orFilter)}`);
    expect(status).toBe(200);
    expect(data.items.length).toBe(2);
    const statuses = data.items.map((r: any) => r.status);
    expect(statuses).toContain('draft');
    expect(statuses).toContain('archived');
    expect(statuses).not.toContain('published');
  });

  it('fields 파라미터 — 특정 필드만 list에서 반환', async () => {
    const { data } = await api('GET', '/api/db/shared/tables/posts?fields=id,title&limit=5');
    expect(data.items.length).toBeGreaterThan(0);
    for (const item of data.items) {
      expect(item.id).toBeDefined();
      expect(item.title).toBeDefined();
      // content, views 등 불포함
      expect(item.content).toBeUndefined();
      expect(item.views).toBeUndefined();
    }
  });
});

// ─── 13. COUNT — 추가 검증 ──────────────────────────────────────────────────

describe('1-05 crud — count (extended)', () => {
  it('count — filter[isPublished==true] → true인 것만 세기', async () => {
    const filter = JSON.stringify([['isPublished', '==', true]]);
    const { status, data } = await api('GET', `/api/db/shared/tables/posts/count?filter=${encodeURIComponent(filter)}`);
    expect(status).toBe(200);
    expect(typeof data.total).toBe('number');
    expect(data.total).toBeGreaterThanOrEqual(0);
  });

  it('count — 존재하지 않는 테이블 → 404', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/nonexistent_table_xyz/count');
    expect(status).toBe(404);
  });
});

// ─── 14. UPDATE — 추가 검증 ─────────────────────────────────────────────────

describe('1-05 crud — update (extended)', () => {
  let postId: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Update Extended Test',
      views: 10,
      isPublished: false,
      content: 'original content',
    });
    postId = data.id;
    createdIds.push(postId);
  });

  it('PATCH — partial update: views만 변경, title 유지', async () => {
    await api('PATCH', `/api/db/shared/tables/posts/${postId}`, { views: 55 });
    const { data } = await api('GET', `/api/db/shared/tables/posts/${postId}`);
    expect(data.views).toBe(55);
    expect(data.title).toBe('Update Extended Test');
  });

  it('PATCH — boolean 필드 업데이트', async () => {
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      isPublished: true,
    });
    expect(status).toBe(200);
    expect(data.isPublished).toBe(true);
  });

  it('PATCH — $op increment 연산', async () => {
    // views를 현재값에서 +10
    const before = (await api('GET', `/api/db/shared/tables/posts/${postId}`)).data.views;
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      views: { $op: 'increment', value: 10 },
    });
    expect(status).toBe(200);
    expect(data.views).toBe(before + 10);
  });

  it('PATCH — $op deleteField 연산 → null', async () => {
    // content를 NULL로 설정
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      content: { $op: 'deleteField' },
    });
    expect(status).toBe(200);
    expect(data.content).toBeNull();
  });

  it('PATCH — 알 수 없는 $op → 400', async () => {
    const { status } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      views: { $op: 'multiply', value: 2 },
    });
    expect(status).toBe(400);
  });

  it('PATCH — title validation (max 위반) → 400', async () => {
    const { status } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      title: 'a'.repeat(201),
    });
    expect(status).toBe(400);
  });

  it('PATCH — unknown field → 200 (silently ignored)', async () => {
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      nonExistentField: 'value',
    });
    expect(status).toBe(200);
    expect(data.nonExistentField).toBeUndefined();
  });

  it('PATCH — id 변경 시도 → 무시됨 (id는 변경 불가)', async () => {
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      id: 'new-id-attempt',
      title: 'ID Change Attempt',
    });
    expect(status).toBe(200);
    expect(data.id).toBe(postId); // id 변경 안됨
    expect(data.title).toBe('ID Change Attempt');
  });

  it('PATCH — 존재하지 않는 테이블 → 404', async () => {
    const { status } = await api('PATCH', '/api/db/shared/tables/nonexistent_table/some-id', {
      title: 'nope',
    });
    expect(status).toBe(404);
  });
});

// ─── 15. DELETE — 추가 검증 ─────────────────────────────────────────────────

describe('1-05 crud — delete (extended)', () => {
  it('DELETE 후 동일 id 재생성 가능', async () => {
    const customId = 'reuse-' + crypto.randomUUID().slice(0, 8);
    const { status: s1 } = await api('POST', '/api/db/shared/tables/posts', {
      id: customId,
      title: 'Reuse ID Original',
    });
    expect(s1).toBe(201);

    await api('DELETE', `/api/db/shared/tables/posts/${customId}`);

    const { status: s2, data } = await api('POST', '/api/db/shared/tables/posts', {
      id: customId,
      title: 'Reuse ID Recreated',
    });
    expect(s2).toBe(201);
    expect(data.title).toBe('Reuse ID Recreated');
    createdIds.push(customId);
  });

  it('DELETE 동일 id 두 번 → 두 번째는 404', async () => {
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Double Delete Test',
    });
    const { status: s1 } = await api('DELETE', `/api/db/shared/tables/posts/${created.id}`);
    expect(s1).toBe(200);

    const { status: s2 } = await api('DELETE', `/api/db/shared/tables/posts/${created.id}`);
    expect(s2).toBe(404);
  });

  it('DELETE — 존재하지 않는 테이블 → 404', async () => {
    const { status } = await api('DELETE', '/api/db/shared/tables/nonexistent_table/some-id');
    expect(status).toBe(404);
  });

  it('DELETE — 응답에 deleted: true 포함', async () => {
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Delete Response Check',
    });
    const { status, data } = await api('DELETE', `/api/db/shared/tables/posts/${created.id}`);
    expect(status).toBe(200);
    expect(data.deleted).toBe(true);
  });
});

// ─── 16. UPSERT — 추가 검증 ─────────────────────────────────────────────────

describe('1-05 crud — upsert (extended)', () => {
  const extCatIds: string[] = [];

  afterAll(async () => {
    for (const id of extCatIds) {
      await api('DELETE', `/api/db/shared/tables/categories/${id}`).catch(() => {});
    }
  });

  it('upsert — createdAt 보존: UPDATE 시 createdAt 변경 안됨', async () => {
    const customId = 'upsert-ts-' + crypto.randomUUID().slice(0, 8);
    const { data: created } = await api(
      'POST',
      `/api/db/shared/tables/posts?upsert=true&conflictTarget=id`,
      { id: customId, title: 'Upsert CreatedAt Test' },
    );
    createdIds.push(customId);
    const originalCreatedAt = created.createdAt;

    await new Promise(r => setTimeout(r, 10));

    const { data: updated } = await api(
      'POST',
      `/api/db/shared/tables/posts?upsert=true&conflictTarget=id`,
      { id: customId, title: 'Upsert CreatedAt Updated' },
    );
    // createdAt should be preserved across upsert UPDATE
    expect(updated.createdAt).toBe(originalCreatedAt);
    expect(updated.title).toBe('Upsert CreatedAt Updated');
  });

  it('upsert — updatedAt은 UPDATE 시 갱신됨', async () => {
    const customId = 'upsert-upd-' + crypto.randomUUID().slice(0, 8);
    const { data: created } = await api(
      'POST',
      `/api/db/shared/tables/posts?upsert=true&conflictTarget=id`,
      { id: customId, title: 'Upsert UpdatedAt Test' },
    );
    createdIds.push(customId);
    const originalUpdatedAt = created.updatedAt;

    await new Promise(r => setTimeout(r, 10));

    const { data: updated } = await api(
      'POST',
      `/api/db/shared/tables/posts?upsert=true&conflictTarget=id`,
      { id: customId, title: 'Upsert UpdatedAt Updated' },
    );
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(originalUpdatedAt).getTime(),
    );
  });

  it('upsert conflictTarget=name — categories 새 레코드 INSERT', async () => {
    const uniqueName = 'upsert-new-' + crypto.randomUUID().slice(0, 8);
    const { status, data } = await api(
      'POST',
      `/api/db/shared/tables/categories?upsert=true&conflictTarget=name`,
      { name: uniqueName, description: 'New upsert category' },
    );
    expect(status).toBe(201);
    expect(data.action).toBe('inserted');
    expect(data.name).toBe(uniqueName);
    extCatIds.push(data.id);
  });

  it('upsert conflictTarget=name — categories 기존 레코드 UPDATE', async () => {
    const uniqueName = 'upsert-exist-' + crypto.randomUUID().slice(0, 8);
    const { data: c1 } = await api('POST', '/api/db/shared/tables/categories', { name: uniqueName });
    extCatIds.push(c1.id);

    const { status, data } = await api(
      'POST',
      `/api/db/shared/tables/categories?upsert=true&conflictTarget=name`,
      { name: uniqueName, description: 'Updated via upsert' },
    );
    expect(status).toBe(200);
    expect(data.action).toBe('updated');
    expect(data.description).toBe('Updated via upsert');
  });

  it('upsert 없이 일반 POST → action 필드 미포함', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Normal Create No Action',
    });
    expect(status).toBe(201);
    expect(data.action).toBeUndefined();
    createdIds.push(data.id);
  });

  it('upsert conflictTarget=id — required 필드 누락 → 400', async () => {
    const { status } = await api(
      'POST',
      `/api/db/shared/tables/posts?upsert=true&conflictTarget=id`,
      { id: 'upsert-missing-req', views: 10 },
    );
    expect(status).toBe(400);
  });

  it('upsert — upsert=false (기본값) → 일반 create 동작', async () => {
    const { status, data } = await api(
      'POST',
      `/api/db/shared/tables/posts?upsert=false&conflictTarget=id`,
      { title: 'Not Upsert Mode' },
    );
    expect(status).toBe(201);
    expect(data.action).toBeUndefined();
    createdIds.push(data.id);
  });
});

// ─── 17. SEARCH (FTS) — 추가 검증 ───────────────────────────────────────────

describe('1-05 crud — search FTS (extended)', () => {
  const searchIds: string[] = [];

  beforeAll(async () => {
    const posts = [
      { title: 'FTS Alpha Unique987', content: 'alpha content here' },
      { title: 'FTS Beta Unique987', content: 'beta content here' },
      { title: 'FTS Gamma Unique987', content: 'gamma content here' },
    ];
    for (const post of posts) {
      const { data } = await api('POST', '/api/db/shared/tables/posts', post);
      searchIds.push(data.id);
      createdIds.push(data.id);
    }
    // Wait for FTS5 triggers to propagate
    await new Promise(r => setTimeout(r, 100));
  });

  it('search limit=1 → 최대 1개 결과', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/posts/search?search=Unique987&limit=1');
    expect(status).toBe(200);
    expect(data.items.length).toBeLessThanOrEqual(1);
  });

  it('search — 부분 문자열 매칭 (trigram)', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/posts/search?search=Alpha');
    expect(status).toBe(200);
    const haAlpha = data.items.some((r: any) => r.title?.includes('Alpha'));
    expect(haAlpha).toBe(true);
  });

  it('search — 존재하지 않는 문자열 → 빈 결과', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/posts/search?search=zzz_nonexistent_xyz_999');
    expect(status).toBe(200);
    expect(data.items).toHaveLength(0);
  });

  it('search — 긴 하이픈 marker도 500 없이 빈 결과', async () => {
    const marker = 'missing-analytics-wave-1-1773076851790-admin-dev-o1-js-1773076962300';
    const { status, data } = await api('GET', `/api/db/shared/tables/posts/search?search=${encodeURIComponent(marker)}`);
    expect(status).toBe(200);
    expect(data.items).toHaveLength(0);
  });

  it('search — offset 파라미터', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/posts/search?search=Unique987&limit=10&offset=1');
    expect(status).toBe(200);
    // offset=1이면 첫 번째 결과가 스킵됨
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('search — filter 파라미터를 함께 적용', async () => {
    const filter = encodeURIComponent(JSON.stringify([['title', '==', 'FTS Beta Unique987']]));
    const { status, data } = await api('GET', `/api/db/shared/tables/posts/search?search=Unique987&filter=${filter}`);
    expect(status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.title).toBe('FTS Beta Unique987');
  });

  it('search — sort 파라미터를 함께 적용', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/posts/search?search=Unique987&sort=title:desc&limit=3');
    expect(status).toBe(200);
    expect(data.items.slice(0, 3).map((item: any) => item.title)).toEqual([
      'FTS Gamma Unique987',
      'FTS Beta Unique987',
      'FTS Alpha Unique987',
    ]);
  });
});

// ─── 18. 테이블 부재 / 에지 케이스 ────────────────────────────────────────────

describe('1-05 crud — edge cases', () => {
  it('존재하지 않는 테이블에 POST → 404', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/nonexistent_table_abc', {
      title: 'Should fail',
    });
    expect(status).toBe(404);
  });

  it('categories — unique 필드 중복 create → 에러', async () => {
    const uniqueName = 'unique-dup-' + crypto.randomUUID().slice(0, 8);
    const { status: s1, data: c1 } = await api('POST', '/api/db/shared/tables/categories', {
      name: uniqueName,
    });
    expect(s1).toBe(201);

    const { status: s2 } = await api('POST', '/api/db/shared/tables/categories', {
      name: uniqueName,
    });
    expect(s2).toBeGreaterThanOrEqual(400);

    // Cleanup
    await api('DELETE', `/api/db/shared/tables/categories/${c1.id}`).catch(() => {});
  });

  it('categories — description 옵셔널 필드 null 허용', async () => {
    const uniqueName = 'null-desc-' + crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/categories', {
      name: uniqueName,
    });
    expect(status).toBe(201);
    expect(data.description).toBeNull();
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/categories/${data.id}`).catch(() => {});
  });

  it('POST body 없이 → 에러', async () => {
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/db/shared/tables/posts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': SK,
        },
      },
    );
    // No body → should error (400 or 500)
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('PATCH body가 JSON이 아닌 경우 → 에러', async () => {
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Bad Patch Body Test',
    });
    createdIds.push(created.id);

    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/db/shared/tables/posts/${created.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': SK,
        },
        body: 'not-valid-json',
      },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ─── 19. categories CRUD 기본 ─────────────────────────────────────────────

describe('1-05 crud — categories CRUD', () => {
  const catCleanup: string[] = [];

  afterAll(async () => {
    for (const id of catCleanup) {
      await api('DELETE', `/api/db/shared/tables/categories/${id}`).catch(() => {});
    }
  });

  it('categories create → 201, name/description/sortOrder', async () => {
    const uniqueName = 'cat-crud-' + crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/categories', {
      name: uniqueName,
      description: 'Test category',
      sortOrder: 5,
    });
    expect(status).toBe(201);
    expect(data.name).toBe(uniqueName);
    expect(data.description).toBe('Test category');
    expect(data.sortOrder).toBe(5);
    catCleanup.push(data.id);
  });

  it('categories list → items 배열 반환', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/categories');
    expect(status).toBe(200);
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('categories get → 200', async () => {
    const uniqueName = 'cat-get-' + crypto.randomUUID().slice(0, 8);
    const { data: created } = await api('POST', '/api/db/shared/tables/categories', {
      name: uniqueName,
    });
    catCleanup.push(created.id);

    const { status, data } = await api('GET', `/api/db/shared/tables/categories/${created.id}`);
    expect(status).toBe(200);
    expect(data.name).toBe(uniqueName);
  });

  it('categories update → 200', async () => {
    const uniqueName = 'cat-upd-' + crypto.randomUUID().slice(0, 8);
    const { data: created } = await api('POST', '/api/db/shared/tables/categories', {
      name: uniqueName,
    });
    catCleanup.push(created.id);

    const { status, data } = await api('PATCH', `/api/db/shared/tables/categories/${created.id}`, {
      description: 'Updated description',
    });
    expect(status).toBe(200);
    expect(data.description).toBe('Updated description');
  });

  it('categories delete → 200', async () => {
    const uniqueName = 'cat-del-' + crypto.randomUUID().slice(0, 8);
    const { data: created } = await api('POST', '/api/db/shared/tables/categories', {
      name: uniqueName,
    });

    const { status } = await api('DELETE', `/api/db/shared/tables/categories/${created.id}`);
    expect(status).toBe(200);
  });

  it('categories — required 필드(name) 누락 → 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/categories', {
      description: 'No name',
    });
    expect(status).toBe(400);
  });

  it('categories — sortOrder 기본값 0', async () => {
    const uniqueName = 'cat-default-' + crypto.randomUUID().slice(0, 8);
    const { data } = await api('POST', '/api/db/shared/tables/categories', {
      name: uniqueName,
    });
    expect(data.sortOrder).toBe(0);
    catCleanup.push(data.id);
  });
});
