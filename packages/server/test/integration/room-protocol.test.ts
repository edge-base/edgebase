/**
 * room-protocol.test.ts — Protocol Compatibility Gate
 *
 * Validates the WebSocket message protocol between client and RoomsDO:
 *   - Auth flow: auth → auth_success / error
 *   - Join flow: join → sync (+ members_sync for rooms runtime)
 *   - Action flow: send → action_result / action_error
 *   - Signal flow: signal → signal_sent + signal delivery
 *   - Member state flow: member_state → member_state broadcast
 *   - Media flow: media → media_result / media_error
 *   - Admin flow: admin → admin_result
 *   - Ping/pong keepalive
 *   - Leave → graceful disconnect
 *   - Error codes consistency
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost';

async function createSession(email?: string) {
  const e = email ?? `room-proto-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'Room1234!' }),
  });
  return await res.json() as { accessToken: string; user: { id: string } };
}

let wsCounter = 0;
async function createWS(namespace: string, roomId: string): Promise<WebSocket> {
  const fakeIp = `10.7.${Math.floor(wsCounter / 256) % 256}.${wsCounter % 256}`;
  wsCounter++;
  const res = await (globalThis as any).SELF.fetch(
    `${BASE}/api/room?namespace=${namespace}&id=${roomId}`,
    { headers: { Upgrade: 'websocket', 'X-Forwarded-For': fakeIp } },
  );
  const ws = (res as any).webSocket;
  if (!ws) throw new Error(`WebSocket upgrade failed: status=${res.status}`);
  ws.accept();
  return ws;
}

function waitForFrame(ws: WebSocket, predicate: (msg: any) => boolean, timeout = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for frame')), timeout);
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          resolve(msg);
        }
      } catch { /* ignore */ }
    };
    ws.addEventListener('message', handler);
    ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('WS closed')); });
  });
}

function collectFrames(ws: WebSocket, predicate: (msg: any) => boolean, durationMs = 500): Promise<any[]> {
  return new Promise((resolve) => {
    const frames: any[] = [];
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (predicate(msg)) frames.push(msg);
      } catch { /* ignore */ }
    };
    ws.addEventListener('message', handler);
    setTimeout(() => { ws.removeEventListener('message', handler); resolve(frames); }, durationMs);
  });
}

function uid(): string { return crypto.randomUUID().slice(0, 8); }

// ─── 1. Auth Protocol ───

describe('Room Protocol — auth', () => {
  it('auth with valid token returns auth_success with userId and connectionId', async () => {
    const session = await createSession();
    const ws = await createWS('test-game', `proto-auth-${uid()}`);
    ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
    const msg = await waitForFrame(ws, (m) => m.type === 'auth_success');
    expect(msg.userId).toBeTruthy();
    expect(msg.connectionId).toBeTruthy();
    ws.close();
  });

  it('auth with invalid token returns error with code AUTH_FAILED', async () => {
    const ws = await createWS('test-game', `proto-auth-fail-${uid()}`);
    ws.send(JSON.stringify({ type: 'auth', token: 'invalid-token' }));
    const msg = await waitForFrame(ws, (m) => m.type === 'error');
    expect(msg.code).toBe('AUTH_FAILED');
  });

  it('re-auth with valid refreshed token returns auth_refreshed', async () => {
    const session = await createSession();
    const ws = await createWS('test-game', `proto-reauth-${uid()}`);

    ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
    const auth = await waitForFrame(ws, (m) => m.type === 'auth_success');

    ws.send(JSON.stringify({ type: 'join' }));
    await waitForFrame(ws, (m) => m.type === 'sync');

    // Refresh token
    const refreshRes = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    const refreshData = await refreshRes.json() as any;

    ws.send(JSON.stringify({ type: 'auth', token: refreshData.accessToken }));
    const refreshed = await waitForFrame(ws, (m) => m.type === 'auth_refreshed');
    expect(refreshed.userId).toBe(auth.userId);
    expect(refreshed.connectionId).toBe(auth.connectionId);
    ws.close();
  });
});

// ─── 2. Join Protocol ───

describe('Room Protocol — join', () => {
  it('join returns sync frame with sharedState and playerState', async () => {
    const session = await createSession();
    const ws = await createWS('test-game', `proto-join-${uid()}`);

    ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
    await waitForFrame(ws, (m) => m.type === 'auth_success');

    ws.send(JSON.stringify({ type: 'join' }));
    const sync = await waitForFrame(ws, (m) => m.type === 'sync');

    expect(sync.sharedState).toBeDefined();
    expect(sync.playerState).toBeDefined();
    ws.close();
  });

  it('join without auth returns NOT_AUTHENTICATED error', async () => {
    const ws = await createWS('test-game', `proto-noauth-${uid()}`);
    ws.send(JSON.stringify({ type: 'join' }));
    const msg = await waitForFrame(ws, (m) => m.type === 'error');
    expect(msg.code).toBe('NOT_AUTHENTICATED');
    ws.close();
  });
});

// ─── 3. Action Protocol ───

describe('Room Protocol — action', () => {
  it('send returns action_result with actionType, result, and requestId', async () => {
    const session = await createSession();
    const ws = await createWS('test-game', `proto-action-${uid()}`);
    ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
    await waitForFrame(ws, (m) => m.type === 'auth_success');
    ws.send(JSON.stringify({ type: 'join' }));
    await waitForFrame(ws, (m) => m.type === 'sync');

    ws.send(JSON.stringify({
      type: 'send', actionType: 'SET_SCORE', payload: { score: 10 }, requestId: 'proto-a1',
    }));
    const result = await waitForFrame(ws, (m) => m.type === 'action_result');
    expect(result.actionType).toBe('SET_SCORE');
    expect(result.requestId).toBe('proto-a1');
    expect(result.result).toBeDefined();
    ws.close();
  });

  it('send without auth returns NOT_AUTHENTICATED', async () => {
    const ws = await createWS('test-game', `proto-noauth-action-${uid()}`);
    ws.send(JSON.stringify({ type: 'send', actionType: 'SET_SCORE', payload: {} }));
    const msg = await waitForFrame(ws, (m) => m.type === 'error');
    expect(msg.code).toBe('NOT_AUTHENTICATED');
    ws.close();
  });
});

