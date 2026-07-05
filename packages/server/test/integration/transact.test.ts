/**
 * transact.test.ts
 *
 * 테스트 대상: POST /api/db/shared/transact
 *
 * 대상 코드: src/durable-objects/database-do.ts (/transact 엔드포인트),
 *            src/routes/tables.ts (worker transact route)
 *   body: { operations: [{ table, op: insert|update|delete|expect, ... }] }
 *   - 여러 테이블에 걸친 쓰기를 하나의 transactionSync로 all-or-nothing 적용
 *   - expect op은 행 상태를 단언하고 불충족 시 409 + 전체 롤백
 *
 * 격리: 고유 UUID prefix, afterAll 전체 삭제
 */
import { describe, it, expect, afterAll } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function api(method: string, path: string, body?: unknown, withServiceKey = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withServiceKey) headers['X-EdgeBase-Service-Key'] = SK;
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

const createdPostIds: string[] = [];
const createdSecureIds: string[] = [];

afterAll(async () => {
  if (createdPostIds.length) {
    await api('POST', '/api/db/shared/tables/posts/batch', { deletes: createdPostIds }).catch(() => {});
  }
  if (createdSecureIds.length) {
    await api('POST', '/api/db/shared/tables/secure_posts/batch', { deletes: createdSecureIds }).catch(() => {});
  }
});

async function postCount(): Promise<number> {
  return (await api('GET', '/api/db/shared/tables/posts/count')).data.total;
}

describe('transact — cross-table atomic writes', () => {
  it('applies insert/update/delete across tables in order and returns ordered results', async () => {
    const { status, data } = await api('POST', '/api/db/shared/transact', {
      operations: [
        { table: 'posts', op: 'insert', data: { title: 'TX post A' } },
        { table: 'secure_posts', op: 'insert', data: { title: 'TX secure A', authorId: 'tx-user' } },
      ],
    });
    expect(status).toBe(200);
    expect(data.results).toHaveLength(2);
    const postId = data.results[0].inserted.id as string;
    const secureId = data.results[1].inserted.id as string;
    createdPostIds.push(postId);
    createdSecureIds.push(secureId);

    const second = await api('POST', '/api/db/shared/transact', {
      operations: [
        { table: 'posts', op: 'update', id: postId, data: { title: 'TX post A2' } },
        { table: 'secure_posts', op: 'delete', id: secureId },
      ],
    });
    expect(second.status).toBe(200);
    expect(second.data.results[0].updated.title).toBe('TX post A2');
    expect(second.data.results[1]).toMatchObject({ deleted: true, id: secureId });

    const row = await api('GET', `/api/db/shared/tables/posts/${postId}`);
    expect(row.data.title).toBe('TX post A2');
    const secureRow = await api('GET', `/api/db/shared/tables/secure_posts/${secureId}`);
    expect(secureRow.status).toBe(404);
  });

  it('rolls back every operation when a later one fails validation', async () => {
    const before = await postCount();
    const { status } = await api('POST', '/api/db/shared/transact', {
      operations: [
        { table: 'posts', op: 'insert', data: { title: 'TX rollback survivor?' } },
        { table: 'posts', op: 'insert', data: { content: 'missing required title' } },
      ],
    });
    expect(status).toBe(400);
    expect(await postCount()).toBe(before);
  });

  it('rejects unknown tables without writing anything', async () => {
    const before = await postCount();
    const { status } = await api('POST', '/api/db/shared/transact', {
      operations: [
        { table: 'posts', op: 'insert', data: { title: 'TX unknown table' } },
        { table: 'no_such_table', op: 'insert', data: { title: 'x' } },
      ],
    });
    expect(status).toBe(400);
    expect(await postCount()).toBe(before);
  });

  it('rejects malformed operations', async () => {
    expect((await api('POST', '/api/db/shared/transact', { operations: [] })).status).toBe(400);
    expect((await api('POST', '/api/db/shared/transact', {
      operations: [{ table: 'posts', op: 'upsert', data: { title: 'x' } }],
    })).status).toBe(400);
    expect((await api('POST', '/api/db/shared/transact', {
      operations: [{ table: 'posts', op: 'update', data: { title: 'x' } }],
    })).status).toBe(400);
  });

  it('enforces the 500-operation limit', async () => {
    const operations = Array.from({ length: 501 }, (_, i) => ({
      table: 'posts',
      op: 'insert',
      data: { title: `TX bulk ${i}` },
    }));
    const before = await postCount();
    const { status } = await api('POST', '/api/db/shared/transact', { operations });
    expect(status).toBe(400);
    expect(await postCount()).toBe(before);
  });
});

