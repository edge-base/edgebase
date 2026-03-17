import { describe, expect, it } from 'vitest';

const BASE = 'http://localhost';

async function createSession(email?: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: { id: string };
}> {
  const e = email ?? `room-signals-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'Room1234!' }),
  });
  return await res.json() as {
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  };
}

let wsCounter = 0;
async function createWS(namespace: string, roomId: string): Promise<WebSocket> {
  const fakeIp = `10.1.${Math.floor(wsCounter / 256) % 256}.${wsCounter % 256}`;
  wsCounter++;
  const res = await (globalThis as any).SELF.fetch(
    `${BASE}/api/room?namespace=${namespace}&id=${roomId}`,
    { headers: { Upgrade: 'websocket', 'X-Forwarded-For': fakeIp } },
  );
  const ws = (res as any).webSocket;
  if (!ws) {
    throw new Error(`WebSocket upgrade failed: status=${res.status}`);
  }
  ws.accept();
  return ws;
}

function waitForFrame(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeout = 3000,
): Promise<any> {
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
      } catch {
        // Ignore invalid frames.
      }
    };
    ws.addEventListener('message', handler);
    ws.addEventListener('close', () => {
      clearTimeout(timer);
      reject(new Error('WS closed'));
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WS error'));
    });
  });
}

function collectFrames(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  durationMs = 500,
): Promise<any[]> {
  return new Promise((resolve) => {
    const frames: any[] = [];
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (predicate(msg)) {
          frames.push(msg);
        }
      } catch {
        // Ignore invalid frames.
      }
    };
    ws.addEventListener('message', handler);
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      resolve(frames);
    }, durationMs);
  });
}

async function connectToRoomWithToken(
  namespace: string,
  roomId: string,
  token: string,
): Promise<{
  ws: WebSocket;
  sync: any;
  userId: string;
  connectionId: string;
}> {
  const ws = await createWS(namespace, roomId);

  ws.send(JSON.stringify({ type: 'auth', token }));
  const authMsg = await waitForFrame(ws, (msg) => msg.type === 'auth_success');

  ws.send(JSON.stringify({ type: 'join' }));
  const sync = await waitForFrame(ws, (msg) => msg.type === 'sync');

  return {
    ws,
    sync,
    userId: authMsg.userId,
    connectionId: authMsg.connectionId,
  };
}

async function connectToRoom(namespace: string, roomId: string, email?: string) {
  const session = await createSession(email);
  return connectToRoomWithToken(namespace, roomId, session.accessToken);
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
    if (predicate(meta)) {
      return meta;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timeout waiting for room metadata');
}

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

describe('Rooms runtime — signals', () => {
  it('broadcast signals exclude the sender by default and record sender metadata', async () => {
    const roomId = `signals-${uid()}`;
    const sender = await connectToRoom('test-signals', roomId);
    const receiver = await connectToRoom('test-signals', roomId);

    const senderSignals = collectFrames(
      sender.ws,
      (msg) => msg.type === 'signal' && msg.event === 'chat.message',
      400,
    );
    const receiverSignal = waitForFrame(
      receiver.ws,
      (msg) => msg.type === 'signal' && msg.event === 'chat.message',
    );

    sender.ws.send(JSON.stringify({
      type: 'signal',
      event: 'chat.message',
      payload: { text: 'hello room' },
      requestId: 'sig-chat',
    }));

    const sent = await waitForFrame(sender.ws, (msg) => msg.type === 'signal_sent');
    const received = await receiverSignal;
    const senderEchoes = await senderSignals;

    expect(sent.event).toBe('chat.message');
    expect(sent.requestId).toBe('sig-chat');
    expect(received.payload.text).toBe('hello room');
    expect(received.meta.serverSent).toBe(false);
    expect(received.meta.memberId).toBe(sender.userId);
    expect(received.meta.userId).toBe(sender.userId);
    expect(received.meta.connectionId).toBe(sender.connectionId);
    expect(senderEchoes).toHaveLength(0);

    const metadata = await waitForMetadata(
      'test-signals',
      roomId,
      (meta) => meta?.lastSignal?.event === 'chat.message',
    );
    expect(metadata.lastSignal.senderUserId).toBe(sender.userId);
    expect(metadata.lastSignal.payload.text).toBe('hello room');

    sender.ws.close();
    receiver.ws.close();
  });

  it('includeSelf echoes the signal back to the sending connection', async () => {
    const roomId = `signals-self-${uid()}`;
    const sender = await connectToRoom('test-signals', roomId);

    const echoedSignal = waitForFrame(
      sender.ws,
      (msg) => msg.type === 'signal' && msg.event === 'cursor.move',
    );

    sender.ws.send(JSON.stringify({
      type: 'signal',
      event: 'cursor.move',
      payload: { x: 10, y: 20 },
      includeSelf: true,
      requestId: 'sig-self',
    }));

    const sent = await waitForFrame(sender.ws, (msg) => msg.type === 'signal_sent');
    const received = await echoedSignal;

    expect(sent.requestId).toBe('sig-self');
    expect(received.payload).toEqual({ x: 10, y: 20 });
    expect(received.meta.userId).toBe(sender.userId);

    sender.ws.close();
  });

  it('sendTo(memberId) reaches every active connection owned by that member', async () => {
    const roomId = `signals-target-${uid()}`;
    const targetSession = await createSession();
    const targetA = await connectToRoomWithToken('test-signals', roomId, targetSession.accessToken);
    const targetB = await connectToRoomWithToken('test-signals', roomId, targetSession.accessToken);
    const sender = await connectToRoom('test-signals', roomId);

    const targetSignalA = waitForFrame(
      targetA.ws,
      (msg) => msg.type === 'signal' && msg.event === 'private_hint',
    );
    const targetSignalB = waitForFrame(
      targetB.ws,
      (msg) => msg.type === 'signal' && msg.event === 'private_hint',
    );
    const senderSignals = collectFrames(
      sender.ws,
      (msg) => msg.type === 'signal' && msg.event === 'private_hint',
      400,
    );

    sender.ws.send(JSON.stringify({
      type: 'signal',
      memberId: targetA.userId,
      event: 'private_hint',
      payload: { hint: 'look left' },
      requestId: 'sig-target',
    }));

    const sent = await waitForFrame(sender.ws, (msg) => msg.type === 'signal_sent');
    const receivedA = await targetSignalA;
    const receivedB = await targetSignalB;
    const senderReceived = await senderSignals;

    expect(sent.memberId).toBe(targetA.userId);
    expect(receivedA.payload.hint).toBe('look left');
    expect(receivedB.payload.hint).toBe('look left');
    expect(receivedA.meta.userId).toBe(sender.userId);
    expect(receivedB.meta.connectionId).toBe(sender.connectionId);
    expect(senderReceived).toHaveLength(0);

    targetA.ws.close();
    targetB.ws.close();
    sender.ws.close();
  });

  it('access.signal and hooks.signals.beforeSend can both reject delivery', async () => {
    const roomId = `signals-deny-${uid()}`;
    const sender = await connectToRoom('test-signals', roomId);
    const receiver = await connectToRoom('test-signals', roomId);

    const deniedByAccess = collectFrames(
      receiver.ws,
      (msg) => msg.type === 'signal' && msg.event === 'denied.by.access',
      300,
    );
    sender.ws.send(JSON.stringify({
      type: 'signal',
      event: 'denied.by.access',
      payload: { blocked: true },
      requestId: 'sig-access-deny',
    }));

    const accessError = await waitForFrame(
      sender.ws,
      (msg) => msg.type === 'signal_error' && msg.event === 'denied.by.access',
    );
    const accessFrames = await deniedByAccess;

    const deniedByHook = collectFrames(
      receiver.ws,
      (msg) => msg.type === 'signal' && msg.event === 'blocked.by.hook',
      300,
    );
    sender.ws.send(JSON.stringify({
      type: 'signal',
      event: 'blocked.by.hook',
      payload: { blocked: true },
      requestId: 'sig-hook-deny',
    }));

    const hookError = await waitForFrame(
      sender.ws,
      (msg) => msg.type === 'signal_error' && msg.event === 'blocked.by.hook',
    );
    const hookFrames = await deniedByHook;

    expect(accessError.message).toContain('Denied');
    expect(accessFrames).toHaveLength(0);
    expect(hookError.message).toContain('Rejected');
    expect(hookFrames).toHaveLength(0);

    sender.ws.close();
    receiver.ws.close();
  });

  it('beforeSend transforms payloads and server-originated sends use signal frames', async () => {
    const roomId = `signals-server-${uid()}`;
    const sender = await connectToRoom('test-signals', roomId);
    const receiver = await connectToRoom('test-signals', roomId);

    const transformedSignal = waitForFrame(
      receiver.ws,
      (msg) => msg.type === 'signal' && msg.event === 'transform.payload',
    );
    sender.ws.send(JSON.stringify({
      type: 'signal',
      event: 'transform.payload',
      payload: { value: 1 },
      requestId: 'sig-transform',
    }));

    await waitForFrame(sender.ws, (msg) => msg.type === 'signal_sent' && msg.event === 'transform.payload');
    const transformed = await transformedSignal;
    expect(transformed.payload).toEqual({ value: 1, transformed: true });

    const receiverServerSignalPromise = waitForFrame(
      receiver.ws,
      (msg) => msg.type === 'signal' && msg.event === 'server.notice',
    );
    const senderServerSignalsPromise = collectFrames(
      sender.ws,
      (msg) => msg.type === 'signal' && msg.event === 'server.notice',
      300,
    );

    sender.ws.send(JSON.stringify({
      type: 'send',
      actionType: 'SERVER_SIGNAL',
      payload: {
        event: 'server.notice',
        data: { text: 'from server' },
        exclude: [sender.userId],
      },
      requestId: 'server-signal',
    }));

    const actionResult = await waitForFrame(sender.ws, (msg) => msg.type === 'action_result');
    const receiverServerSignal = await receiverServerSignalPromise;
    const senderServerSignals = await senderServerSignalsPromise;

    expect(actionResult.actionType).toBe('SERVER_SIGNAL');
    expect(receiverServerSignal.payload.text).toBe('from server');
    expect(receiverServerSignal.meta.serverSent).toBe(true);
    expect(receiverServerSignal.meta.userId).toBeNull();
    expect(senderServerSignals).toHaveLength(0);

    sender.ws.close();
    receiver.ws.close();
  });
});
