import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  createServer,
  request as requestHttp,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http';
import { request as requestHttps } from 'node:https';
import { connect, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

interface GatewayHandle {
  server: Server;
  address: AddressInfo;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  upstreamHost: string;
  upstreamPort: number;
  stopAdmission(): Promise<void>;
  stop(options?: { drainTimeoutMs?: number }): Promise<void>;
}

type StartGateway = (options: Record<string, unknown>) => Promise<GatewayHandle>;

const gatewayAssetPath = resolve(
  import.meta.dirname,
  '../src/templates/self-host/self-host-gateway.mjs',
);
const { startSelfHostGateway } = await import(pathToFileURL(gatewayAssetPath).href) as {
  startSelfHostGateway: StartGateway;
};
const WORKER_TRUST_SECRET = 'a'.repeat(64);

const TEST_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDPDCCAiSgAwIBAgIUVVX3RwFkpSyqBBL0rtpXiHWGX2cwDQYJKoZIhvcNAQEL
BQAwGDEWMBQGA1UEAwwNZWRnZWJhc2UudGVzdDAeFw0yNjA3MTYxMjAyNTZaFw0y
NjA4MTUxMjAyNTZaMBgxFjAUBgNVBAMMDWVkZ2ViYXNlLnRlc3QwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQCUzKFxvQ933do2xYRDlEzdAtJfBr3FyOci
Cia01K3Ycmg3s4DNZzfD5+CQLC3Al8lDUrmkdO5adKWzQQnMfOZpU+ZAr7kWkBTX
oQ1+Mn4U38VJrxPa2+PTlbAPAsSnjnXxC9zXJ3cWftnzhb6Anu4oopTLHe+jPFGn
hUdwRUsdxGI/0hOxSKZNIolnXI/EsHbqRIWiJceFHk65C+v7+UQ9t4hSwVF+AgNS
ouXNgTUrqDsLtWwiDQDIAB8Lndq3a5+ilq2byQpqG8XuOiMbrWVaMBSuGY3cShqa
EbtnBevN4a19fFzdM/912OAdYlCXvp2WukmSq3sxLYueoNWUFrrtAgMBAAGjfjB8
MB0GA1UdDgQWBBQjq83LyQBmwB+QVk/SVetlaF/3jjAfBgNVHSMEGDAWgBQjq83L
yQBmwB+QVk/SVetlaF/3jjAPBgNVHRMBAf8EBTADAQH/MCkGA1UdEQQiMCCCDWVk
Z2ViYXNlLnRlc3SCCWxvY2FsaG9zdIcEfwAAATANBgkqhkiG9w0BAQsFAAOCAQEA
Nf43Ebzw4IlhDPWkM0HXmwj8q6LuS7i4wOOPv58geJs0T57q5L7Qbd7DBB0hwNl2
k7p81w3bnAWJbrKF1QtD1crdeNRt3UBDzxV7HK5FwAqx+f+Sxgc2jc4o78RvZcMd
QT4IX9q8saTxg39MeF56yJGbb8DSEY5nXCkUJd/yYAiHPSS86+Uqu08vbcQOPd1F
h1nCPOBXOFTWQ0BXlUOqEUD2WvKaQTJvcUIRGUaBCQzg7oN5lfrQBom+X5bJy/Dp
s4r+soTVGT1g03F3JayErXQEbDfNJqz8mfVnnOtyP2ffBFzXo/RqV93rQIZ4SDYz
zFXe+PUeRUoJw3DgAdp02g==
-----END CERTIFICATE-----`;

const TEST_TLS_FIXTURE = [
  'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2UUlCQURBTkJna3Foa2lHOXcwQkFRRUZBQVNDQktjd2dnU2pBZ0VB',
  'QW9JQkFRQ1V6S0Z4dlE5MzNkbzIKeFlSRGxFemRBdEpmQnIzRnlPY2lDaWEwMUszWWNtZzNzNEROWnpmRDUrQ1FMQzNBbDhs',
  'RFVybWtkTzVhZEtXegpRUW5NZk9acFUrWkFyN2tXa0JUWG9RMStNbjRVMzhWSnJ4UGEyK1BUbGJBUEFzU25qblh4Qzl6WEoz',
  'Y1dmdG56CmhiNkFudTRvb3BUTEhlK2pQRkduaFVkd1JVc2R4R0kvMGhPeFNLWk5Jb2xuWEkvRXNIYnFSSVdpSmNlRkhrNjUK',
  'Qyt2NytVUTl0NGhTd1ZGK0FnTlNvdVhOZ1RVcnFEc0x0V3dpRFFESUFCOExuZHEzYTUraWxxMmJ5UXBxRzhYdQpPaU1icldW',
  'YU1CU3VHWTNjU2hxYUVidG5CZXZONGExOWZGemRNLzkxMk9BZFlsQ1h2cDJXdWttU3Ezc3hMWXVlCm9OV1VGcnJ0QWdNQkFB',
  'RUNnZ0VBQWlISWNtTytFLzZXd05BbHEvNDA5N214bi9EdHlTYXV3UnNhSU44bk9vR3gKSXBNczFrU1RWUGcrakhKRm1ZdlRN',
  'MmE5Q0RFd3RSVVV4ck80MnpneTZQRnR6Q0Y0YW0xWUR4cmNvYUZCa3pUOQprNmV4aGlJK2FtcXJvaHR0QytXTHBRK0JjNGU2',
  'T2hWSk5DY0hhcnBjT1RMVEpQSGgzQm5pSlo5UVBiaVFjZlczCnhKR3BwNDRaK08zVHM4MGdBMDFlVWtnSllFWXc2cWNJUTdq',
  'a2tkUndSSC9VSitrOXJtQy9JTXZwclJSQ2p6cTUKTFVjK2lGbjlySFNPblpGYnlTdUh0KzVKUW1RV1V4Z0k3WkZkS05ibjE4',
  'WjBSMmh5SkhLem1rQ0VDNFIvL1l6eApJSUxoMFlrN2pyaWFjTzZhNlJoVWxvcUJ0L2ZYTXgrY3ZnREFNSDM1d1FLQmdRRE9r',
  'OFViYi83Z1QyT1dhbjR3CkFTQ05BR1o1bXJhM1JhaituTWt1NHhRZlNNNXFtYVZnS2lkVDFLcVk4TXJhdkFjWEVJNy9KSFBF',
  'REUwakdaRGgKVHV2NWYyRUJlMDFVQ1I1elA3QkdVYmNuMGp3N1BvRmRtb1lBVXVjbThEcWMybC9CeWFZY01WaFZRSG5UeVhI',
  'RwplL2ZodUR3eGZaTkg5UXpEeEE2MWJ6RXdzUUtCZ1FDNFppUFBUUlByNE9iYWpXanJ4NHd6RXUvY2diQzNJKysvCkkwNWgx',
  'M1lvUHNSbnJVY2hKRXpIbTZ6czVmL0tGTVF5K2F3UTg2UWl0aThDLy9ZLzRCamx6ckZsRHZDL21WTjMKM2l0VmdqNEhYVmRZ',
  'UHlRcnBxNk5FVzBGVXU1VzEvMkNuY0JhTDBDRFBDU3BONUxNS3JTTjFHRWYyL1paSStwSwpqSGJQWVJwYy9RS0JnUUNrbzVF',
  'TWRRNGxxQ0F1MldFSTBWMG9BNUdvaVczbVUxYUUxbUJoUmduYmhTTStRb1pUClJrVmh3clRVZjlTc3ovNjJtelBjbFNqT3J4',
  'OHJRa3o5eFBDOVFKQUhwa1hUSEJGd3VPbThvWlBmNE9hd01QaloKcVRYelBCK09JUmdWdXRWbWxWZ1dVQjJlbEd5RUpxRFBH',
  'QzVQYjQ1SncxT0duZjgyWnlOeDV0VEZnUUtCZ0M4Nwpvb0tRR01FN3k0WkI0SlU4ZVBJQU1NYUh4Yzh6ZWs2NGFYUndiMGlo',
  'dzBkWFFEZ0NCMVM5MEk2aDMySlE3V3l0ClBXRGVON1hZZXJSSEFqbWNXbVJMREc5NVl6dUF0N3VsZ2U0V1BYTS9lb2NWTFZ1',
  'dEIxc0ZFcXJoY2tGMmMrNUkKSUNRNXBFbTVWeDZ0S0lINWttUWQrWDdpcGZoeFZhc2d6YklUQ21DMUFvR0FiN3ZDRnRrZlNY',
  'MXB3dzNHalA3Qwp3TXZYQnVLVE8wTkdMZmxpeDJtUWVMUndHd3BaR0k3QjdsMjF5RCt5T0NuQ2NxVitoajY1MGdVWjloOGxD',
  'dXgwCjBNbytwcTRRbTVqcWtXNUpGY01YTFArekhNd1VteGtWbHdSSWkrQWNFRWpjYlJSOGFaa3BYVWN4RDRqWGJQQW0KNmgw',
  'QWlDcFBoQWJlc2hkZ0dQc3RnUzA9Ci0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS0K',
];
const TEST_PRIVATE_KEY = Buffer.from(TEST_TLS_FIXTURE.join(''), 'base64').toString('utf8');

const gateways: GatewayHandle[] = [];
const servers: Server[] = [];
const openSockets = new Set<Socket>();

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 3_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function trackOpenSocket(socket: Socket): Socket {
  openSockets.add(socket);
  socket.once('close', () => openSockets.delete(socket));
  return socket;
}

async function listen(server: Server): Promise<number> {
  servers.push(server);
  server.on('connection', trackOpenSocket);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });
  return (server.address() as AddressInfo).port;
}

async function startGateway(
  upstreamPort: number,
  overrides: Record<string, unknown> = {},
): Promise<GatewayHandle> {
  const gateway = await startSelfHostGateway({
    host: '127.0.0.1',
    port: 0,
    upstreamPort,
    workerTrustSecret: WORKER_TRUST_SECRET,
    healthProvider: () => ({
      state: 'ready',
      structuralReady: true,
      itemFailureCount: 0,
      lastAttemptAt: 1,
      lastSuccessfulPassAt: 1,
      lastError: null,
    }),
    admissionGuard: () => true,
    ...overrides,
  });
  gateways.push(gateway);
  return gateway;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  if (!server.listening) return;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
}

afterEach(async () => {
  for (const gateway of gateways.splice(0).reverse()) {
    await gateway.stop({ drainTimeoutMs: 0 }).catch(() => {});
  }
  for (const socket of [...openSockets]) socket.destroy();
  for (const server of servers.splice(0).reverse()) {
    await closeServer(server).catch(() => {});
  }
});

interface CollectedResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  rawHeaders: string[];
  trailers: NodeJS.Dict<string>;
  body: string;
}

function collectIncomingResponse(response: IncomingMessage): Promise<CollectedResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    response.once('error', rejectPromise);
    response.once('end', () => resolvePromise({
      statusCode: response.statusCode ?? 0,
      headers: response.headers,
      rawHeaders: response.rawHeaders,
      trailers: response.trailers,
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
}

function httpRoundTrip(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<CollectedResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = requestHttp({
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: options.headers,
      agent: false,
    }, (response) => {
      void collectIncomingResponse(response).then(resolvePromise, rejectPromise);
    });
    request.once('error', rejectPromise);
    request.end(options.body);
  });
}

function rawRoundTrip(port: number, payload: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = trackOpenSocket(connect({ host: '127.0.0.1', port }));
    const chunks: Buffer[] = [];
    socket.setTimeout(3_000, () => socket.destroy(new Error('raw request timeout')));
    socket.once('connect', () => socket.write(payload));
    socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once('error', rejectPromise);
    socket.once('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
  });
}

function observeSocket(socket: Socket) {
  let transcript = '';
  const waiters = new Set<{ text: string; resolve: () => void; reject: (error: Error) => void }>();
  const inspect = () => {
    for (const waiter of waiters) {
      if (!transcript.includes(waiter.text)) continue;
      waiters.delete(waiter);
      waiter.resolve();
    }
  };
  socket.on('data', (chunk) => {
    transcript += chunk.toString('utf8');
    inspect();
  });
  socket.once('error', (error) => {
    for (const waiter of waiters) waiter.reject(error);
    waiters.clear();
  });
  socket.once('close', () => {
    for (const waiter of waiters) waiter.reject(new Error('socket closed before expected data'));
    waiters.clear();
  });
  return {
    get transcript() {
      return transcript;
    },
    waitFor(text: string) {
      if (transcript.includes(text)) return Promise.resolve();
      return withTimeout(new Promise<void>((resolvePromise, rejectPromise) => {
        waiters.add({ text, resolve: resolvePromise, reject: rejectPromise });
      }), `socket text ${JSON.stringify(text)}`);
    },
  };
}

describe('self-host gateway control-plane boundary', () => {
  it('denies every scheduled control family before upstream across confused targets', async () => {
    let upstreamRequests = 0;
    const upstreamPort = await listen(createServer((request, response) => {
      upstreamRequests += 1;
      response.end(request.url);
    }));
    const gateway = await startGateway(upstreamPort);
    const families = [
      '/cdn-cgi/handler/scheduled',
      '/cdn-cgi/mf/scheduled',
      '/__scheduled',
      '/__edgebase/internal',
    ];

    for (const family of families) {
      const variants = [
        family,
        `${family}?time=123&cron=*`,
        `${family}/`,
        `${family}/child`,
        family.replace('scheduled', 'sched%75led'),
        family.replace('scheduled', 'sched%2575led'),
        family.replaceAll('/', '\\'),
        `/safe/../${family.slice(1)}`,
        `http://attacker.invalid${family}?format=json`,
        family.toUpperCase(),
      ];
      for (const target of variants) {
        const response = await rawRoundTrip(
          gateway.port,
          `GET ${target} HTTP/1.1\r\nHost: edgebase.test\r\nConnection: close\r\n\r\n`,
        );
        expect(response, target).toContain(' 404 Not Found\r\n');
        expect(response.toLowerCase(), target).toContain('cache-control: no-store');
      }
    }

    expect(upstreamRequests).toBe(0);
  });

  it('proxies near-miss product paths but rejects unsafe upgrades and CONNECT', async () => {
    let upstreamRequests = 0;
    const upstreamPort = await listen(createServer((request, response) => {
      upstreamRequests += 1;
      response.end(`proxied:${request.url}`);
    }));
    const gateway = await startGateway(upstreamPort);
    const nearMisses = [
      '/cdn-cgi/handler/scheduledly',
      '/cdn-cgi/mf/scheduled-report',
      '/__scheduledly',
    ];

    for (const path of nearMisses) {
      const response = await rawRoundTrip(
        gateway.port,
        `GET ${path} HTTP/1.1\r\nHost: edgebase.test\r\nConnection: close\r\n\r\n`,
      );
      expect(response).toContain(' 200 OK\r\n');
      expect(response).toContain(`proxied:${path}`);
    }
    expect(upstreamRequests).toBe(nearMisses.length);

    const blockedUpgrade = await rawRoundTrip(
      gateway.port,
      'GET /__scheduled HTTP/1.1\r\nHost: edgebase.test\r\n'
        + 'Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
    );
    expect(blockedUpgrade).toContain(' 404 Not Found\r\n');

    const unsupportedUpgrade = await rawRoundTrip(
      gateway.port,
      'GET /api/health HTTP/1.1\r\nHost: edgebase.test\r\n'
        + 'Connection: Upgrade\r\nUpgrade: h2c\r\n\r\n',
    );
    expect(unsupportedUpgrade).toContain(' 400 Bad Request\r\n');

    const connectResponse = await rawRoundTrip(
      gateway.port,
      'CONNECT attacker.invalid:443 HTTP/1.1\r\nHost: attacker.invalid:443\r\n\r\n',
    );
    expect(connectResponse).toContain(' 405 Method Not Allowed\r\n');
    expect(upstreamRequests).toBe(nearMisses.length);
  });
});