describe('transact — expect assertions', () => {
  it('proceeds when expect exists:true matches on id + field condition', async () => {
    const seed = await api('POST', '/api/db/shared/tables/posts', { title: 'TX expect base', status: 'active' });
    const id = seed.data.id as string;
    createdPostIds.push(id);

    const { status, data } = await api('POST', '/api/db/shared/transact', {
      operations: [
        { table: 'posts', op: 'expect', id, where: [['status', '==', 'active']], exists: true },
        { table: 'posts', op: 'update', id, data: { status: 'archived' } },
      ],
    });
    expect(status).toBe(200);
    expect(data.results[0]).toMatchObject({ expected: true });
    expect(data.results[1].updated.status).toBe('archived');
  });

  it('aborts with 409 and rolls back when expect exists:true is unmet', async () => {
    const seed = await api('POST', '/api/db/shared/tables/posts', { title: 'TX expect stale', status: 'active' });
    const id = seed.data.id as string;
    createdPostIds.push(id);

    const { status } = await api('POST', '/api/db/shared/transact', {
      operations: [
        { table: 'posts', op: 'insert', data: { title: 'TX expect rollback probe' } },
        { table: 'posts', op: 'expect', id, where: [['status', '==', 'archived']], exists: true },
      ],
    });
    expect(status).toBe(409);

    const filter = encodeURIComponent(JSON.stringify([['title', '==', 'TX expect rollback probe']]));
    const list = await api('GET', `/api/db/shared/tables/posts?filter=${filter}`);
    expect((list.data.items ?? []).length).toBe(0);
  });

  it('aborts with 409 when expect exists:false finds a row', async () => {
    const seed = await api('POST', '/api/db/shared/tables/posts', { title: 'TX expect none', tag: 'tx-unique-tag' });
    const id = seed.data.id as string;
    createdPostIds.push(id);

    const { status } = await api('POST', '/api/db/shared/transact', {
      operations: [
        { table: 'posts', op: 'expect', where: [['tag', '==', 'tx-unique-tag']], exists: false },
        { table: 'posts', op: 'insert', data: { title: 'TX should not exist' } },
      ],
    });
    expect(status).toBe(409);
  });

  it('requires id or where and a boolean exists', async () => {
    expect((await api('POST', '/api/db/shared/transact', {
      operations: [{ table: 'posts', op: 'expect', exists: true }],
    })).status).toBe(400);
    expect((await api('POST', '/api/db/shared/transact', {
      operations: [{ table: 'posts', op: 'expect', id: 'x' }],
    })).status).toBe(400);
  });
});

describe('transact — Durable Object provider (txdo namespace)', () => {
  async function txdoCount(): Promise<number> {
    return (await api('GET', '/api/db/txdo/tables/tx_posts/count')).data.total;
  }

  it('applies cross-table ops atomically on the DO provider', async () => {
    const { status, data } = await api('POST', '/api/db/txdo/transact', {
      operations: [
        { table: 'tx_posts', op: 'insert', data: { title: 'DO TX post', status: 'active' } },
        { table: 'tx_audit', op: 'insert', data: { action: 'do-tx-insert' } },
      ],
    });
    expect(status).toBe(200);
    expect(data.results).toHaveLength(2);
    const postId = data.results[0].inserted.id as string;

    const withExpect = await api('POST', '/api/db/txdo/transact', {
      operations: [
        { table: 'tx_posts', op: 'expect', id: postId, where: [['status', '==', 'active']], exists: true },
        { table: 'tx_posts', op: 'update', id: postId, data: { status: 'done' } },
        { table: 'tx_posts', op: 'delete', id: postId },
      ],
    });
    expect(withExpect.status).toBe(200);
    expect(withExpect.data.results[0]).toMatchObject({ expected: true });
    expect(withExpect.data.results[2]).toMatchObject({ deleted: true, id: postId });

    const gone = await api('GET', `/api/db/txdo/tables/tx_posts/${postId}`);
    expect(gone.status).toBe(404);
  });

  it('rolls back on unmet expect with 409 on the DO provider', async () => {
    const seed = await api('POST', '/api/db/txdo/tables/tx_posts', { title: 'DO TX stale', status: 'active' });
    const id = seed.data.id as string;

    const before = await txdoCount();
    const { status } = await api('POST', '/api/db/txdo/transact', {
      operations: [
        { table: 'tx_posts', op: 'insert', data: { title: 'DO TX rollback probe' } },
        { table: 'tx_posts', op: 'expect', id, where: [['status', '==', 'archived']], exists: true },
      ],
    });
    expect(status).toBe(409);
    expect(await txdoCount()).toBe(before);

    await api('DELETE', `/api/db/txdo/tables/tx_posts/${id}`);
  });

  it('applies per-row rules and rolls back on denial on the DO provider', async () => {
    const seed = await api('POST', '/api/db/txdo/tables/tx_posts', { title: 'DO TX rules target' });
    const id = seed.data.id as string;

    const before = await txdoCount();
    const { status } = await api('POST', '/api/db/txdo/transact', {
      operations: [
        { table: 'tx_posts', op: 'insert', data: { title: 'DO TX rules probe' } },
        { table: 'tx_posts', op: 'delete', id },
      ],
    }, false);
    expect(status).toBe(403);
    expect(await txdoCount()).toBe(before);

    await api('DELETE', `/api/db/txdo/tables/tx_posts/${id}`);
  });
});

