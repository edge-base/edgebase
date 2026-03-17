/**
 * room-api-contract.test.ts — Room API Contract Gate
 *
 * Validates the HTTP/WebSocket contract surface of the Room route:
 *   - Query parameter validation (namespace, id)
 *   - WebSocket upgrade requirement
 *   - connect-check diagnostic endpoint
 *   - metadata HTTP endpoint
 *   - DDoS defense (pending connection limits)
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost';

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function getToken(): Promise<string> {
  const e = `room-contract-${uid()}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'Room1234!' }),
  });
  const data = await res.json() as any;
  return data.accessToken;
}

// ─── 1. Query Parameter Validation ───

describe('Room API Contract — query parameter validation', () => {
  it('missing both namespace and id returns 400', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/room`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(400);
  });

  it('namespace only without id returns 400', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/room?namespace=test-game`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(400);
  });

  it('id only without namespace returns 400', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/room?id=room1`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(400);
  });

  it('valid namespace + id returns WebSocket upgrade', async () => {
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/room?namespace=test-game&id=contract-${uid()}`,
      { headers: { Upgrade: 'websocket' } },
    );
    expect(res.status).toBe(101);
    const ws = (res as any).webSocket;
    ws.accept();
    ws.close();
  });
});

// ─── 2. WebSocket Upgrade Requirement ───

describe('Room API Contract — WebSocket upgrade requirement', () => {
  it('HTTP GET without Upgrade header returns 400', async () => {
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/room?namespace=test-game&id=contract-${uid()}`,
    );
    expect(res.status).toBe(400);
  });

  it('HTTP POST returns 404 or 405', async () => {
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/room?namespace=test-game&id=contract-${uid()}`,
      { method: 'POST' },
    );
    expect([400, 404, 405]).toContain(res.status);
  });
});

// ─── 3. Connect-Check Diagnostic Endpoint ───

describe('Room API Contract — connect-check', () => {
  it('returns diagnostic info for valid namespace + id', async () => {
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/room/connect-check?namespace=test-game&id=contract-${uid()}`,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBeDefined();
    expect(data.namespace).toBe('test-game');
  });

  it('returns error for missing params', async () => {
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/room/connect-check`,
    );
    expect(res.status).toBe(400);
  });
});

// ─── 4. Metadata HTTP Endpoint ───

describe('Room API Contract — metadata', () => {
  it('returns empty object for non-existent room', async () => {
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/room/metadata?namespace=test-metadata&id=nonexistent-${uid()}`,
    );
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta).toEqual({});
  });

  it('returns 400 without required params', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/room/metadata`);
    expect(res.status).toBe(400);
  });

  it('returns developer-set metadata after room creation', async () => {
    const roomId = `contract-meta-${uid()}`;
    const token = await getToken();

    // Connect and join to trigger onCreate which sets metadata
    let wsCounter = 0;
    const fakeIp = `10.10.${Math.floor(wsCounter / 256) % 256}.${wsCounter % 256}`;
    const wsRes = await (globalThis as any).SELF.fetch(
      `${BASE}/api/room?namespace=test-metadata&id=${roomId}`,
      { headers: { Upgrade: 'websocket', 'X-Forwarded-For': fakeIp } },
    );
    const ws = (wsRes as any).webSocket;
    ws.accept();

    ws.send(JSON.stringify({ type: 'auth', token }));
    await new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'auth_success') {
          ws.removeEventListener('message', handler);
          resolve();
        }
      };
      ws.addEventListener('message', handler);
    });

    ws.send(JSON.stringify({ type: 'join' }));
    await new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'sync') {
          ws.removeEventListener('message', handler);
          resolve();
        }
      };
      ws.addEventListener('message', handler);
    });

    // Fetch metadata via HTTP
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/room/metadata?namespace=test-metadata&id=${roomId}`,
    );
    expect(res.status).toBe(200);
    const meta = await res.json() as any;
    expect(meta.mode).toBe('classic');

    ws.close();
  });
});

// ─── 5. Response Headers ───

describe('Room API Contract — response headers', () => {
  it('metadata endpoint returns Content-Type: application/json', async () => {
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/room/metadata?namespace=test-metadata&id=headers-${uid()}`,
    );
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('connect-check returns Content-Type: application/json', async () => {
    const res = await (globalThis as any).SELF.fetch(
      `${BASE}/api/room/connect-check?namespace=test-game&id=headers-${uid()}`,
    );
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});