describe('self-host gateway HTTP fidelity', () => {
  it('preserves end-to-end headers while overwriting spoofable forwarding authority', async () => {
    let receivedHeaders: IncomingHttpHeaders = {};
    let receivedRawHeaders: string[] = [];
    const upstreamPort = await listen(createServer((request, response) => {
      receivedHeaders = request.headers;
      receivedRawHeaders = request.rawHeaders;
      response.setHeader('Set-Cookie', ['one=1; Path=/', 'two=2; Path=/']);
      response.setHeader('Connection', 'close, x-upstream-hop');
      response.setHeader('X-Upstream-Hop', 'remove-me');
      response.setHeader('Trailer', 'X-Upstream-Trailer');
      response.write('header-body');
      response.addTrailers({ 'X-Upstream-Trailer': 'trailer-value' });
      response.end();
    }));
    const gateway = await startGateway(upstreamPort);

    const response = await httpRoundTrip(gateway.port, '/headers', {
      headers: {
        Host: 'public.example.test:9443',
        Authorization: 'Bearer synthetic-token',
        Cookie: 'session=synthetic',
        Origin: 'https://public.example.test',
        Forwarded: 'for=198.51.100.10;proto=https;host=attacker.invalid',
        'X-Forwarded-For': '198.51.100.10, 203.0.113.20',
        'X-Forwarded-Proto': 'https, http',
        'X-Forwarded-Host': 'attacker.invalid, public.example.test:9443',
        'X-EdgeBase-Self-Host-Gateway': 'b'.repeat(64),
        Connection: 'close, x-remove-me',
        'X-Remove-Me': 'hop-secret',
      },
    });

    expect(receivedHeaders.host).toBe('public.example.test:9443');
    expect(receivedHeaders.authorization).toBe('Bearer synthetic-token');
    expect(receivedHeaders.cookie).toBe('session=synthetic');
    expect(receivedHeaders.origin).toBe('https://public.example.test');
    expect(receivedHeaders.forwarded).toBeUndefined();
    expect(receivedHeaders['x-forwarded-for']).toBe('127.0.0.1');
    expect(receivedHeaders['x-forwarded-proto']).toBe('http');
    expect(receivedHeaders['x-forwarded-host']).toBe('public.example.test:9443');
    expect(receivedHeaders['x-edgebase-self-host-gateway']).toBe(WORKER_TRUST_SECRET);
    expect(receivedHeaders['x-remove-me']).toBeUndefined();
    expect(receivedRawHeaders.map((value) => value.toLowerCase())).not.toContain('x-remove-me');
    for (const name of ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host']) {
      expect(
        receivedRawHeaders.filter((_value, index) => (
          index % 2 === 0 && receivedRawHeaders[index]?.toLowerCase() === name
        )),
      ).toHaveLength(1);
    }
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('header-body');
    expect(response.headers['set-cookie']).toEqual(['one=1; Path=/', 'two=2; Path=/']);
    expect(response.headers['x-upstream-hop']).toBeUndefined();
    expect(response.trailers['x-upstream-trailer']).toBe('trailer-value');
  });

  it('preserves one complete forwarding context only from an explicitly trusted proxy CIDR', async () => {
    let receivedHeaders: IncomingHttpHeaders = {};
    let upstreamRequests = 0;
    const upstreamPort = await listen(createServer((request, response) => {
      upstreamRequests += 1;
      receivedHeaders = request.headers;
      response.end('trusted');
    }));
    const gateway = await startGateway(upstreamPort, {
      trustedProxyCidrs: ['127.0.0.1/32'],
    });

    const trusted = await httpRoundTrip(gateway.port, '/trusted', {
      headers: {
        Host: 'docker-proxy.internal:8787',
        Cookie: 'session=synthetic',
        Origin: 'https://public.example.test',
        'X-Forwarded-For': '198.51.100.42',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'public.example.test',
      },
    });
    expect(trusted).toMatchObject({ statusCode: 200, body: 'trusted' });
    expect(receivedHeaders.host).toBe('docker-proxy.internal:8787');
    expect(receivedHeaders.cookie).toBe('session=synthetic');
    expect(receivedHeaders.origin).toBe('https://public.example.test');
    expect(receivedHeaders['x-forwarded-for']).toBe('198.51.100.42');
    expect(receivedHeaders['x-forwarded-proto']).toBe('https');
    expect(receivedHeaders['x-forwarded-host']).toBe('public.example.test');

    const incomplete = await httpRoundTrip(gateway.port, '/spoof', {
      headers: {
        Host: 'docker-proxy.internal:8787',
        'X-Forwarded-For': '203.0.113.99',
      },
    });
    expect(incomplete.statusCode).toBe(400);
    expect(upstreamRequests).toBe(1);
  });

  it('fails closed before upstream for missing, duplicated, or invalid Host authority', async () => {
    let upstreamRequests = 0;
    const upstreamPort = await listen(createServer((_request, response) => {
      upstreamRequests += 1;
      response.end('must-not-run');
    }));
    const gateway = await startGateway(upstreamPort);
    const requests = [
      'GET /normal HTTP/1.0\r\nConnection: close\r\n\r\n',
      'GET /normal HTTP/1.1\r\nHost: safe.example.test\r\nHost: attacker.invalid\r\nConnection: close\r\n\r\n',
      'GET /normal HTTP/1.1\r\nHost: safe.example.test, attacker.invalid\r\nConnection: close\r\n\r\n',
    ];

    for (const request of requests) {
      const response = await rawRoundTrip(gateway.port, request);
      expect(response).toContain(' 400 Bad Request\r\n');
    }
    expect(upstreamRequests).toBe(0);
  });

  it('forwards request trailers without forwarding transport framing headers', async () => {
    const received = deferred<{ body: string; trailers: NodeJS.Dict<string> }>();
    const upstreamPort = await listen(createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.once('end', () => {
        received.resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          trailers: request.trailers,
        });
        response.end('ok');
      });
    }));
    const gateway = await startGateway(upstreamPort);

    const responsePromise = new Promise<CollectedResponse>((resolvePromise, rejectPromise) => {
      const request = requestHttp({
        hostname: '127.0.0.1',
        port: gateway.port,
        path: '/request-trailers',
        method: 'POST',
        headers: { Trailer: 'X-Client-Trailer' },
        agent: false,
      }, (response) => {
        void collectIncomingResponse(response).then(resolvePromise, rejectPromise);
      });
      request.once('error', rejectPromise);
      request.write('request-body');
      request.addTrailers({ 'X-Client-Trailer': 'client-trailer-value' });
      request.end();
    });

    await expect(responsePromise).resolves.toMatchObject({ statusCode: 200, body: 'ok' });
    await expect(received.promise).resolves.toEqual({
      body: 'request-body',
      trailers: { 'x-client-trailer': 'client-trailer-value' },
    });
  });

  it('streams an upstream response before the client upload has completed', async () => {
    const upstreamFinished = deferred<string>();
    let requestEnded = false;
    let responseWasEarly = false;
    const upstreamPort = await listen(createServer((request, response) => {
      const chunks: Buffer[] = [];
      let firstChunk = true;
      request.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
        if (!firstChunk) return;
        firstChunk = false;
        responseWasEarly = !requestEnded;
        response.write('response-before-upload-end|');
      });
      request.once('end', () => {
        requestEnded = true;
        const body = Buffer.concat(chunks).toString('utf8');
        upstreamFinished.resolve(body);
        response.end('response-after-upload-end');
      });
    }));
    const gateway = await startGateway(upstreamPort);
    const firstResponseChunk = deferred<void>();
    const completeResponse = deferred<string>();
    let responseBody = '';
    const request = requestHttp({
      hostname: '127.0.0.1',
      port: gateway.port,
      path: '/stream',
      method: 'POST',
      agent: false,
    }, (response) => {
      response.on('data', (chunk) => {
        responseBody += chunk.toString('utf8');
        if (responseBody.includes('response-before-upload-end')) firstResponseChunk.resolve();
      });
      response.once('end', () => completeResponse.resolve(responseBody));
      response.once('error', completeResponse.reject);
    });
    request.once('error', completeResponse.reject);
    request.write('first-');

    await withTimeout(firstResponseChunk.promise, 'early streamed response');
    expect(requestEnded).toBe(false);
    expect(responseWasEarly).toBe(true);
    request.end('second');

    await expect(upstreamFinished.promise).resolves.toBe('first-second');
    await expect(completeResponse.promise).resolves.toBe(
      'response-before-upload-end|response-after-upload-end',
    );
  });

  it('propagates client upload aborts to the loopback upstream', async () => {
    const upstreamSawData = deferred<void>();
    const upstreamAborted = deferred<void>();
    const upstreamPort = await listen(createServer((request) => {
      request.once('data', () => upstreamSawData.resolve());
      request.once('aborted', () => upstreamAborted.resolve());
      request.once('error', () => {});
    }));
    const gateway = await startGateway(upstreamPort);
    const request = requestHttp({
      hostname: '127.0.0.1',
      port: gateway.port,
      path: '/abort',
      method: 'POST',
      agent: false,
    });
    request.once('error', () => {});
    request.write('partial-upload');
    await withTimeout(upstreamSawData.promise, 'upstream upload data');
    request.destroy();
    await withTimeout(upstreamAborted.promise, 'upstream request abort');
  });

  it('relays Expect: 100-continue before streaming the request body', async () => {
    const upstreamBody = deferred<string>();
    const upstream = createServer();
    upstream.on('checkContinue', (request, response) => {
      response.writeContinue();
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.once('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        upstreamBody.resolve(body);
        response.end(`continued:${body}`);
      });
    });
    const upstreamPort = await listen(upstream);
    const gateway = await startGateway(upstreamPort);
    let continued = false;

    const responsePromise = new Promise<CollectedResponse>((resolvePromise, rejectPromise) => {
      const request = requestHttp({
        hostname: '127.0.0.1',
        port: gateway.port,
        path: '/continue',
        method: 'POST',
        headers: { Expect: '100-continue', 'Content-Length': '4' },
        agent: false,
      }, (response) => {
        void collectIncomingResponse(response).then(resolvePromise, rejectPromise);
      });
      request.once('continue', () => {
        continued = true;
        request.end('ping');
      });
      request.once('error', rejectPromise);
      request.flushHeaders();
    });

    const response = await withTimeout(responsePromise, '100-continue response');
    expect(continued).toBe(true);
    expect(response.body).toBe('continued:ping');
    await expect(upstreamBody.promise).resolves.toBe('ping');
  });
});

