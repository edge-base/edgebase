import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../../src/client.js';
import { TokenManager } from '../../src/token-manager.js';

function encodeBase64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = encodeBase64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const body = encodeBase64UrlJson(payload);
  return `${header}.${body}.fakesig`;
}

function makeValidJwt(userId = 'u-123'): string {
  return makeJwt({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
}

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(public name: string) {
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(): void {}

  addEventListener(): void {}

  removeEventListener(): void {}

  close(): void {
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter((instance) => instance !== this);
  }

  static reset(): void {
    MockBroadcastChannel.instances = [];
  }
}

function installBrowserMocks(): Map<string, string> {
  const store = new Map<string, string>();

  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel as unknown as typeof BroadcastChannel);

  return store;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  MockBroadcastChannel.reset();
});

describe('authNamespace options', () => {
  it('namespaces TokenManager storage keys and broadcast channel names', () => {
    const store = installBrowserMocks();
    const token = makeValidJwt('user-a');
    const tm = new TokenManager('http://localhost:8688', { authNamespace: 'discord-5173' });

    tm.setTokens({ accessToken: token, refreshToken: token });

    expect(store.get('edgebase:discord-5173:refresh-token')).toBe(token);
    expect(MockBroadcastChannel.instances[0]?.name).toBe('edgebase:discord-5173:auth');

    tm.destroy();
  });

  it('forwards createClient authNamespace into the internal token manager', () => {
    const store = installBrowserMocks();
    const token = makeValidJwt('user-b');
    const client = createClient('http://localhost:8688', { authNamespace: 'app-b' });
    const tokenManager = client as unknown as { tokenManager: TokenManager };

    tokenManager.tokenManager.setTokens({ accessToken: token, refreshToken: token });

    expect(store.get('edgebase:app-b:refresh-token')).toBe(token);

    client.destroy();
  });
});
