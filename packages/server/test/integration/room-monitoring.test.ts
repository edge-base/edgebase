import { describe, expect, it } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function createSession(email?: string) {
  const e = email ?? `room-monitor-${uid()}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'Room1234!' }),
  });
  return await res.json() as { accessToken: string };
}

let wsCounter = 0;
async function createRoomSocket(namespace: string, roomId: string): Promise<WebSocket> {
  const fakeIp = `10.8.${Math.floor(wsCounter / 256) % 256}.${wsCounter % 256}`;
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
        // Ignore malformed frames in test harness.
      }
    };
    ws.addEventListener('message', handler);
    ws.addEventListener('close', () => {
      clearTimeout(timer);
      reject(new Error('WS closed'));
    });
  });
}

async function getMonitoring(): Promise<any> {
  const res = await (globalThis as any).SELF.fetch(`${BASE}/admin/api/data/monitoring`, {
    headers: { 'X-EdgeBase-Service-Key': SK },
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function waitForMonitoring(predicate: (data: any) => boolean): Promise<any> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const data = await getMonitoring();
    if (predicate(data)) return data;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timeout waiting for monitoring snapshot');
}

describe('room monitoring', () => {
  it('reports active authenticated room connections and clears them after disconnect', async () => {
    const roomId = `monitor-${uid()}`;
    const session = await createSession();
    const ws = await createRoomSocket('test-game', roomId);

    try {
      ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
      await waitForFrame(ws, (msg) => msg.type === 'auth_success');
      ws.send(JSON.stringify({ type: 'join' }));
      await waitForFrame(ws, (msg) => msg.type === 'sync');

      const liveStats = await waitForMonitoring((data) => (
        data?.rooms?.channelDetails?.some?.(
          (entry: any) => entry.channel === `test-game::${roomId}` && entry.subscribers >= 1,
        )
      ));

      expect(liveStats.rooms.activeConnections).toBeGreaterThanOrEqual(1);
      expect(liveStats.rooms.authenticatedConnections).toBeGreaterThanOrEqual(1);

      ws.close(1000, 'test cleanup');

      const clearedStats = await waitForMonitoring((data) => !data?.rooms?.channelDetails?.some?.(
        (entry: any) => entry.channel === `test-game::${roomId}`,
      ));

      expect(clearedStats.rooms.channelDetails.some(
        (entry: any) => entry.channel === `test-game::${roomId}`,
      )).toBe(false);
    } finally {
      try {
        ws.close(1000, 'final cleanup');
      } catch {
        // Ignore redundant close attempts.
      }
    }
  });
});