describe('self-host gateway scheduler health admission', () => {
  it('reports ready, degraded, and blocked state without proxying the health path', async () => {
    let upstreamRequests = 0;
    let admitted = true;
    let status = {
      state: 'ready',
      structuralReady: true,
      itemFailureCount: 0,
      lastAttemptAt: 10,
      lastSuccessfulPassAt: 10,
      lastError: null as string | null,
    };
    const upstreamPort = await listen(createServer((_request, response) => {
      upstreamRequests += 1;
      response.end('must-not-run');
    }));
    const gateway = await startGateway(upstreamPort, {
      healthProvider: () => status,
      admissionGuard: () => admitted,
    });

    const ready = await httpRoundTrip(gateway.port, '/__edgebase/health');
    expect(ready.statusCode).toBe(200);
    expect(JSON.parse(ready.body)).toEqual({
      schemaVersion: 1,
      outcome: 'ok',
      product: 'proxy-ready',
      scheduler: status,
    });

    status = { ...status, state: 'degraded', itemFailureCount: 2, lastError: 'item failure' };
    const degraded = await httpRoundTrip(gateway.port, '/__edgebase/health');
    expect(degraded.statusCode).toBe(200);
    expect(JSON.parse(degraded.body)).toMatchObject({ outcome: 'degraded', scheduler: status });

    admitted = false;
    const blocked = await httpRoundTrip(gateway.port, '/__edgebase/health');
    expect(blocked.statusCode).toBe(503);
    expect(JSON.parse(blocked.body)).toEqual({
      schemaVersion: 1,
      outcome: 'blocked',
      product: 'proxy-ready',
      scheduler: null,
    });
    const nonGet = await httpRoundTrip(gateway.port, '/__edgebase/health', { method: 'POST' });
    expect(nonGet.statusCode).toBe(405);
    const webSocket = await rawRoundTrip(
      gateway.port,
      'GET /__edgebase/health HTTP/1.1\r\nHost: edgebase.test\r\n'
        + 'Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
    );
    expect(webSocket).toContain(' 404 Not Found\r\n');
    expect(upstreamRequests).toBe(0);
  });
});