describe('transact — dynamic per-instance namespace (txws)', () => {
  const instanceA = `ws-${crypto.randomUUID().slice(0, 8)}`;
  const instanceB = `ws-${crypto.randomUUID().slice(0, 8)}`;

  it('bootstraps a fresh instance on first transact (needsCreate 2-RTT) and applies ops atomically', async () => {
    const { status, data } = await api('POST', `/api/db/txws/${instanceA}/transact`, {
      operations: [
        { table: 'ws_pages', op: 'insert', data: { title: 'First page', status: 'active' } },
        { table: 'ws_audit', op: 'insert', data: { action: 'bootstrap' } },
      ],
    });
    expect(status).toBe(200);
    expect(data.results).toHaveLength(2);
    const pageId = data.results[0].inserted.id as string;

    const row = await api('GET', `/api/db/txws/${instanceA}/tables/ws_pages/${pageId}`);
    expect(row.status).toBe(200);
    expect(row.data.title).toBe('First page');
  });

  it('keeps instances isolated: rows from one instance are invisible in another', async () => {
    const seeded = await api('POST', `/api/db/txws/${instanceB}/transact`, {
      operations: [
        { table: 'ws_pages', op: 'insert', data: { title: 'B-only page' } },
      ],
    });
    expect(seeded.status).toBe(200);

    const inA = await api('GET', '/api/db/txws/' + instanceA + '/tables/ws_pages');
    const titlesInA = (inA.data.items ?? []).map((item: any) => item.title);
    expect(titlesInA).not.toContain('B-only page');
  });

  it('rolls back with 409 on unmet expect inside a dynamic instance', async () => {
    const seed = await api('POST', `/api/db/txws/${instanceA}/tables/ws_pages`, {
      title: 'Expect target',
      status: 'active',
    });
    const id = seed.data.id as string;

    const countBefore = (await api('GET', `/api/db/txws/${instanceA}/tables/ws_pages/count`)).data.total;
    const { status } = await api('POST', `/api/db/txws/${instanceA}/transact`, {
      operations: [
        { table: 'ws_pages', op: 'insert', data: { title: 'rollback probe' } },
        { table: 'ws_pages', op: 'expect', id, where: [['status', '==', 'archived']], exists: true },
      ],
    });
    expect(status).toBe(409);
    const countAfter = (await api('GET', `/api/db/txws/${instanceA}/tables/ws_pages/count`)).data.total;
    expect(countAfter).toBe(countBefore);
  });

  it('applies per-row rules without a Service Key and rolls back on denial', async () => {
    const seed = await api('POST', `/api/db/txws/${instanceA}/tables/ws_pages`, { title: 'rules target' });
    const id = seed.data.id as string;

    const countBefore = (await api('GET', `/api/db/txws/${instanceA}/tables/ws_pages/count`)).data.total;
    const { status } = await api('POST', `/api/db/txws/${instanceA}/transact`, {
      operations: [
        { table: 'ws_pages', op: 'insert', data: { title: 'rules probe' } },
        { table: 'ws_pages', op: 'delete', id }, // delete requires auth
      ],
    }, false);
    expect(status).toBe(403);
    const countAfter = (await api('GET', `/api/db/txws/${instanceA}/tables/ws_pages/count`)).data.total;
    expect(countAfter).toBe(countBefore);
  });
});

describe('transact — access rules without Service Key', () => {
  it('applies per-row rules inside the transaction and rolls back on denial', async () => {
    // posts.delete requires auth — anonymous transact deleting a post must 403
    // and the preceding insert must roll back.
    const seed = await api('POST', '/api/db/shared/tables/posts', { title: 'TX rules target' });
    const id = seed.data.id as string;
    createdPostIds.push(id);

    const before = await postCount();
    const { status } = await api('POST', '/api/db/shared/transact', {
      operations: [
        { table: 'posts', op: 'insert', data: { title: 'TX rules rollback probe' } },
        { table: 'posts', op: 'delete', id },
      ],
    }, false);
    expect(status).toBe(403);
    expect(await postCount()).toBe(before);

    const still = await api('GET', `/api/db/shared/tables/posts/${id}`);
    expect(still.status).toBe(200);
  });

  it('blocks inserts on tables whose insert rule denies anonymous users', async () => {
    const { status } = await api('POST', '/api/db/shared/transact', {
      operations: [
        { table: 'secure_posts', op: 'insert', data: { title: 'TX secure anon', authorId: 'x' } },
      ],
    }, false);
    expect(status).toBe(403);
  });
});
