/**
 * room-state-machine.test.ts — State Machine Gate
 *
 * Validates that the RoomsDO state machine correctly handles:
 *   - Action dispatch and shared state mutations
 *   - Player state isolation (per-user)
 *   - Server state privacy (not leaked to clients)
 *   - Named timer set/cancel/override/fire
 *   - State persistence across reconnects
 *   - Version tracking on shared_delta
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost';

async function createSession(email?: string) {
  const e = email ?? `room-sm-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'Room1234!' }),
  });
  return await res.json() as { accessToken: string; user: { id: string } };
}

let wsCounter = 0;
async function createWS(namespace: string, roomId: string): Promise<WebSocket> {
  const fakeIp = `10.5.${Math.floor(wsCounter / 256) % 256}.${wsCounter % 256}`;
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

async function connectToRoom(namespace: string, roomId: string, email?: string) {
  const session = await createSession(email);
  const ws = await createWS(namespace, roomId);
  ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
  const auth = await waitForFrame(ws, (msg) => msg.type === 'auth_success');
  ws.send(JSON.stringify({ type: 'join' }));
  const sync = await waitForFrame(ws, (msg) => msg.type === 'sync');
  return { ws, sync, userId: auth.userId, token: session.accessToken };
}

function uid(): string { return crypto.randomUUID().slice(0, 8); }

// ─── 1. Action Dispatch ───

describe('Room State Machine — action dispatch', () => {
  it('dispatches action and returns action_result with mutated state', async () => {
    const { ws } = await connectToRoom('test-game', `sm-action-${uid()}`);
    ws.send(JSON.stringify({
      type: 'send', actionType: 'SET_SCORE', payload: { score: 42 }, requestId: 'sm1',
    }));
    const result = await waitForFrame(ws, (msg) => msg.type === 'action_result' && msg.requestId === 'sm1');
    expect(result.result.score).toBe(42);
    ws.close();
  });

  it('returns action_error for unregistered action', async () => {
    const { ws } = await connectToRoom('test-game', `sm-unknown-${uid()}`);
    ws.send(JSON.stringify({
      type: 'send', actionType: 'NONEXISTENT', payload: {}, requestId: 'sm2',
    }));
    const err = await waitForFrame(ws, (msg) => msg.type === 'action_error' && msg.requestId === 'sm2');
    expect(err.actionType).toBe('NONEXISTENT');
    ws.close();
  });

  it('broadcasts shared_delta to all clients after action', async () => {
    const roomId = `sm-delta-${uid()}`;
    const { ws: ws1 } = await connectToRoom('test-game', roomId);
    const { ws: ws2 } = await connectToRoom('test-game', roomId);
    const deltaPromise = waitForFrame(ws2, (msg) => msg.type === 'shared_delta');

    ws1.send(JSON.stringify({
      type: 'send', actionType: 'SET_SCORE', payload: { score: 77 }, requestId: 'sm3',
    }));
    const delta = await deltaPromise;
    expect(delta.delta.score).toBe(77);
    expect(delta.version).toBeGreaterThan(0);
    ws1.close(); ws2.close();
  });
});

// ─── 2. Player State Isolation ───

describe('Room State Machine — player state', () => {
  it('player state is per-user and not leaked to others', async () => {
    const roomId = `sm-ps-${uid()}`;
    const { ws: ws1 } = await connectToRoom('test-player', roomId);
    const { ws: ws2 } = await connectToRoom('test-player', roomId);

    const ws1DeltaPromise = waitForFrame(ws1, (msg) => msg.type === 'player_delta', 1000).catch(() => null);

    ws2.send(JSON.stringify({
      type: 'send', actionType: 'SET_HP', payload: { hp: 50 }, requestId: 'ps1',
    }));
    const result = await waitForFrame(ws2, (msg) => msg.type === 'action_result' && msg.requestId === 'ps1');
    expect(result.result.hp).toBe(50);

    const ws1Delta = await ws1DeltaPromise;
    if (ws1Delta && ws1Delta.delta?.hp === 50) {
      expect(ws1Delta.delta.hp).not.toBe(50); // Should not reach ws1
    }
    ws1.close(); ws2.close();
  });
});

// ─── 3. Server State Privacy ───

describe('Room State Machine — server state', () => {
  it('server state is not included in sync', async () => {
    const { ws, sync } = await connectToRoom('test-server-state', `sm-ss-${uid()}`);
    expect(sync.serverState).toBeUndefined();
    ws.close();
  });

  it('handlers can read server state', async () => {
    const { ws } = await connectToRoom('test-server-state', `sm-ss-read-${uid()}`);
    ws.send(JSON.stringify({
      type: 'send', actionType: 'GET_SECRET', payload: {}, requestId: 'ss1',
    }));
    const result = await waitForFrame(ws, (msg) => msg.type === 'action_result' && msg.requestId === 'ss1');
    expect(result.result.secret).toBe('hidden-value');
    ws.close();
  });
});

// ─── 4. Named Timers ───

describe('Room State Machine — timers', () => {
  it('timer fires and updates shared state', async () => {
    const { ws } = await connectToRoom('test-timer', `sm-timer-${uid()}`);
    ws.send(JSON.stringify({
      type: 'send', actionType: 'START_TIMER', payload: { name: 'turnEnd', ms: 200 }, requestId: 't1',
    }));
    await waitForFrame(ws, (msg) => msg.type === 'action_result' && msg.requestId === 't1');
    const delta = await waitForFrame(ws, (msg) => msg.type === 'shared_delta', 5000);
    expect(delta.delta.timerFired).toBe('turnEnd');
    ws.close();
  });

  it('cancelled timer does not fire', async () => {
    const { ws } = await connectToRoom('test-timer', `sm-cancel-${uid()}`);
    ws.send(JSON.stringify({
      type: 'send', actionType: 'START_TIMER', payload: { name: 'turnEnd', ms: 500 }, requestId: 't2',
    }));
    await waitForFrame(ws, (msg) => msg.type === 'action_result' && msg.requestId === 't2');
    ws.send(JSON.stringify({
      type: 'send', actionType: 'CANCEL_TIMER', payload: { name: 'turnEnd' }, requestId: 't3',
    }));
    await waitForFrame(ws, (msg) => msg.type === 'action_result' && msg.requestId === 't3');
    const deltas = await collectFrames(ws, (msg) => msg.type === 'shared_delta', 800);
    expect(deltas.length).toBe(0);
    ws.close();
  });

  it('overriding timer with shorter delay fires at new time', async () => {
    const { ws } = await connectToRoom('test-timer', `sm-override-${uid()}`);
    ws.send(JSON.stringify({
      type: 'send', actionType: 'START_TIMER', payload: { name: 'turnEnd', ms: 5000 }, requestId: 't4',
    }));
    await waitForFrame(ws, (msg) => msg.type === 'action_result' && msg.requestId === 't4');
    ws.send(JSON.stringify({
      type: 'send', actionType: 'START_TIMER', payload: { name: 'turnEnd', ms: 200 }, requestId: 't5',
    }));
    await waitForFrame(ws, (msg) => msg.type === 'action_result' && msg.requestId === 't5');
    const delta = await waitForFrame(ws, (msg) => msg.type === 'shared_delta', 2000);
    expect(delta.delta.timerFired).toBe('turnEnd');
    ws.close();
  });

  it('timer passes data to handler', async () => {
    const { ws } = await connectToRoom('test-timer', `sm-data-${uid()}`);
    ws.send(JSON.stringify({
      type: 'send', actionType: 'START_TIMER',
      payload: { name: 'countdown', ms: 200, data: { remaining: 3 } },
      requestId: 't6',
    }));
    await waitForFrame(ws, (msg) => msg.type === 'action_result' && msg.requestId === 't6');
    const delta = await waitForFrame(ws, (msg) => msg.type === 'shared_delta', 5000);
    expect(delta.delta.countdownData).toEqual({ remaining: 3 });
    ws.close();
  });
});

// ─── 5. State Persistence ───

describe('Room State Machine — state persistence across reconnects', () => {
  it('shared state persists after disconnect and reconnect', async () => {
    const roomId = `sm-persist-${uid()}`;
    const { ws: ws1 } = await connectToRoom('test-game', roomId);

    ws1.send(JSON.stringify({
      type: 'send', actionType: 'SET_SCORE', payload: { score: 999 }, requestId: 'p1',
    }));
    await waitForFrame(ws1, (msg) => msg.type === 'action_result' && msg.requestId === 'p1');
    ws1.close();

    await new Promise((r) => setTimeout(r, 100));

    const { ws: ws2, sync } = await connectToRoom('test-game', roomId);
    expect(sync.sharedState.score).toBe(999);
    ws2.close();
  });
});