describe('self-host gateway WebSocket and shutdown behavior', () => {
  it('preserves trusted proxy HTTPS and client identity for WebSocket upgrade only as one complete set', async () => {
    const captured = deferred<IncomingHttpHeaders>();
    const upstream = createServer();
    upstream.on('upgrade', (request, socket) => {
      trackOpenSocket(socket);
      captured.resolve(request.headers);
      const accept = createHash('sha1')
        .update(`${String(request.headers['sec-websocket-key'])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      socket.end(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Connection: Upgrade\r\nUpgrade: websocket\r\n'
        + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
    });
    const upstreamPort = await listen(upstream);
    const gateway = await startGateway(upstreamPort, {
      trustedProxyCidrs: ['127.0.0.1/32'],
    });
    const response = await rawRoundTrip(
      gateway.port,
      'GET /api/db/subscribe HTTP/1.1\r\n'
      + 'Host: docker-proxy.internal:8787\r\n'
      + 'Connection: Upgrade\r\nUpgrade: websocket\r\n'
      + 'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
      + 'Cookie: session=synthetic\r\nOrigin: https://public.example.test\r\n'
      + 'X-Forwarded-For: 198.51.100.42\r\n'
      + 'X-Forwarded-Proto: https\r\n'
      + 'X-Forwarded-Host: public.example.test\r\n\r\n',
    );

    expect(response).toContain(' 101 Switching Protocols\r\n');
    await expect(captured.promise).resolves.toMatchObject({
      cookie: 'session=synthetic',
      origin: 'https://public.example.test',
      'x-forwarded-for': '198.51.100.42',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'public.example.test',
    });
  });

  it('preserves 101 headers and both head buffers, then relays both directions', async () => {
    const upstreamClientData = deferred<string>();
    const upstreamEnded = deferred<void>();
    let upgradeHeaders: IncomingHttpHeaders = {};
    const upstream = createServer();
    upstream.on('upgrade', (request, socket, head) => {
      trackOpenSocket(socket);
      upgradeHeaders = request.headers;
      const key = String(request.headers['sec-websocket-key']);
      const accept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Connection: Upgrade\r\n'
        + 'Upgrade: websocket\r\n'
        + `Sec-WebSocket-Accept: ${accept}\r\n`
        + 'Sec-WebSocket-Protocol: edgebase.test\r\n'
        + 'Sec-WebSocket-Extensions: permessage-deflate\r\n'
        + 'X-Upgrade-Evidence: preserved\r\n'
        + '\r\n'
        + 'upstream-head',
      );
      const relay = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        upstreamClientData.resolve(text);
        socket.write(`echo:${text}`);
      };
      if (head.length > 0) relay(head);
      socket.on('data', relay);
      socket.once('end', () => upstreamEnded.resolve());
    });
    const upstreamPort = await listen(upstream);
    const gateway = await startGateway(upstreamPort);
    const socket = trackOpenSocket(connect({ host: '127.0.0.1', port: gateway.port }));
    const observation = observeSocket(socket);
    await once(socket, 'connect');
    socket.write(
      'GET /api/db/subscribe HTTP/1.1\r\n'
      + 'Host: realtime.example.test\r\n'
      + 'Connection: keep-alive, Upgrade\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Sec-WebSocket-Version: 13\r\n'
      + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
      + 'Sec-WebSocket-Protocol: edgebase.test\r\n'
      + 'Sec-WebSocket-Extensions: permessage-deflate\r\n'
      + 'Cookie: session=synthetic\r\n'
      + 'Forwarded: for=198.51.100.1;proto=https;host=attacker.invalid\r\n'
      + 'X-Forwarded-For: 198.51.100.1, 203.0.113.1\r\n'
      + 'x-FoRwArDeD-FoR: 192.0.2.1\r\n'
      + 'X-Forwarded-Proto: https\r\n'
      + 'X-Forwarded-Host: attacker.invalid\r\n'
      + '\r\n'
      + 'client-head',
    );

    await observation.waitFor('upstream-head');
    await observation.waitFor('echo:client-head');
    expect(observation.transcript).toContain('HTTP/1.1 101 Switching Protocols');
    expect(observation.transcript).toContain('Sec-WebSocket-Protocol: edgebase.test');
    expect(observation.transcript).toContain('Sec-WebSocket-Extensions: permessage-deflate');
    expect(observation.transcript).toContain('X-Upgrade-Evidence: preserved');
    expect(upgradeHeaders.host).toBe('realtime.example.test');
    expect(upgradeHeaders.cookie).toBe('session=synthetic');
    expect(upgradeHeaders.forwarded).toBeUndefined();
    expect(upgradeHeaders['x-forwarded-for']).toBe('127.0.0.1');
    expect(upgradeHeaders['x-forwarded-proto']).toBe('http');
    expect(upgradeHeaders['x-forwarded-host']).toBe('realtime.example.test');
    await expect(upstreamClientData.promise).resolves.toBe('client-head');

    socket.write('later-data');
    await observation.waitFor('echo:later-data');
    socket.end();
    await withTimeout(upstreamEnded.promise, 'upstream WebSocket half-close');
  });

  it('drains normal HTTP before destroying tracked upgraded sockets', async () => {
    const slowStarted = deferred<void>();
    const releaseSlow = deferred<void>();
    const upgradeStarted = deferred<void>();
    const upstream = createServer((request, response) => {
      if (request.url !== '/slow') {
        response.end('ok');
        return;
      }
      response.write('slow-start');
      slowStarted.resolve();
      void releaseSlow.promise.then(() => response.end('|slow-end'));
    });
    upstream.on('upgrade', (_request, socket) => {
      trackOpenSocket(socket);
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
      );
      upgradeStarted.resolve();
    });
    const upstreamPort = await listen(upstream);
    const gateway = await startGateway(upstreamPort);

    const slowResponse = deferred<string>();
    let slowBody = '';
    const slowRequest = requestHttp({
      hostname: '127.0.0.1',
      port: gateway.port,
      path: '/slow',
      agent: false,
    }, (response) => {
      response.on('data', (chunk) => {
        slowBody += chunk.toString('utf8');
        if (slowBody.includes('slow-start')) slowStarted.resolve();
      });
      response.once('end', () => slowResponse.resolve(slowBody));
      response.once('error', slowResponse.reject);
    });
    slowRequest.once('error', slowResponse.reject);
    slowRequest.end();
    await withTimeout(slowStarted.promise, 'slow response start');

    const webSocket = trackOpenSocket(connect({ host: '127.0.0.1', port: gateway.port }));
    const webSocketObservation = observeSocket(webSocket);
    await once(webSocket, 'connect');
    webSocket.write(
      'GET /api/db/subscribe HTTP/1.1\r\nHost: edgebase.test\r\n'
      + 'Connection: Upgrade\r\nUpgrade: websocket\r\n'
      + 'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
    );
    await withTimeout(upgradeStarted.promise, 'upstream upgrade');
    await webSocketObservation.waitFor('101 Switching Protocols');
    const webSocketClosed = once(webSocket, 'close');

    let admissionClosed = false;
    const admissionClosePromise = gateway.stopAdmission().then(() => {
      admissionClosed = true;
    });
    await expect(httpRoundTrip(gateway.port, '/after-admission-stop')).rejects.toThrow();
    expect(admissionClosed).toBe(false);
    let stopped = false;
    const stopPromise = gateway.stop({ drainTimeoutMs: 500 }).then(() => {
      stopped = true;
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
    expect(stopped).toBe(false);
    expect(webSocket.destroyed).toBe(false);

    releaseSlow.resolve();
    await expect(slowResponse.promise).resolves.toBe('slow-start|slow-end');
    await withTimeout(stopPromise, 'graceful gateway stop');
    await withTimeout(admissionClosePromise, 'gateway admission close');
    await withTimeout(webSocketClosed.then(() => undefined), 'upgraded socket close');
    expect(stopped).toBe(true);
  });

  it('bounds a stalled normal drain and destroys both sides', async () => {
    const slowStarted = deferred<void>();
    const upstream = createServer((_request, response) => {
      response.write('never-finishes');
      slowStarted.resolve();
    });
    const upstreamPort = await listen(upstream);
    const gateway = await startGateway(upstreamPort);
    const clientClosed = deferred<void>();
    const request = requestHttp({
      hostname: '127.0.0.1',
      port: gateway.port,
      path: '/stalled',
      agent: false,
    }, (response) => {
      response.resume();
      response.once('close', () => clientClosed.resolve());
      response.once('error', () => {});
    });
    request.once('error', () => clientClosed.resolve());
    request.end();
    await withTimeout(slowStarted.promise, 'stalled response start');

    const startedAt = Date.now();
    await withTimeout(gateway.stop({ drainTimeoutMs: 25 }), 'bounded gateway stop');
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    await withTimeout(clientClosed.promise, 'stalled client close');
  });
});

describe('self-host gateway explicit TLS', () => {
  it('fails closed for incomplete or irrelevant TLS options', async () => {
    await expect(startSelfHostGateway({
      host: '127.0.0.1', port: 0, upstreamPort: 12345, protocol: 'https',
      workerTrustSecret: WORKER_TRUST_SECRET,
    })).rejects.toThrow('requires explicit tls.cert and tls.key');
    await expect(startSelfHostGateway({
      host: '127.0.0.1',
      port: 0,
      upstreamPort: 12345,
      protocol: 'https',
      workerTrustSecret: WORKER_TRUST_SECRET,
      tls: { cert: TEST_CERTIFICATE },
    })).rejects.toThrow('requires explicit tls.cert and tls.key');
    await expect(startSelfHostGateway({
      host: '127.0.0.1',
      port: 0,
      upstreamPort: 12345,
      protocol: 'http',
      workerTrustSecret: WORKER_TRUST_SECRET,
      tls: { cert: TEST_CERTIFICATE, key: TEST_PRIVATE_KEY },
    })).rejects.toThrow('tls is only valid when protocol is https');
  });

  it('terminates explicit HTTPS and overwrites every forwarded authority header', async () => {
    let receivedHeaders: IncomingHttpHeaders = {};
    const upstreamPort = await listen(createServer((request, response) => {
      receivedHeaders = request.headers;
      response.end('secure-ok');
    }));
    const gateway = await startGateway(upstreamPort, {
      protocol: 'https',
      tls: { cert: TEST_CERTIFICATE, key: TEST_PRIVATE_KEY },
    });

    const response = await new Promise<CollectedResponse>((resolvePromise, rejectPromise) => {
      const request = requestHttps({
        hostname: '127.0.0.1',
        port: gateway.port,
        path: '/secure',
        rejectUnauthorized: false,
        agent: false,
        headers: {
          Host: 'secure.example.test:9443',
          Authorization: 'Bearer secure-synthetic',
          Cookie: 'secure-session=synthetic',
          Origin: 'https://secure.example.test',
          Forwarded: 'for=203.0.113.50;proto=http;host=attacker.invalid',
          'X-Forwarded-For': '203.0.113.50',
          'X-Forwarded-Proto': 'http',
          'X-Forwarded-Host': 'attacker.invalid',
        },
      }, (incoming) => {
        void collectIncomingResponse(incoming).then(resolvePromise, rejectPromise);
      });
      request.once('error', rejectPromise);
      request.end();
    });

    expect(response).toMatchObject({ statusCode: 200, body: 'secure-ok' });
    expect(receivedHeaders.host).toBe('secure.example.test:9443');
    expect(receivedHeaders.authorization).toBe('Bearer secure-synthetic');
    expect(receivedHeaders.cookie).toBe('secure-session=synthetic');
    expect(receivedHeaders.origin).toBe('https://secure.example.test');
    expect(receivedHeaders.forwarded).toBeUndefined();
    expect(receivedHeaders['x-forwarded-for']).toBe('127.0.0.1');
    expect(receivedHeaders['x-forwarded-proto']).toBe('https');
    expect(receivedHeaders['x-forwarded-host']).toBe('secure.example.test:9443');
    expect(gateway.upstreamHost).toBe('127.0.0.1');
  });
});
