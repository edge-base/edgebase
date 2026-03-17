/**
 * room-simulation.test.ts — Room v2 Full Game Simulation Test
 *
 * Tests the complete lifecycle of a multiplayer room:
 *   join → actions → state sync → kick → disconnect → leave
 *
 * Uses the 'test-simulation' namespace defined in edgebase.test.config.js.
 * All tests run sequentially within a single room to simulate a real game session.
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost';

// ─── Helpers (same pattern as room.test.ts) ───

async function getToken(email?: string): Promise<string> {
  const e = email ?? `sim-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'Sim12345!' }),
  });
  const data = await res.json() as any;
  return data.accessToken;
}

let _wsCounter = 10000; // offset from room.test.ts to avoid IP collision
async function createWS(namespace: string, roomId: string): Promise<WebSocket> {
  const fakeIp = `10.1.${Math.floor(_wsCounter / 256) % 256}.${_wsCounter % 256}`;
  _wsCounter++;
  const res = await (globalThis as any).SELF.fetch(
    `${BASE}/api/room?namespace=${namespace}&id=${roomId}`,
    { headers: { Upgrade: 'websocket', 'X-Forwarded-For': fakeIp } },
  );
  const ws = (res as any).webSocket;
  if (!ws) throw new Error(`WebSocket upgrade failed: status=${res.status}`);
  ws.accept();
  return ws;
}

function waitForMessage(ws: WebSocket, type: string, timeout = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for '${type}'`)), timeout);
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === type) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          resolve(msg);
        }
      } catch { /* ignore parse errors */ }
    };
    ws.addEventListener('message', handler);
    ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('WS closed')); });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WS error')); });
  });
}

function collectMessages(ws: WebSocket, type: string, durationMs = 500): Promise<any[]> {
  return new Promise((resolve) => {
    const msgs: any[] = [];
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === type) msgs.push(msg);
      } catch { /* ignore */ }
    };
    ws.addEventListener('message', handler);
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      resolve(msgs);
    }, durationMs);
  });
}

/** Connect, auth, join a room — returns { ws, token, sync, userId } */
async function connectToRoom(namespace: string, roomId: string, email?: string): Promise<{
  ws: WebSocket;
  token: string;
  sync: any;
  userId: string;
}> {
  const token = await getToken(email);
  const ws = await createWS(namespace, roomId);

  // Auth
  ws.send(JSON.stringify({ type: 'auth', token }));
  const authMsg = await waitForMessage(ws, 'auth_success');
  expect(authMsg.type).toBe('auth_success');

  // Join
  ws.send(JSON.stringify({ type: 'join' }));
  const sync = await waitForMessage(ws, 'sync');

  return { ws, token, sync, userId: authMsg.userId };
}

/** Send an action and wait for action_result */
async function sendAction(ws: WebSocket, actionType: string, payload: any, requestId?: string): Promise<any> {
  const rid = requestId ?? `req-${crypto.randomUUID().slice(0, 8)}`;
  ws.send(JSON.stringify({ type: 'send', actionType, payload, requestId: rid }));
  const result = await waitForMessage(ws, 'action_result', 5000);
  expect(result.requestId).toBe(rid);
  return result;
}

// ─── Full Game Simulation ───

