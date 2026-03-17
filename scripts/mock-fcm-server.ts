/**
 * Mock FCM Server — SDK E2E 테스트용 (DECISIONS #141)
 *
 * Google OAuth2, FCM HTTP v1, IID API를 모킹하는 경량 HTTP 서버.
 * edgebase.test.config.js의 push.fcm.endpoints가 localhost:9099를 가리키면,
 * EdgeBase 서버의 push 관련 외부 호출이 모두 이 서버로 들어온다.
 *
 * 포트: 9099 (Firebase Emulator Suite 관례)
 * 외부 의존성 없음 (node:http만 사용)
 *
 * 에러 시뮬레이션:
 *   X-Mock-Status 헤더로 응답 코드 제어 가능.
 *   예: curl -H "X-Mock-Status: 404" → FCM 404 응답
 *
 * 사용법:
 *   npx tsx scripts/mock-fcm-server.ts
 *   또는 node --loader tsx scripts/mock-fcm-server.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = Number(process.env['MOCK_FCM_PORT'] ?? 9099);
let messageCounter = 0;

// ─── Message Store (풀 플로우 E2E 검증용) ───
interface StoredMessage {
  id: number;
  token?: string;
  topic?: string;
  payload: unknown;
  timestamp: string;
}

const messageStore: StoredMessage[] = [];

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  // Strip /api prefix — C++ SDK HttpClient auto-prepends /api to all paths
  const rawUrl = req.url ?? '/';
  const url = rawUrl.replace(/^\/api/, '');
  const method = req.method ?? 'GET';
  const body = method === 'POST' ? await parseBody(req) : '';

  // Allow overriding status via header (for error simulation)
  const mockStatus = req.headers['x-mock-status'];
  const overrideStatus = mockStatus ? Number(mockStatus) : null;

  // ─── OAuth2 Token Exchange ───
  if (url === '/token' && method === 'POST') {
    if (overrideStatus && overrideStatus !== 200) {
      return json(res, overrideStatus, { error: 'mock_error', error_description: 'Simulated error' });
    }
    return json(res, 200, {
      access_token: `mock-access-token-${Date.now()}`,
      expires_in: 3600,
      token_type: 'Bearer',
    });
  }

  // ─── FCM HTTP v1 Send ───
  if (url.match(/\/v1\/projects\/[^/]+\/messages:send/) && method === 'POST') {
    // X-Mock-Error: UNREGISTERED → 400 with UNREGISTERED detail
    const mockError = req.headers['x-mock-error'] as string | undefined;
    if (mockError === 'UNREGISTERED') {
      return json(res, 400, {
        error: { code: 400, message: 'Bad request', details: [{ errorCode: 'UNREGISTERED' }] },
      });
    }
    if (overrideStatus && overrideStatus !== 200) {
      return json(res, overrideStatus, { error: { code: overrideStatus, message: 'Simulated FCM error' } });
    }
    const projectMatch = url.match(/\/v1\/projects\/([^/]+)\/messages:send/);
    const projectId = projectMatch?.[1] ?? 'unknown';
    messageCounter++;

    // Store message for full-flow verification
    let parsed: any = {};
    try { parsed = JSON.parse(body); } catch {}
    const msg = parsed.message ?? {};
    if (typeof msg.token === 'string' && msg.token.startsWith('stale-')) {
      return json(res, 400, {
        error: { code: 400, message: 'Bad request', details: [{ errorCode: 'UNREGISTERED' }] },
      });
    }
    if (typeof msg.token === 'string' && msg.token.startsWith('flaky-')) {
      return json(res, 503, {
        error: { code: 503, message: 'Simulated transient FCM error' },
      });
    }
    messageStore.push({
      id: messageCounter,
      token: msg.token,
      topic: msg.topic,
      payload: msg,
      timestamp: new Date().toISOString(),
    });

    return json(res, 200, {
      name: `projects/${projectId}/messages/mock-${messageCounter}`,
    });
  }

  // ─── IID Topic Subscribe ───
  // POST /iid/v1/{token}/rel/topics/{topic}
  if (url.match(/\/iid\/v1\/[^/]+\/rel\/topics\//) && method === 'POST') {
    if (overrideStatus && overrideStatus !== 200) {
      return json(res, overrideStatus, { error: 'Simulated IID error' });
    }
    return json(res, 200, {});
  }

  // ─── IID Batch Remove (Topic Unsubscribe) ───
  // POST /iid/v1:batchRemove
  if (url === '/iid/v1:batchRemove' && method === 'POST') {
    if (overrideStatus && overrideStatus !== 200) {
      return json(res, overrideStatus, { error: 'Simulated IID error' });
    }
    return json(res, 200, { results: [{}] });
  }

  // ─── Message Store Query (풀 플로우 검증용) ───
  // GET /messages?token=xxx → 해당 토큰으로 발송된 메시지 조회
  // GET /messages?topic=xxx → 해당 토픽으로 발송된 메시지 조회
  // GET /messages           → 전체 메시지
  if (url.startsWith('/messages') && method === 'GET') {
    const queryStr = url.split('?')[1] ?? '';
    const params = new URLSearchParams(queryStr);
    const tokenFilter = params.get('token');
    const topicFilter = params.get('topic');

    let filtered = messageStore;
    if (tokenFilter) filtered = filtered.filter(m => m.token === tokenFilter);
    if (topicFilter) filtered = filtered.filter(m => m.topic === topicFilter);
    // Return a plain array — SDK E2E tests (RN, C++, C#) expect `json()[0]` access.
    return json(res, 200, filtered);
  }

  // DELETE /messages → 메시지 스토어 초기화 (테스트 격리)
  if (url === '/messages' && method === 'DELETE') {
    messageStore.length = 0;
    return json(res, 200, { ok: true, cleared: true });
  }

  // ─── Health Check ───
  if (url === '/health' && method === 'GET') {
    return json(res, 200, {
      ok: true,
      service: 'sdk-mock-fcm-server',
      messages: messageCounter,
      stored: messageStore.length,
    });
  }

  // ─── 404 for everything else ───
  json(res, 404, { error: 'Not found', url, method });
});

server.listen(PORT, () => {
  console.log(`[mock-fcm-server] Listening on http://localhost:${PORT}`);
  console.log(`[mock-fcm-server] Endpoints:`);
  console.log(`  POST   /token                          → OAuth2 token exchange`);
  console.log(`  POST   /v1/projects/:id/messages:send   → FCM send (stores message)`);
  console.log(`  POST   /iid/v1/:token/rel/topics/:topic → IID subscribe`);
  console.log(`  POST   /iid/v1:batchRemove              → IID unsubscribe`);
  console.log(`  GET    /messages?token=&topic=           → Query stored messages`);
  console.log(`  DELETE /messages                         → Clear message store`);
  console.log(`  GET    /health                           → Health check`);
  console.log(`[mock-fcm-server] Headers: X-Mock-Status (status code), X-Mock-Error (UNREGISTERED)`);
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