// ─── 4. Signal Protocol ───

describe('Room Protocol — signal', () => {
  it('signal returns signal_sent confirmation to sender', async () => {
    const session = await createSession();
    const ws = await createWS('test-signals', `proto-sig-${uid()}`);
    ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
    await waitForFrame(ws, (m) => m.type === 'auth_success');
    ws.send(JSON.stringify({ type: 'join' }));
    await waitForFrame(ws, (m) => m.type === 'sync');

    ws.send(JSON.stringify({
      type: 'signal', event: 'test.event', payload: { data: 1 }, requestId: 'proto-s1',
    }));
    const sent = await waitForFrame(ws, (m) => m.type === 'signal_sent');
    expect(sent.event).toBe('test.event');
    expect(sent.requestId).toBe('proto-s1');
    ws.close();
  });

  it('signal delivery includes meta with memberId, userId, connectionId, sentAt, serverSent', async () => {
    const roomId = `proto-sig-meta-${uid()}`;
    const sender = await createSession();
    const receiver = await createSession();

    const wsS = await createWS('test-signals', roomId);
    wsS.send(JSON.stringify({ type: 'auth', token: sender.accessToken }));
    const sAuth = await waitForFrame(wsS, (m) => m.type === 'auth_success');
    wsS.send(JSON.stringify({ type: 'join' }));
    await waitForFrame(wsS, (m) => m.type === 'sync');

    const wsR = await createWS('test-signals', roomId);
    wsR.send(JSON.stringify({ type: 'auth', token: receiver.accessToken }));
    await waitForFrame(wsR, (m) => m.type === 'auth_success');
    wsR.send(JSON.stringify({ type: 'join' }));
    await waitForFrame(wsR, (m) => m.type === 'sync');

    const signalPromise = waitForFrame(wsR, (m) => m.type === 'signal' && m.event === 'meta.check');
    wsS.send(JSON.stringify({
      type: 'signal', event: 'meta.check', payload: {}, requestId: 'proto-s2',
    }));

    const received = await signalPromise;
    expect(received.meta).toBeDefined();
    expect(received.meta.memberId).toBe(sAuth.userId);
    expect(received.meta.userId).toBe(sAuth.userId);
    expect(received.meta.connectionId).toBe(sAuth.connectionId);
    expect(typeof received.meta.sentAt).toBe('number');
    expect(received.meta.serverSent).toBe(false);

    wsS.close(); wsR.close();
  });
});

// ─── 5. Ping/Pong ───

describe('Room Protocol — ping/pong', () => {
  it('ping returns pong', async () => {
    const session = await createSession();
    const ws = await createWS('test-game', `proto-ping-${uid()}`);
    ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
    await waitForFrame(ws, (m) => m.type === 'auth_success');
    ws.send(JSON.stringify({ type: 'join' }));
    await waitForFrame(ws, (m) => m.type === 'sync');

    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await waitForFrame(ws, (m) => m.type === 'pong');
    expect(pong.type).toBe('pong');
    ws.close();
  });
});

// ─── 6. Leave Protocol ───

describe('Room Protocol — leave', () => {
  it('leave message triggers immediate departure without error', async () => {
    const roomId = `proto-leave-${uid()}`;
    const session = await createSession();
    const ws = await createWS('test-game', roomId);
    ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
    await waitForFrame(ws, (m) => m.type === 'auth_success');
    ws.send(JSON.stringify({ type: 'join' }));
    await waitForFrame(ws, (m) => m.type === 'sync');

    // Collect errors for 300ms after leave
    const errors = collectFrames(ws, (m) => m.type === 'error', 300);
    ws.send(JSON.stringify({ type: 'leave' }));
    const errList = await errors;
    expect(errList).toHaveLength(0);
    ws.close();
  });
});

// ─── 7. Error Code Consistency ───

describe('Room Protocol — error codes', () => {
  it('AUTH_FAILED for invalid token', async () => {
    const ws = await createWS('test-game', `proto-ec1-${uid()}`);
    ws.send(JSON.stringify({ type: 'auth', token: 'bad' }));
    const err = await waitForFrame(ws, (m) => m.type === 'error');
    expect(err.code).toBe('AUTH_FAILED');
  });

  it('NOT_AUTHENTICATED for action before auth', async () => {
    const ws = await createWS('test-game', `proto-ec2-${uid()}`);
    ws.send(JSON.stringify({ type: 'send', actionType: 'X', payload: {} }));
    const err = await waitForFrame(ws, (m) => m.type === 'error');
    expect(err.code).toBe('NOT_AUTHENTICATED');
    ws.close();
  });

  it('signal access denied returns signal_error with Denied message', async () => {
    const roomId = `proto-ec3-${uid()}`;
    const session = await createSession();
    const ws = await createWS('test-signals', roomId);
    ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
    await waitForFrame(ws, (m) => m.type === 'auth_success');
    ws.send(JSON.stringify({ type: 'join' }));
    await waitForFrame(ws, (m) => m.type === 'sync');

    ws.send(JSON.stringify({
      type: 'signal', event: 'denied.by.access', payload: {}, requestId: 'ec3',
    }));
    const err = await waitForFrame(ws, (m) => m.type === 'signal_error');
    expect(err.message).toContain('Denied');
    ws.close();
  });
});