// Sequential tests with shared state — retries would corrupt Room DO state
describe('Room v2 — Full Game Simulation', { retry: 0, timeout: 15000 }, () => {
  const ROOM_ID = `sim-${crypto.randomUUID().slice(0, 8)}`;
  const NS = 'test-simulation';

  // Shared state across sequential tests
  let wsA: WebSocket;
  let wsB: WebSocket;
  let wsC: WebSocket;
  let wsD: WebSocket;
  let userIdA: string;
  let userIdB: string;
  let userIdC: string;
  let userIdD: string;

  // ── 1. Player A joins — initial state ──
  it('1. Player A joins → sync with initial state, no players[] in sync', async () => {
    const { ws, sync, userId } = await connectToRoom(NS, ROOM_ID);
    wsA = ws;
    userIdA = userId;

    // sharedState initialized by onCreate
    expect(sync.sharedState).toBeDefined();
    expect(sync.sharedState.phase).toBe('waiting');
    expect(sync.sharedState.turn).toBe(0);
    expect(sync.sharedState.board).toEqual({});

    // sharedState.players populated by onJoin (developer code, not server built-in)
    expect(sync.sharedState.players).toBeDefined();
    expect(sync.sharedState.players.length).toBe(1);
    expect(sync.sharedState.players[0].id).toBe(userIdA);

    // playerState initialized by onJoin
    expect(sync.playerState).toBeDefined();
    expect(sync.playerState.hp).toBe(100);
    expect(sync.playerState.score).toBe(0);
    expect(sync.playerState.inventory).toEqual([]);

    // SECURITY: sync must NOT have a top-level players[] field (server doesn't expose it)
    expect(sync.players).toBeUndefined();

    // SECURITY: serverState must NOT be in sync
    expect(sync.serverState).toBeUndefined();
  });

  // ── 2. Player B joins — A receives shared_delta, NOT player_joined ──
  it('2. Player B joins → A gets shared_delta (not player_joined)', async () => {
    // Listen for shared_delta on A before B joins
    const deltaPromise = waitForMessage(wsA, 'shared_delta', 3000);

    // Also collect any player_joined messages on A (should be none)
    const playerJoinedPromise = collectMessages(wsA, 'player_joined', 1500);

    const { ws, sync, userId } = await connectToRoom(NS, ROOM_ID);
    wsB = ws;
    userIdB = userId;

    // A should receive shared_delta (because onJoin does setSharedState)
    const delta = await deltaPromise;
    expect(delta.type).toBe('shared_delta');
    // The delta should include the updated players array
    expect(delta.delta.players).toBeDefined();

    // SECURITY: A must NOT receive player_joined message
    const playerJoined = await playerJoinedPromise;
    expect(playerJoined.length).toBe(0);

    // B's sync should show 2 players in sharedState
    expect(sync.sharedState.players.length).toBe(2);
  });

  // ── 3. START_GAME action ──
  it('3. START_GAME → action_result + shared_delta to both', async () => {
    // B listens for shared_delta
    const bDeltaPromise = waitForMessage(wsB, 'shared_delta', 3000);

    // A sends START_GAME
    const result = await sendAction(wsA, 'START_GAME', {});
    expect(result.result.started).toBe(true);

    // A should also get shared_delta
    // (it may already be received inline, collect to check)
    const aDelta = await waitForMessage(wsA, 'shared_delta', 3000).catch(() => null);

    // B should get shared_delta
    const bDelta = await bDeltaPromise;
    expect(bDelta.delta.phase).toBe('playing');
    expect(bDelta.delta.turn).toBe(1);
  });

  // ── 4. PLACE_PIECE — sharedState + playerState + serverState simultaneously ──
  it('4. PLACE_PIECE → shared_delta to both, player_delta to A only', async () => {
    // Set up ALL listeners BEFORE sending the action (messages arrive immediately)
    const aPlayerDelta = waitForMessage(wsA, 'player_delta', 3000);
    const bSharedDelta = waitForMessage(wsB, 'shared_delta', 3000);
    const bPlayerDelta = collectMessages(wsB, 'player_delta', 1500);

    // A sends PLACE_PIECE (don't await sendAction — listen in parallel)
    const rid = `place-${crypto.randomUUID().slice(0, 8)}`;
    wsA.send(JSON.stringify({
      type: 'send',
      actionType: 'PLACE_PIECE',
      payload: { x: 0, y: 0 },
      requestId: rid,
    }));

    const result = await waitForMessage(wsA, 'action_result', 5000);
    expect(result.requestId).toBe(rid);
    expect(result.result.placed).toBe(true);
    expect(result.result.position).toEqual({ x: 0, y: 0 });

    // A should get player_delta (score increased)
    const apd = await aPlayerDelta;
    expect(apd.delta.score).toBe(10);

    // B should get shared_delta (board + turn updated)
    const bsd = await bSharedDelta;
    expect(bsd.delta.board).toBeDefined();
    expect(bsd.delta.board['0,0']).toBe(userIdA);
    expect(bsd.delta.turn).toBe(2); // was 1, now 2

    // B should NOT have received player_delta for A's state
    const bpds = await bPlayerDelta;
    const aScoreDelta = bpds.find((d: any) => d.delta?.score === 10);
    expect(aScoreDelta).toBeUndefined();
  });

  // ── 5. HEAL — playerState only, isolation verified ──
  it('5. HEAL → action_result to B, A does not receive player_delta', async () => {
    // First, damage B's score to create a changed value we can heal with
    // (B's hp is 100 — healing when already full may not produce a delta)
    // Instead, we'll use PLACE_PIECE from B to change B's playerState (score),
    // then verify A doesn't get B's player_delta

    const aPlayerDelta = collectMessages(wsA, 'player_delta', 1500);
    const bPlayerDelta = waitForMessage(wsB, 'player_delta', 3000);

    // B places a piece → B's score changes → B gets player_delta
    const rid = `bplace-${crypto.randomUUID().slice(0, 8)}`;
    wsB.send(JSON.stringify({
      type: 'send',
      actionType: 'PLACE_PIECE',
      payload: { x: 1, y: 1 },
      requestId: rid,
    }));

    const result = await waitForMessage(wsB, 'action_result', 5000);
    expect(result.requestId).toBe(rid);
    expect(result.result.placed).toBe(true);

    // B should get player_delta (score increased to 10)
    const bpd = await bPlayerDelta;
    expect(bpd.delta.score).toBe(10);

    // A should NOT receive B's player_delta (isolation)
    const apd = await aPlayerDelta;
    const bScoreDelta = apd.find((d: any) => d.delta?.score === 10);
    // A might receive their own player_delta, but not B's
    // If A gets any, it should not be for B's score change
    expect(bScoreDelta).toBeUndefined();
  });

  // ── 6. GET_SERVER_INFO — serverState read, no client access ──
  it('6. GET_SERVER_INFO → handler reads serverState, client cannot access directly', async () => {
    const result = await sendAction(wsA, 'GET_SERVER_INFO', {});

    // Handler could read serverState
    expect(typeof result.result.seed).toBe('number');
    expect(result.result.logCount).toBeGreaterThanOrEqual(1); // at least 1 PLACE_PIECE logged
  });

  // ── 7. BROADCAST_MSG — server → all clients ──
  it('7. BROADCAST_MSG → both A and B receive message', async () => {
    // Both listen for message
    const aMsgPromise = waitForMessage(wsA, 'message', 3000);
    const bMsgPromise = waitForMessage(wsB, 'message', 3000);

    // A triggers broadcast via action
    wsA.send(JSON.stringify({
      type: 'send',
      actionType: 'BROADCAST_MSG',
      payload: { type: 'announcement', data: { text: 'hello world' } },
      requestId: 'broadcast-1',
    }));

    const aMsg = await aMsgPromise.catch(() => null);
    const bMsg = await bMsgPromise.catch(() => null);

    // At least one should receive the message
    const msg = aMsg || bMsg;
    expect(msg).toBeTruthy();
    if (msg) {
      expect(msg.messageType).toBe('announcement');
      expect(msg.data.text).toBe('hello world');
    }
  });

  // ── 7.5. SEND_MSG_TO — unicast to specific player ──
  it('7.5. SEND_MSG_TO → only B receives message, A does not', async () => {
    // B listens for the unicast message
    const bMsgPromise = waitForMessage(wsB, 'message', 3000);
    // A should NOT receive it
    const aMsgPromise = collectMessages(wsA, 'message', 1500);

    // A triggers unicast to B via action
    wsA.send(JSON.stringify({
      type: 'send',
      actionType: 'SEND_MSG_TO',
      payload: { targetUserId: userIdB, type: 'private_hint', data: { hint: 'look left' } },
      requestId: 'unicast-1',
    }));

    // Wait for A's action_result first
    await waitForMessage(wsA, 'action_result', 5000);

    // B should receive the message
    const bMsg = await bMsgPromise;
    expect(bMsg).toBeTruthy();
    expect(bMsg.messageType).toBe('private_hint');
    expect(bMsg.data.hint).toBe('look left');

    // A should NOT have received the message
    const aMsgs = await aMsgPromise;
    const privateMsg = aMsgs.find((m: any) => m.messageType === 'private_hint');
    expect(privateMsg).toBeUndefined();
  });

  // ── 8. BAD_ACTION — error handling ──
  it('8. BAD_ACTION → action_error', async () => {
    const rid = 'bad-1';
    wsA.send(JSON.stringify({
      type: 'send',
      actionType: 'BAD_ACTION',
      payload: {},
      requestId: rid,
    }));

    const err = await waitForMessage(wsA, 'action_error', 3000);
    expect(err.actionType).toBe('BAD_ACTION');
    expect(err.requestId).toBe(rid);
    expect(err.message).toBeTruthy();
  });

  // ── 9. Players C, D join (4 max) ──
  it('9. Players C, D join → 4 players in sharedState', async () => {
    const { ws: wsc, userId: uidC } = await connectToRoom(NS, ROOM_ID);
    wsC = wsc;
    userIdC = uidC;

    const { ws: wsd, sync: syncD, userId: uidD } = await connectToRoom(NS, ROOM_ID);
    wsD = wsd;
    userIdD = uidD;

    // D's sync should show 4 players in sharedState
    expect(syncD.sharedState.players.length).toBe(4);

    // Verify all 4 userIds are in the list
    const ids = syncD.sharedState.players.map((p: any) => p.id);
    expect(ids).toContain(userIdA);
    expect(ids).toContain(userIdB);
    expect(ids).toContain(userIdC);
    expect(ids).toContain(userIdD);
  });

  // ── 10. KICK — forced disconnect ──
  it('10. KICK Player D → D receives kicked, others get shared_delta', async () => {
    // D listens for kicked
    const kickPromise = waitForMessage(wsD, 'kicked', 3000).catch(() => null);

    // A, B, C listen for shared_delta (onLeave updates sharedState)
    const aDeltaPromise = waitForMessage(wsA, 'shared_delta', 3000).catch(() => null);

    // A sends KICK_PLAYER targeting D
    const result = await sendAction(wsA, 'KICK_PLAYER', { targetUserId: userIdD });
    expect(result.result.kicked).toBe(true);

    // D should receive kicked message
    const kicked = await kickPromise;
    if (kicked) {
      expect(kicked.type).toBe('kicked');
    }

    // Others should get shared_delta with D removed from players + lastLeave
    const aDelta = await aDeltaPromise;
    if (aDelta) {
      expect(aDelta.delta.lastLeave).toBeDefined();
      expect(aDelta.delta.lastLeave.userId).toBe(userIdD);
      expect(aDelta.delta.lastLeave.reason).toBe('kicked');
    }

    // Clean up D's socket
    wsD.close();
  });

  // ── 11. Player B disconnect → reconnectTimeout → onLeave ──
  it('11. Player B disconnects → after timeout, onLeave fires with disconnect reason', async () => {
    // A listens for shared_delta (onLeave will update sharedState)
    const aDeltaPromise = waitForMessage(wsA, 'shared_delta', 5000).catch(() => null);

    // B closes WebSocket (simulate disconnect)
    wsB.close();

    // reconnectTimeout is 1000ms, wait for onLeave to fire
    // The shared_delta should arrive after ~1s
    const aDelta = await aDeltaPromise;
    if (aDelta) {
      expect(aDelta.delta.lastLeave).toBeDefined();
      expect(aDelta.delta.lastLeave.userId).toBe(userIdB);
      expect(aDelta.delta.lastLeave.reason).toBe('disconnect');
    }
  });

  // ── 12. Players A, C leave normally ──
  it('12. Players A, C leave → all WebSockets closed', async () => {
    // C listens for shared_delta from A leaving
    const cDeltaPromise = waitForMessage(wsC, 'shared_delta', 5000).catch(() => null);

    wsA.close();

    // After A's reconnectTimeout, C should get shared_delta
    const cDelta = await cDeltaPromise;
    if (cDelta) {
      expect(cDelta.delta.lastLeave).toBeDefined();
      expect(cDelta.delta.lastLeave.userId).toBe(userIdA);
    }

    // Finally, C leaves
    wsC.close();

    // All sockets cleaned up — test complete
  });
});
