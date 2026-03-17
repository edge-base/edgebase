import { describe, expect, it } from 'vitest';

const BASE = 'http://localhost';

async function createSession(email?: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: { id: string };
}> {
  const e = email ?? `room-media-${crypto.randomUUID().slice(0, 8)}@test.com`;
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
  const fakeIp = `10.3.${Math.floor(wsCounter / 256) % 256}.${wsCounter % 256}`;
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
  sync: any;
  membersSync: any;
  mediaSync: any;
}> {
  const ws = await createWS(namespace, roomId);

  ws.send(JSON.stringify({ type: 'auth', token }));
  const authMsg = await waitForFrame(ws, (msg) => msg.type === 'auth_success');

  ws.send(JSON.stringify({ type: 'join' }));
  const sync = await waitForFrame(ws, (msg) => msg.type === 'sync');
  const membersSync = await waitForFrame(ws, (msg) => msg.type === 'members_sync');
  const mediaSync = await waitForFrame(ws, (msg) => msg.type === 'media_sync');

  return {
    ws,
    userId: authMsg.userId,
    connectionId: authMsg.connectionId,
    sync,
    membersSync,
    mediaSync,
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

describe('Rooms runtime — admin and media', () => {
  it('runs hooks.state.onStateChange for shared-state actions in the rooms runtime', async () => {
    const roomId = `media-state-${uid()}`;
    const member = await connectToRoom('test-media-admin', roomId);

    const deltaPromise = waitForFrame(
      member.ws,
      (msg) => msg.type === 'shared_delta' && msg.delta.topic === 'focus',
    );
    member.ws.send(JSON.stringify({
      type: 'send',
      actionType: 'SET_TOPIC',
      payload: { topic: 'focus' },
      requestId: 'set-topic',
    }));

    const actionResult = await waitForFrame(
      member.ws,
      (msg) => msg.type === 'action_result' && msg.requestId === 'set-topic',
    );
    const delta = await deltaPromise;

    expect(actionResult.result.topic).toBe('focus');
    expect(delta.delta.topic).toBe('focus');

    const metadata = await waitForMetadata(
      'test-media-admin',
      roomId,
      (meta) => meta?.lastStateDelta?.topic === 'focus',
    );
    expect(metadata.lastStateDelta.topic).toBe('focus');

    member.ws.close();
  });

  it('propagates admin-assigned roles into member sync and media publish access', async () => {
    const roomId = `media-role-${uid()}`;
    const admin = await connectToRoom('test-media-admin', roomId, `admin-${uid()}@test.com`);
    const member = await connectToRoom('test-media-admin', roomId);

    member.ws.send(JSON.stringify({
      type: 'media',
      operation: 'publish',
      kind: 'screen',
      payload: { trackId: 'screen-track-1', deviceId: 'screen-device-1' },
      requestId: 'screen-denied',
    }));

    const denied = await waitForFrame(
      member.ws,
      (msg) => msg.type === 'media_error' && msg.requestId === 'screen-denied',
    );
    expect(denied.message).toContain('Denied');

    const memberSyncPromise = waitForFrame(
      member.ws,
      (msg) =>
        msg.type === 'members_sync' &&
        msg.members.some((entry: any) => entry.memberId === member.userId && entry.role === 'host'),
    );
    admin.ws.send(JSON.stringify({
      type: 'admin',
      operation: 'setRole',
      memberId: member.userId,
      payload: { role: 'host' },
      requestId: 'set-role',
    }));

    const adminResult = await waitForFrame(
      admin.ws,
      (msg) => msg.type === 'admin_result' && msg.requestId === 'set-role',
    );
    const synced = await memberSyncPromise;

    expect(adminResult.operation).toBe('setRole');
    expect(synced.members.find((entry: any) => entry.memberId === member.userId)?.role).toBe('host');

    const mediaTrackPromise = waitForFrame(
      admin.ws,
      (msg) =>
        msg.type === 'media_track' &&
        msg.member.memberId === member.userId &&
        msg.track.kind === 'screen',
    );
    member.ws.send(JSON.stringify({
      type: 'media',
      operation: 'publish',
      kind: 'screen',
      payload: { trackId: 'screen-track-1', deviceId: 'screen-device-1' },
      requestId: 'screen-allowed',
    }));

    const publishResult = await waitForFrame(
      member.ws,
      (msg) => msg.type === 'media_result' && msg.requestId === 'screen-allowed',
    );
    const trackFrame = await mediaTrackPromise;

    expect(publishResult.operation).toBe('publish');
    expect(trackFrame.track.trackId).toBe('screen-track-1');

    const metadata = await waitForMetadata(
      'test-media-admin',
      roomId,
      (meta) => meta?.lastMediaEvent?.type === 'published' && meta.lastMediaEvent.kind === 'screen',
    );
    expect(metadata.lastMediaEvent.memberId).toBe(member.userId);
    expect(metadata.lastMediaEvent.role).toBe('host');

    admin.ws.close();
    member.ws.close();
  });

  it('blocks members, kicks active connections, and denies future joins', async () => {
    const roomId = `media-block-${uid()}`;
    const admin = await connectToRoom('test-media-admin', roomId, `admin-${uid()}@test.com`);
    const targetSession = await createSession();
    const target = await connectToRoomWithToken('test-media-admin', roomId, targetSession.accessToken);

    const leavePromise = waitForFrame(
      admin.ws,
      (msg) => msg.type === 'member_leave' && msg.member.memberId === target.userId,
      1500,
    );
    const kickedPromise = waitForFrame(target.ws, (msg) => msg.type === 'kicked', 1500);

    admin.ws.send(JSON.stringify({
      type: 'admin',
      operation: 'block',
      memberId: target.userId,
      requestId: 'block-member',
    }));

    const adminResult = await waitForFrame(
      admin.ws,
      (msg) => msg.type === 'admin_result' && msg.requestId === 'block-member',
    );
    const kicked = await kickedPromise;
    const leaveEvent = await leavePromise;

    expect(adminResult.operation).toBe('block');
    expect(kicked.type).toBe('kicked');
    expect(leaveEvent.reason).toBe('kicked');

    const retry = await createWS('test-media-admin', roomId);
    retry.send(JSON.stringify({ type: 'auth', token: targetSession.accessToken }));
    await waitForFrame(retry, (msg) => msg.type === 'auth_success');
    retry.send(JSON.stringify({ type: 'join' }));

    const joinDenied = await waitForFrame(
      retry,
      (msg) => msg.type === 'error' && msg.code === 'JOIN_DENIED',
      1500,
    );
    expect(joinDenied.message).toContain('Blocked');

    admin.ws.close();
    retry.close();
  });

  it('filters media sync and track delivery through access.media.subscribe', async () => {
    const roomId = `media-sync-${uid()}`;
    const publisher = await connectToRoom('test-media-admin', roomId);

    publisher.ws.send(JSON.stringify({
      type: 'media',
      operation: 'publish',
      kind: 'video',
      payload: { deviceId: 'cam-1' },
      requestId: 'publish-video',
    }));

    await waitForFrame(
      publisher.ws,
      (msg) => msg.type === 'media_result' && msg.requestId === 'publish-video',
    );

    const observer = await connectToRoom('test-media-admin', roomId);
    const blind = await connectToRoom('test-media-admin', roomId, `blind-${uid()}@test.com`);

    expect(observer.mediaSync.members).toHaveLength(1);
    expect(observer.mediaSync.members[0].member.memberId).toBe(publisher.userId);
    expect(observer.mediaSync.members[0].tracks[0].trackId).toBe('hook-video-track');
    expect(blind.mediaSync.members).toHaveLength(0);

    const blindFrames = collectFrames(
      blind.ws,
      (msg) =>
        (msg.type === 'media_track' || msg.type === 'media_state') &&
        msg.member?.memberId === publisher.userId,
      400,
    );
    publisher.ws.send(JSON.stringify({
      type: 'media',
      operation: 'mute',
      kind: 'video',
      payload: { muted: true },
      requestId: 'mute-video',
    }));

    await waitForFrame(
      publisher.ws,
      (msg) => msg.type === 'media_result' && msg.requestId === 'mute-video',
    );
    const hiddenFrames = await blindFrames;
    expect(hiddenFrames).toHaveLength(0);

    publisher.ws.close();
    observer.ws.close();
    blind.ws.close();
  });

  it('supports admin mute plus device and unpublish media controls', async () => {
    const roomId = `media-controls-${uid()}`;
    const admin = await connectToRoom('test-media-admin', roomId, `admin-${uid()}@test.com`);
    const member = await connectToRoom('test-media-admin', roomId);
    const observer = await connectToRoom('test-media-admin', roomId);

    const publishedTrack = waitForFrame(
      observer.ws,
      (msg) =>
        msg.type === 'media_track' &&
        msg.member.memberId === member.userId &&
        msg.track.kind === 'audio',
    );
    member.ws.send(JSON.stringify({
      type: 'media',
      operation: 'publish',
      kind: 'audio',
      payload: { trackId: 'mic-track-1', deviceId: 'mic-1' },
      requestId: 'publish-audio',
    }));

    await waitForFrame(
      member.ws,
      (msg) => msg.type === 'media_result' && msg.requestId === 'publish-audio',
    );
    const published = await publishedTrack;
    expect(published.track.trackId).toBe('mic-track-1');

    const mutedStatePromise = waitForFrame(
      observer.ws,
      (msg) =>
        msg.type === 'media_state' &&
        msg.member.memberId === member.userId &&
        msg.state.audio?.muted === true,
    );
    admin.ws.send(JSON.stringify({
      type: 'admin',
      operation: 'mute',
      memberId: member.userId,
      requestId: 'admin-mute',
    }));

    await waitForFrame(
      admin.ws,
      (msg) => msg.type === 'admin_result' && msg.requestId === 'admin-mute',
    );
    const mutedState = await mutedStatePromise;
    expect(mutedState.state.audio.muted).toBe(true);

    const muteMetadata = await waitForMetadata(
      'test-media-admin',
      roomId,
      (meta) => meta?.lastMediaEvent?.type === 'mute',
    );
    expect(muteMetadata.lastMediaEvent.memberId).toBe(member.userId);

    const deviceFramePromise = waitForFrame(
      observer.ws,
      (msg) =>
        msg.type === 'media_device' &&
        msg.member.memberId === member.userId &&
        msg.kind === 'audio',
    );
    member.ws.send(JSON.stringify({
      type: 'media',
      operation: 'device',
      kind: 'audio',
      payload: { deviceId: 'mic-2' },
      requestId: 'switch-device',
    }));

    await waitForFrame(
      member.ws,
      (msg) => msg.type === 'media_result' && msg.requestId === 'switch-device',
    );
    const deviceFrame = await deviceFramePromise;
    expect(deviceFrame.deviceId).toBe('mic-2');

    const removedTrackPromise = waitForFrame(
      observer.ws,
      (msg) =>
        msg.type === 'media_track_removed' &&
        msg.member.memberId === member.userId &&
        msg.track.kind === 'audio',
    );
    member.ws.send(JSON.stringify({
      type: 'media',
      operation: 'unpublish',
      kind: 'audio',
      requestId: 'unpublish-audio',
    }));

    await waitForFrame(
      member.ws,
      (msg) => msg.type === 'media_result' && msg.requestId === 'unpublish-audio',
    );
    const removedTrack = await removedTrackPromise;
    expect(removedTrack.track.trackId).toBe('mic-track-1');

    const unpublishMetadata = await waitForMetadata(
      'test-media-admin',
      roomId,
      (meta) => meta?.lastMediaEvent?.type === 'unpublished',
    );
    expect(unpublishMetadata.lastMediaEvent.memberId).toBe(member.userId);

    admin.ws.close();
    member.ws.close();
    observer.ws.close();
  });
});
