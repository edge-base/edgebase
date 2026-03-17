import { describe, expect, it } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

type JsonRecord = Record<string, unknown>;

interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string };
}

let wsCounter = 0;

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function nextIp(): string {
  const value = wsCounter++;
  return `10.44.${Math.floor(value / 256) % 256}.${value % 256}`;
}

async function readJson<T = JsonRecord>(res: Response): Promise<T> {
  return await res.json() as T;
}

async function createSession(prefix = 'database-live'): Promise<Session> {
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${prefix}-${uid()}@test.com`,
      password: 'Realtime1234!',
    }),
  });

  expect(res.status).toBe(201);
  return await readJson<Session>(res);
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; data: JsonRecord | JsonRecord[] | null }> {
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  return {
    status: res.status,
    data: text ? JSON.parse(text) as JsonRecord | JsonRecord[] : null,
  };
}

async function createRecord(table: string, body: JsonRecord): Promise<JsonRecord> {
  const { status, data } = await api(
    'POST',
    `/api/db/shared/tables/${table}`,
    body,
    { 'X-EdgeBase-Service-Key': SK },
  );
  expect(status).toBe(201);
  expect(data && !Array.isArray(data)).toBe(true);
  return data as JsonRecord;
}

async function batchInsertRecords(table: string, inserts: JsonRecord[]): Promise<JsonRecord[]> {
  const { status, data } = await api(
    'POST',
    `/api/db/shared/tables/${table}/batch`,
    { inserts },
    { 'X-EdgeBase-Service-Key': SK },
  );
  expect(status).toBe(200);
  expect(data && !Array.isArray(data)).toBe(true);
  return (((data as JsonRecord).inserted ?? []) as JsonRecord[]);
}

async function upgradeDatabaseLive(
  query: Record<string, string>,
  ip = nextIp(),
): Promise<WebSocket> {
  const params = new URLSearchParams(query);
  const res = await (globalThis as any).SELF.fetch(
    `${BASE}/api/db/subscribe?${params.toString()}`,
    { headers: { Upgrade: 'websocket', 'X-Forwarded-For': ip } },
  );
  expect(res.status).toBe(101);
  const ws = (res as any).webSocket as WebSocket | undefined;
  expect(ws).toBeTruthy();
  ws!.accept();
  return ws!;
}

function sendJson(ws: WebSocket, payload: JsonRecord): void {
  ws.send(JSON.stringify(payload));
}

function waitForMessage<T extends JsonRecord = JsonRecord>(
  ws: WebSocket,
  type: string,
  timeout = 3_000,
  predicate?: (msg: T) => boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for "${type}"`));
    }, timeout);

    const onMessage = (event: MessageEvent) => {
      let msg: T;
      try {
        msg = JSON.parse(event.data as string) as T;
      } catch {
        return;
      }

      if (msg.type !== type) return;
      if (predicate && !predicate(msg)) return;

      cleanup();
      resolve(msg);
    };

    const onClose = () => {
      cleanup();
      reject(new Error(`WebSocket closed while waiting for "${type}"`));
    };

    const onError = () => {
      cleanup();
      reject(new Error(`WebSocket errored while waiting for "${type}"`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
    };

    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
  });
}

function collectMessages<T extends JsonRecord = JsonRecord>(
  ws: WebSocket,
  type: string,
  durationMs = 1_000,
): Promise<T[]> {
  return new Promise((resolve) => {
    const messages: T[] = [];

    const onMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as T;
        if (msg.type === type) {
          messages.push(msg);
        }
      } catch {
        // Ignore malformed payloads while collecting.
      }
    };

    const cleanup = () => {
      ws.removeEventListener('message', onMessage);
      resolve(messages);
    };

    ws.addEventListener('message', onMessage);
    setTimeout(cleanup, durationMs);
  });
}

async function authenticateAndSubscribe(
  ws: WebSocket,
  accessToken: string,
  channel: string,
  options?: { sdkVersion?: string; filters?: unknown; orFilters?: unknown },
): Promise<void> {
  sendJson(ws, {
    type: 'auth',
    token: accessToken,
    ...(options?.sdkVersion ? { sdkVersion: options.sdkVersion } : {}),
  });
  await waitForMessage(ws, 'auth_success');

  sendJson(ws, {
    type: 'subscribe',
    channel,
    ...(options?.filters ? { filters: options.filters } : {}),
    ...(options?.orFilters ? { orFilters: options.orFilters } : {}),
  });
  await waitForMessage(ws, 'subscribed', 3_000, (msg) => msg.channel === channel);
}

