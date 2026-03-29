/**
 * room-hooks.test.ts — Hooks Contract Gate
 *
 * Validates that the Room runtime correctly invokes lifecycle, member,
 * signal, session, and state hooks in the proper order and with
 * the correct context.
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost';

async function createSession(email?: string) {
  const e = email ?? `room-hooks-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'Room1234!' }),
  });
  return await res.json() as { accessToken: string; user: { id: string } };
}

let wsCounter = 0;
async function createWS(namespace: string, roomId: string): Promise<WebSocket> {
  const fakeIp = `10.6.${Math.floor(wsCounter / 256) % 256}.${wsCounter % 256}`;
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

async function connectToRoom(namespace: string, roomId: string, email?: string) {
  const session = await createSession(email);
  const ws = await createWS(namespace, roomId);
  ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
  const auth = await waitForFrame(ws, (msg) => msg.type === 'auth_success');
  ws.send(JSON.stringify({ type: 'join' }));
  const sync = await waitForFrame(ws, (msg) => msg.type === 'sync');
  return { ws, sync, userId: auth.userId, connectionId: auth.connectionId, token: session.accessToken };
}

async function fetchRoomMetadata(namespace: string, roomId: string): Promise<any> {
  const res = await (globalThis as any).SELF.fetch(
    `${BASE}/api/room/metadata?namespace=${namespace}&id=${roomId}`,
  );
  return await res.json();
}

async function waitForMetadata(namespace: string, roomId: string, predicate: (meta: any) => boolean): Promise<any> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const meta = await fetchRoomMetadata(namespace, roomId);
    if (predicate(meta)) return meta;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timeout waiting for room metadata');
}

function uid(): string { return crypto.randomUUID().slice(0, 8); }

// ─── 1. Lifecycle Hooks ───

describe('Room Hooks — lifecycle', () => {
  it('onCreate sets initial shared state and metadata', async () => {
    const roomId = `hooks-create-${uid()}`;
    const { ws, sync } = await connectToRoom('test-game', roomId);
    expect(sync.sharedState.turn).toBe(0);
    expect(sync.sharedState.score).toBe(0);
    ws.close();
  });

  it('onJoin initializes player state', async () => {
    const roomId = `hooks-join-${uid()}`;
    const { ws, sync } = await connectToRoom('test-game', roomId);
    expect(sync.playerState.hp).toBe(100);
    ws.close();
  });

  it('onLeave records leave reason in shared state', async () => {
    const roomId = `hooks-leave-${uid()}`;
    const { ws: ws1 } = await connectToRoom('test-lifecycle', roomId);
    const { ws: ws2 } = await connectToRoom('test-lifecycle', roomId);

    const deltaPromise = waitForFrame(ws2, (msg) => msg.type === 'shared_delta', 1000);
    ws1.send(JSON.stringify({ type: 'leave' }));
    const delta = await deltaPromise;
    expect(delta.delta.lastLeave.reason).toBe('leave');
    ws2.close();
  });
});

// ─── 2. Member Hooks ───

describe('Room Hooks — member hooks', () => {
  it('hooks.members.onJoin records member join in metadata', async () => {
    const roomId = `hooks-member-join-${uid()}`;
    const { ws } = await connectToRoom('test-members', roomId);

    const metadata = await waitForMetadata(
      'test-members', roomId,
      (meta) => meta?.lastMemberEvent?.type === 'join',
    );
    expect(metadata.lastMemberEvent.type).toBe('join');
    expect(typeof metadata.lastMemberEvent.memberId).toBe('string');
    ws.close();
  });

  it('hooks.members.onStateChange records state change in metadata', async () => {
    const roomId = `hooks-member-state-${uid()}`;
    const { ws } = await connectToRoom('test-members', roomId);

    // Wait for members_sync before sending state
    await waitForFrame(ws, (msg) => msg.type === 'members_sync');

    ws.send(JSON.stringify({
      type: 'member_state',
      state: { cursor: { x: 1, y: 2 } },
      requestId: 'ms1',
    }));

    const metadata = await waitForMetadata(
      'test-members', roomId,
      (meta) => meta?.lastMemberEvent?.type === 'state',
    );
    expect(metadata.lastMemberEvent.state.cursor).toEqual({ x: 1, y: 2 });
    ws.close();
  });
});

// ─── 3. Signal Hooks ───

describe('Room Hooks — signal hooks', () => {
  it('signals.onSend records sent signal in metadata', async () => {
    const roomId = `hooks-sig-${uid()}`;
    const sender = await connectToRoom('test-signals', roomId);
    const receiver = await connectToRoom('test-signals', roomId);

    sender.ws.send(JSON.stringify({
      type: 'signal', event: 'chat.message', payload: { text: 'hi' }, requestId: 'sig1',
    }));
    await waitForFrame(sender.ws, (msg) => msg.type === 'signal_sent');

    const metadata = await waitForMetadata(
      'test-signals', roomId,
      (meta) => meta?.lastSignal?.event === 'chat.message',
    );
    expect(metadata.lastSignal.payload.text).toBe('hi');
    sender.ws.close(); receiver.ws.close();
  });

  it('signals.beforeSend can transform payload', async () => {
    const roomId = `hooks-sig-transform-${uid()}`;
    const sender = await connectToRoom('test-signals', roomId);
    const receiver = await connectToRoom('test-signals', roomId);

    const transformedPromise = waitForFrame(
      receiver.ws,
      (msg) => msg.type === 'signal' && msg.event === 'transform.payload',
    );
    sender.ws.send(JSON.stringify({
      type: 'signal', event: 'transform.payload', payload: { value: 5 }, requestId: 'sig2',
    }));

    await waitForFrame(sender.ws, (msg) => msg.type === 'signal_sent');
    const received = await transformedPromise;
    expect(received.payload).toEqual({ value: 5, transformed: true });

    sender.ws.close(); receiver.ws.close();
  });

  it('signals.beforeSend can block delivery', async () => {
    const roomId = `hooks-sig-block-${uid()}`;
    const sender = await connectToRoom('test-signals', roomId);
    await connectToRoom('test-signals', roomId); // receiver

    sender.ws.send(JSON.stringify({
      type: 'signal', event: 'blocked.by.hook', payload: {}, requestId: 'sig3',
    }));
    const err = await waitForFrame(
      sender.ws,
      (msg) => msg.type === 'signal_error' && msg.event === 'blocked.by.hook',
    );
    expect(err.message).toContain('Rejected');
    sender.ws.close();
  });
});

// ─── 4. Session Hooks ───

describe('Room Hooks — session hooks', () => {
  it('session.onReconnect tracks reconnection in metadata', async () => {
    const roomId = `hooks-reconnect-${uid()}`;
    const session = await createSession();
    const ws1 = await createWS('test-members', roomId);
    ws1.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
    const auth1 = await waitForFrame(ws1, (msg) => msg.type === 'auth_success');
    ws1.send(JSON.stringify({ type: 'join' }));
    await waitForFrame(ws1, (msg) => msg.type === 'sync');
    await waitForFrame(ws1, (msg) => msg.type === 'members_sync');

    // Observer to keep room alive
    const observer = await connectToRoom('test-members', roomId);

    // Disconnect and reconnect within grace period
    ws1.close();
    await new Promise((r) => setTimeout(r, 100));

    const ws2 = await createWS('test-members', roomId);
    ws2.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
    await waitForFrame(ws2, (msg) => msg.type === 'auth_success');
    ws2.send(JSON.stringify({ type: 'join' }));
    await waitForFrame(ws2, (msg) => msg.type === 'sync');

    const metadata = await waitForMetadata(
      'test-members', roomId,
      (meta) => meta?.lastSessionEvent?.type === 'reconnect',
    );
    expect(metadata.lastSessionEvent.userId).toBe(auth1.userId);

    ws2.close();
    observer.ws.close();
  });

  it('session.onDisconnectTimeout tracks timeout in metadata', async () => {
    const roomId = `hooks-timeout-${uid()}`;
    const leaver = await connectToRoom('test-members', roomId);
    await waitForFrame(leaver.ws, (msg) => msg.type === 'members_sync');
    const observer = await connectToRoom('test-members', roomId);

    leaver.ws.close();

    const metadata = await waitForMetadata(
      'test-members', roomId,
      (meta) => meta?.lastSessionEvent?.type === 'disconnect-timeout',
    );
    expect(metadata.lastSessionEvent.userId).toBe(leaver.userId);

    observer.ws.close();
  });
});

describe('Room Hooks — state hooks', () => {
  it('hooks.state.onStateChange records delta in metadata', async () => {
    const roomId = `hooks-state-delta-${uid()}`;
    const member = await connectToRoom('test-members', roomId);
    await waitForFrame(member.ws, (msg) => msg.type === 'members_sync');

    member.ws.send(JSON.stringify({
      type: 'send', actionType: 'SET_TOPIC', payload: { topic: 'test-hooks' }, requestId: 'st1',
    }));
    await waitForFrame(member.ws, (msg) => msg.type === 'action_result' && msg.requestId === 'st1');

    const metadata = await waitForMetadata(
      'test-media-admin', roomId,
      (meta) => meta?.lastStateDelta?.topic === 'test-hooks',
    );
    expect(metadata.lastStateDelta.topic).toBe('test-hooks');

    member.ws.close();
  });
});
