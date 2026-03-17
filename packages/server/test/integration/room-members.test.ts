import { describe, expect, it } from 'vitest';

const BASE = 'http://localhost';

async function createSession(email?: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: { id: string };
}> {
  const e = email ?? `room-members-${crypto.randomUUID().slice(0, 8)}@test.com`;
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
  const fakeIp = `10.2.${Math.floor(wsCounter / 256) % 256}.${wsCounter % 256}`;
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
  userId: string;
  connectionId: string;
  membersSync: any;
}> {
  const ws = await createWS(namespace, roomId);

  ws.send(JSON.stringify({ type: 'auth', token }));
  const authMsg = await waitForFrame(ws, (msg) => msg.type === 'auth_success');

  ws.send(JSON.stringify({ type: 'join' }));
  await waitForFrame(ws, (msg) => msg.type === 'sync');
  const membersSync = await waitForFrame(ws, (msg) => msg.type === 'members_sync');

  return {
    ws,
    userId: authMsg.userId,
    connectionId: authMsg.connectionId,
    membersSync,
  };
}

async function connectToRoom(namespace: string, roomId: string, email?: string) {
  const session = await createSession(email);
  const connection = await connectToRoomWithToken(namespace, roomId, session.accessToken);
  return {
    ...connection,
    accessToken: session.accessToken,
  };
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

describe('Rooms runtime — members', () => {
  it('emits members_sync and logical member_join events on join', async () => {
    const roomId = `members-join-${uid()}`;
    const first = await connectToRoom('test-members', roomId);

    expect(first.membersSync.members).toHaveLength(1);
    expect(first.membersSync.members[0].memberId).toBe(first.userId);
    expect(first.membersSync.members[0].connectionCount).toBe(1);

    const joinEventPromise = waitForFrame(
      first.ws,
      (msg) => msg.type === 'member_join',
    );
    const syncUpdatePromise = waitForFrame(
      first.ws,
      (msg) => msg.type === 'members_sync' && msg.members.length === 2,
    );

    const second = await connectToRoom('test-members', roomId);
    const joinEvent = await joinEventPromise;
    const syncUpdate = await syncUpdatePromise;

    expect(joinEvent.member.memberId).toBe(second.userId);
    expect(syncUpdate.members.map((member: any) => member.memberId)).toContain(second.userId);
    expect(second.membersSync.members).toHaveLength(2);

    first.ws.close();
    second.ws.close();
  });

  it('broadcasts latest-value member state changes and clears them explicitly', async () => {
    const roomId = `members-state-${uid()}`;
    const sender = await connectToRoom('test-members', roomId);
    const receiver = await connectToRoom('test-members', roomId);

    const stateUpdatePromise = waitForFrame(
      receiver.ws,
      (msg) => msg.type === 'member_state' && msg.member.memberId === sender.userId,
    );
    sender.ws.send(JSON.stringify({
      type: 'member_state',
      state: { typing: true, cursor: { x: 4, y: 8 } },
      requestId: 'member-state-set',
    }));

    const stateUpdate = await stateUpdatePromise;
    expect(stateUpdate.state).toEqual({ typing: true, cursor: { x: 4, y: 8 } });

    const metadata = await waitForMetadata(
      'test-members',
      roomId,
      (meta) => meta?.lastMemberEvent?.type === 'state',
    );
    expect(metadata.lastMemberEvent.memberId).toBe(sender.userId);
    expect(metadata.lastMemberEvent.state.typing).toBe(true);

    const clearPromise = waitForFrame(
      receiver.ws,
      (msg) =>
        msg.type === 'member_state' &&
        msg.member.memberId === sender.userId &&
        Object.keys(msg.state).length === 0,
    );
    sender.ws.send(JSON.stringify({
      type: 'member_state_clear',
      requestId: 'member-state-clear',
    }));

    const cleared = await clearPromise;
    expect(cleared.state).toEqual({});

    sender.ws.close();
    receiver.ws.close();
  });

  it('tracks multi-connection members without duplicating logical join events', async () => {
    const roomId = `members-multi-${uid()}`;
    const session = await createSession();
    const first = await connectToRoomWithToken('test-members', roomId, session.accessToken);

    const duplicateJoinEvents = collectFrames(
      first.ws,
      (msg) => msg.type === 'member_join',
      400,
    );
    const syncUpdatePromise = waitForFrame(
      first.ws,
      (msg) =>
        msg.type === 'members_sync' &&
        msg.members.length === 1 &&
        msg.members[0].memberId === first.userId &&
        msg.members[0].connectionCount === 2,
    );

    const second = await connectToRoomWithToken('test-members', roomId, session.accessToken);
    const syncUpdate = await syncUpdatePromise;
    const joinEvents = await duplicateJoinEvents;

    expect(syncUpdate.members[0].connectionCount).toBe(2);
    expect(second.membersSync.members).toHaveLength(1);
    expect(second.membersSync.members[0].connectionCount).toBe(2);
    expect(joinEvents).toHaveLength(0);

    first.ws.close();
    second.ws.close();
  });

  it('keeps a member during reconnect grace and restores connectionCount without leave/join churn', async () => {
    const roomId = `members-reconnect-${uid()}`;
    const reconnecting = await createSession();
    const first = await connectToRoomWithToken('test-members', roomId, reconnecting.accessToken);
    const observer = await connectToRoom('test-members', roomId);

    const transientSyncPromise = waitForFrame(
      observer.ws,
      (msg) =>
        msg.type === 'members_sync' &&
        msg.members.some((member: any) => member.memberId === first.userId && member.connectionCount === 0),
      1000,
    );
    const memberEventsDuringGrace = collectFrames(
      observer.ws,
      (msg) =>
        (msg.type === 'member_join' || msg.type === 'member_leave') &&
        msg.member.memberId === first.userId,
      500,
    );

    first.ws.close();
    await transientSyncPromise;

    const restoredSyncPromise = waitForFrame(
      observer.ws,
      (msg) =>
        msg.type === 'members_sync' &&
        msg.members.some((member: any) => member.memberId === first.userId && member.connectionCount === 1),
      1000,
    );
    const reconnected = await connectToRoomWithToken('test-members', roomId, reconnecting.accessToken);
    const restoredSync = await restoredSyncPromise;
    const lifecycleEvents = await memberEventsDuringGrace;

    const restoredMember = restoredSync.members.find((member: any) => member.memberId === first.userId);
    expect(restoredMember.connectionCount).toBe(1);
    expect(lifecycleEvents).toHaveLength(0);

    const metadata = await waitForMetadata(
      'test-members',
      roomId,
      (meta) => meta?.lastSessionEvent?.type === 'reconnect',
    );
    expect(metadata.lastSessionEvent.userId).toBe(first.userId);

    observer.ws.close();
    reconnected.ws.close();
  });

  it('emits timeout leave when reconnect grace expires', async () => {
    const roomId = `members-timeout-${uid()}`;
    const leaver = await connectToRoom('test-members', roomId);
    const observer = await connectToRoom('test-members', roomId);

    const reconnectingSyncPromise = waitForFrame(
      observer.ws,
      (msg) =>
        msg.type === 'members_sync' &&
        msg.members.some((member: any) => member.memberId === leaver.userId && member.connectionCount === 0),
      1000,
    );
    const leavePromise = waitForFrame(
      observer.ws,
      (msg) => msg.type === 'member_leave' && msg.member.memberId === leaver.userId,
      1500,
    );

    leaver.ws.close();

    await reconnectingSyncPromise;
    const leaveEvent = await leavePromise;
    const finalSync = await waitForFrame(
      observer.ws,
      (msg) =>
        msg.type === 'members_sync' &&
        !msg.members.some((member: any) => member.memberId === leaver.userId),
      1000,
    );

    expect(leaveEvent.reason).toBe('timeout');
    expect(finalSync.members).toHaveLength(1);

    const metadata = await waitForMetadata(
      'test-members',
      roomId,
      (meta) => meta?.lastMemberEvent?.reason === 'timeout',
    );
    expect(metadata.lastMemberEvent.memberId).toBe(leaver.userId);
    expect(metadata.lastSessionEvent.type).toBe('disconnect-timeout');
    expect(metadata.lastSessionEvent.userId).toBe(leaver.userId);

    observer.ws.close();
  });

  it('emits kicked leave for logical members', async () => {
    const roomId = `members-kick-${uid()}`;
    const host = await connectToRoom('test-members', roomId);
    const target = await connectToRoom('test-members', roomId);

    const kickedPromise = waitForFrame(target.ws, (msg) => msg.type === 'kicked', 1500);
    const leavePromise = waitForFrame(
      host.ws,
      (msg) => msg.type === 'member_leave' && msg.member.memberId === target.userId,
      1500,
    );

    host.ws.send(JSON.stringify({
      type: 'send',
      actionType: 'KICK_MEMBER',
      payload: { memberId: target.userId },
      requestId: 'kick-member',
    }));

    const actionResult = await waitForFrame(host.ws, (msg) => msg.type === 'action_result');
    const kicked = await kickedPromise;
    const leaveEvent = await leavePromise;

    expect(actionResult.actionType).toBe('KICK_MEMBER');
    expect(kicked.type).toBe('kicked');
    expect(leaveEvent.reason).toBe('kicked');

    const finalSync = await waitForFrame(
      host.ws,
      (msg) =>
        msg.type === 'members_sync' &&
        !msg.members.some((member: any) => member.memberId === target.userId),
      1000,
    );
    expect(finalSync.members).toHaveLength(1);

    host.ws.close();
  });
});