describe('Database live runtime', () => {
  it('authenticates and delivers CRUD changes through /api/db/subscribe', async () => {
    const session = await createSession('db-live-crud');
    const channel = 'dblive:shared:posts';
    const ws = await upgradeDatabaseLive({ namespace: 'shared', table: 'posts' });

    try {
      await authenticateAndSubscribe(ws, session.accessToken, channel, { sdkVersion: '0.1.0' });

      const changePromise = waitForMessage(ws, 'db_change', 5_000, (msg) =>
        msg.channel === channel && msg.changeType === 'added',
      );

      const created = await createRecord('posts', {
        title: `database-live-${uid()}`,
        status: 'published',
      });

      const change = await changePromise;
      expect(change.channel).toBe(channel);
      expect(change.docId).toBe(created.id);
      expect(change.changeType).toBe('added');
      expect((change.data as JsonRecord).title).toBe(created.title);
    } finally {
      ws.close(1000, 'test cleanup');
    }
  });

  it('applies server-side filters inside DatabaseLiveDO', async () => {
    const session = await createSession('db-live-filter');
    const channel = 'dblive:shared:posts';
    const ws = await upgradeDatabaseLive({ namespace: 'shared', table: 'posts' });

    try {
      await authenticateAndSubscribe(ws, session.accessToken, channel, {
        sdkVersion: '0.1.0',
        filters: [['status', '==', 'published']],
      });

      const collector = collectMessages(ws, 'db_change', 1_500);

      await createRecord('posts', {
        title: `database-live-draft-${uid()}`,
        status: 'draft',
      });
      const published = await createRecord('posts', {
        title: `database-live-published-${uid()}`,
        status: 'published',
      });

      const messages = await collector;
      expect(messages).toHaveLength(1);
      expect(messages[0]?.docId).toBe(published.id);
      expect(((messages[0]?.data as JsonRecord) ?? {}).status).toBe('published');
    } finally {
      ws.close(1000, 'test cleanup');
    }
  });

  it('accepts object-form filter conditions emitted by native SDKs', async () => {
    const session = await createSession('db-live-object-filter');
    const channel = 'dblive:shared:posts';
    const ws = await upgradeDatabaseLive({ namespace: 'shared', table: 'posts' });

    try {
      await authenticateAndSubscribe(ws, session.accessToken, channel, {
        sdkVersion: '0.1.0',
        filters: [{ field: 'status', op: '==', value: 'published' }],
      });

      const collector = collectMessages(ws, 'db_change', 1_500);

      await createRecord('posts', {
        title: `database-live-object-filter-draft-${uid()}`,
        status: 'draft',
      });
      const published = await createRecord('posts', {
        title: `database-live-object-filter-published-${uid()}`,
        status: 'published',
      });

      const messages = await collector;
      expect(messages).toHaveLength(1);
      expect(messages[0]?.docId).toBe(published.id);
      expect(((messages[0]?.data as JsonRecord) ?? {}).status).toBe('published');
    } finally {
      ws.close(1000, 'test cleanup');
    }
  });

  it('accepts shorthand equality maps for server-side filters', async () => {
    const session = await createSession('db-live-shorthand-filter');
    const channel = 'dblive:shared:posts';
    const ws = await upgradeDatabaseLive({ namespace: 'shared', table: 'posts' });
    const matchingTitle = `database-live-shorthand-${uid()}`;

    try {
      await authenticateAndSubscribe(ws, session.accessToken, channel, {
        sdkVersion: '0.1.0',
        filters: { status: 'published', title: matchingTitle },
      });

      const collector = collectMessages(ws, 'db_change', 1_500);

      await createRecord('posts', {
        title: `database-live-shorthand-other-${uid()}`,
        status: 'published',
      });
      const published = await createRecord('posts', {
        title: matchingTitle,
        status: 'published',
      });

      const messages = await collector;
      expect(messages).toHaveLength(1);
      expect(messages[0]?.docId).toBe(published.id);
      expect(((messages[0]?.data as JsonRecord) ?? {}).title).toBe(matchingTitle);
    } finally {
      ws.close(1000, 'test cleanup');
    }
  });

  it('sends batch_changes to sdk-aware clients and individual events to legacy clients', async () => {
    const modernSession = await createSession('db-live-modern');
    const legacySession = await createSession('db-live-legacy');
    const channel = 'dblive:shared:posts';
    const modernWs = await upgradeDatabaseLive({ namespace: 'shared', table: 'posts' });
    const legacyWs = await upgradeDatabaseLive({ namespace: 'shared', table: 'posts' });

    try {
      await authenticateAndSubscribe(modernWs, modernSession.accessToken, channel, { sdkVersion: '0.1.0' });
      await authenticateAndSubscribe(legacyWs, legacySession.accessToken, channel);

      const batchPromise = waitForMessage(modernWs, 'batch_changes', 5_000, (msg) => msg.channel === channel);
      const legacyCollector = collectMessages(legacyWs, 'db_change', 1_500);

      await batchInsertRecords('posts', Array.from({ length: 10 }, (_, index) => ({
        title: `database-live-batch-${uid()}-${index}`,
        status: 'published',
      })));

      const batch = await batchPromise;
      const legacyChanges = await legacyCollector;

      expect(Array.isArray(batch.changes)).toBe(true);
      expect((batch.changes as unknown[]).length).toBe(10);
      expect(legacyChanges).toHaveLength(10);
      expect(new Set(legacyChanges.map((change) => change.docId)).size).toBe(10);
    } finally {
      modernWs.close(1000, 'test cleanup');
      legacyWs.close(1000, 'test cleanup');
    }
  });
});
