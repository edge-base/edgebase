import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as wranglerTools from '../src/lib/wrangler.js';

type PreparedWranglerDevTool = {
  command: string;
  argsPrefix: string[];
  runtimeDir: string;
};

type PrepareWranglerDevTool = (
  baseDir: string,
  cacheRoot: string,
) => PreparedWranglerDevTool;

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(process.cwd(), '.edgebase-wrangler-proxy-'));
  tempRoots.push(root);
  return root;
}

function writeFixtureWrangler(projectDir: string): string {
  const packageDir = join(projectDir, 'node_modules', 'wrangler');
  const dependencyRoot = join(
    projectDir,
    'node_modules',
    '.pnpm',
    'wrangler@4.113.0-fixture',
    'node_modules',
  );
  const realPackageDir = join(dependencyRoot, 'wrangler');
  const files = new Map([
    ['package.json', JSON.stringify({
      name: 'wrangler',
      version: '4.113.0-fixture',
      type: 'module',
      bin: { wrangler: './bin/wrangler.js' },
    })],
    ['bin/wrangler.js', '#!/usr/bin/env node\nimport "../wrangler-dist/cli.js";\n'],
    [
      'wrangler-dist/cli.js',
      'import fixtureDependency from "fixture-dependency";\n'
      + 'console.log(fixtureDependency);\n',
    ],
    ['wrangler-dist/InspectorProxyWorker.js', 'export default {};\n'],
    ['wrangler-dist/ProxyWorker.js', 'export const upstreamFixture = true;\n'],
    ['config-schema.json', '{}\n'],
  ]);

  for (const [relativePath, content] of files) {
    const path = join(realPackageDir, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const fixtureDependencyDir = join(dependencyRoot, 'fixture-dependency');
  mkdirSync(fixtureDependencyDir, { recursive: true });
  writeFileSync(
    join(fixtureDependencyDir, 'package.json'),
    JSON.stringify({ name: 'fixture-dependency', type: 'module', main: './index.js' }),
  );
  writeFileSync(join(fixtureDependencyDir, 'index.js'), 'export default "fixture-ready";\n');
  mkdirSync(dirname(packageDir), { recursive: true });
  symlinkSync(realPackageDir, packageDir, 'dir');
  return packageDir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('EdgeBase-owned Wrangler development proxy', () => {
  it('leaves ordinary Wrangler command resolution unchanged', () => {
    const projectDir = tempRoot();
    const packageDir = writeFixtureWrangler(projectDir);

    const tool = wranglerTools.resolveWranglerTool(projectDir);

    expect(tool.command).toBe(process.execPath);
    expect(tool.argsPrefix).toEqual([join(packageDir, 'bin', 'wrangler.js')]);
    expect(readFileSync(join(packageDir, 'wrangler-dist', 'ProxyWorker.js'), 'utf8'))
      .toContain('upstreamFixture');
  });

  it('bounds same-worker proxy work in each request context without replaying POST', async () => {
    const projectDir = tempRoot();
    const packageDir = writeFixtureWrangler(projectDir);
    const cacheRoot = join(projectDir, '.edgebase', 'dev', 'wrangler-runtime');
    const prepareWranglerDevTool = (
      wranglerTools as unknown as Record<string, unknown>
    ).prepareWranglerDevTool;

    expect(
      prepareWranglerDevTool,
      'edgebase dev must prepare an isolated, EdgeBase-owned proxy runtime',
    ).toBeTypeOf('function');
    if (typeof prepareWranglerDevTool !== 'function') return;

    const prepared = (prepareWranglerDevTool as PrepareWranglerDevTool)(
      projectDir,
      cacheRoot,
    );
    expect(prepared.command).toBe(process.execPath);
    expect(prepared.argsPrefix[0]).toBe(join(prepared.runtimeDir, 'bin', 'wrangler.js'));
    expect(prepared.argsPrefix[0]).not.toBe(join(packageDir, 'bin', 'wrangler.js'));
    expect(readFileSync(join(packageDir, 'wrangler-dist', 'ProxyWorker.js'), 'utf8'))
      .toContain('upstreamFixture');
    const commandResult = spawnSync(
      prepared.command,
      [...prepared.argsPrefix, '--version'],
      { encoding: 'utf8' },
    );
    expect(commandResult.status, commandResult.stderr).toBe(0);
    expect(commandResult.stdout).toContain('fixture-ready');

    const proxyModuleUrl = pathToFileURL(
      join(prepared.runtimeDir, 'wrangler-dist', 'ProxyWorker.js'),
    );
    proxyModuleUrl.searchParams.set('fixture', String(Date.now()));
    const proxyModule = await import(proxyModuleUrl.href) as {
      ProxyWorker: new (
        state: {
          acceptWebSocket(webSocket: unknown, tags: string[]): void;
          getWebSockets(tag: string): unknown[];
        },
        env: { PROXY_CONTROLLER: { fetch(request: Request | string): Promise<Response> } },
      ) => {
        downstreamIdleAbandonMs: number;
        fetch(request: Request): Promise<Response>;
        processProxyControllerRequest(request: Request): Response;
      };
    };
    expect(Object.keys(proxyModule).sort()).toEqual(['ProxyWorker', 'default']);
    const { ProxyWorker } = proxyModule;

    let controllerMessages = 0;
    const proxy = new ProxyWorker(
      {
        acceptWebSocket: () => {},
        getWebSockets: () => [],
      },
      {
        PROXY_CONTROLLER: {
          fetch: async () => {
            controllerMessages++;
            return new Response(null, { status: 204 });
          },
        },
      },
    );
    proxy.processProxyControllerRequest({
      cf: {
        hostMetadata: {
          type: 'play',
          proxyData: {
            userWorkerUrl: {
              protocol: 'http:',
              hostname: 'worker.test',
              port: '80',
            },
          },
        },
      },
    } as unknown as Request);

    let active = 0;
    let maxActive = 0;
    let userWorkerCalls = 0;
    let preservedBrowserOrigin = '';
    vi.stubGlobal('fetch', async (_input, init) => {
      userWorkerCalls++;
      if (init instanceof Request && init.headers.has('origin')) {
        preservedBrowserOrigin = init.headers.get('origin') ?? '';
      }
      active++;
      maxActive = Math.max(maxActive, active);
      if (active > 1) {
        active--;
        throw new Error('Synthetic single-CPU worker connection loss.');
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return Response.json({ ok: true });
    });

    const responseResults = await Promise.all(
      Array.from({ length: 50 }, (_, index) => proxy.fetch(new Request(
        `http://127.0.0.1:8787/api/functions/load-${index}`,
        {
          method: 'POST',
          body: JSON.stringify({ index }),
          headers: {
            'content-type': 'application/json',
            ...(index === 0 ? { Origin: 'https://127.0.0.1:8787' } : {}),
          },
        },
      )).then(async (response) => ({
        response,
        body: await response.text(),
      }))),
    );
    const responses = responseResults.map(({ response }) => response);

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(responseResults.every(({ body }) => body === '{"ok":true}')).toBe(true);
    expect(userWorkerCalls).toBe(50);
    expect(maxActive).toBe(1);
    expect(preservedBrowserOrigin).toBe('https://127.0.0.1:8787');
    expect(controllerMessages).toBe(0);

    let releaseFirstBody!: () => void;
    const firstBodyCanFinish = new Promise<void>((resolve) => {
      releaseFirstBody = resolve;
    });
    active = 0;
    maxActive = 0;
    userWorkerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      userWorkerCalls++;
      active++;
      maxActive = Math.max(maxActive, active);
      if (active > 1) {
        active--;
        throw new Error('Synthetic response-stream connection loss.');
      }
      if (userWorkerCalls === 1) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('first'));
            void firstBodyCanFinish.then(() => {
              active--;
              controller.close();
            });
          },
        }));
      }
      active--;
      return new Response('second');
    });

    const streamedFirst = await proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/streamed-first',
    ));
    const streamedFirstBody = streamedFirst.text();
    const queuedSecondPromise = proxy.fetch(new Request(
      'http://127.0.0.1:8787/__edgebase/internal/self-host/schedules',
      {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      },
    ));
    await Promise.resolve();
    releaseFirstBody();
    const [firstBody, queuedSecond] = await Promise.all([
      streamedFirstBody,
      queuedSecondPromise,
    ]);

    expect(firstBody).toBe('first');
    expect(queuedSecond.status).toBe(200);
    await expect(queuedSecond.text()).resolves.toBe('second');
    expect(userWorkerCalls).toBe(2);
    expect(
      maxActive,
      'the next request must wait until the previous downstream response body settles',
    ).toBe(1);

    let markAfterAbandonedBodyEntered!: () => void;
    const afterAbandonedBodyEntered = new Promise<void>((resolve) => {
      markAfterAbandonedBodyEntered = resolve;
    });
    active = 0;
    maxActive = 0;
    userWorkerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      userWorkerCalls++;
      active++;
      maxActive = Math.max(maxActive, active);
      if (userWorkerCalls === 1) {
        let sourcePulls = 0;
        return new Response(new ReadableStream({
          pull(controller) {
            sourcePulls++;
            if (sourcePulls <= 4) {
              controller.enqueue(new TextEncoder().encode(`chunk-${sourcePulls}`));
            } else {
              active--;
              controller.close();
            }
          },
          cancel() {
            if (active > 0) active--;
          },
        }));
      }
      markAfterAbandonedBodyEntered();
      active--;
      return new Response('after-abandoned-body');
    });

    proxy.downstreamIdleAbandonMs = 20;
    const abandonedBodyFirst = await proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/abandoned-body-first',
    ));
    const afterAbandonedBodyPromise = proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/after-abandoned-body',
    ));
    const enteredAfterBoundedIdle = await Promise.race([
      afterAbandonedBodyEntered.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    await abandonedBodyFirst.body?.cancel();
    const afterAbandonedBody = await afterAbandonedBodyPromise;
    proxy.downstreamIdleAbandonMs = 15 * 1000;

    expect(
      enteredAfterBoundedIdle,
      'an abandoned bounded body without abort or cancel must release admission after finite idle',
    ).toBe(true);
    expect(afterAbandonedBody.status).toBe(200);
    await expect(afterAbandonedBody.text()).resolves.toBe('after-abandoned-body');
    expect(maxActive).toBe(1);

    let markDeclaredBodySecondEntered!: () => void;
    const declaredBodySecondEntered = new Promise<void>((resolve) => {
      markDeclaredBodySecondEntered = resolve;
    });
    userWorkerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      userWorkerCalls++;
      if (userWorkerCalls === 1) {
        let chunk = 0;
        return new Response(new ReadableStream({
          pull(controller) {
            chunk++;
            if (chunk === 1) {
              controller.enqueue(new TextEncoder().encode('body-'));
              return;
            }
            if (chunk === 2) {
              controller.enqueue(new TextEncoder().encode('done'));
              return;
            }
            controller.close();
          },
        }), {
          headers: { 'content-length': '9' },
        });
      }
      markDeclaredBodySecondEntered();
      return new Response('after-declared-body');
    });

    const declaredBodyFirst = await proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/declared-body-first',
    ));
    const declaredBodyReader = declaredBodyFirst.body!.getReader();
    const declaredChunkOne = await declaredBodyReader.read();
    const declaredChunkTwo = await declaredBodyReader.read();
    expect(new TextDecoder().decode(declaredChunkOne.value)).toBe('body-');
    expect(new TextDecoder().decode(declaredChunkTwo.value)).toBe('done');
    const afterDeclaredBodyPromise = proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/after-declared-body',
    ));
    const enteredAfterDeclaredBytes = await Promise.race([
      declaredBodySecondEntered.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    await declaredBodyReader.cancel();
    const afterDeclaredBody = await afterDeclaredBodyPromise;

    expect(
      enteredAfterDeclaredBytes,
      'consuming the exact declared body length must release admission without an extra EOF read',
    ).toBe(true);
    expect(afterDeclaredBody.status).toBe(200);
    await expect(afterDeclaredBody.text()).resolves.toBe('after-declared-body');
    expect(userWorkerCalls).toBe(2);

    let markAfterDetachedBodyEntered!: () => void;
    const afterDetachedBodyEntered = new Promise<void>((resolve) => {
      markAfterDetachedBodyEntered = resolve;
    });
    userWorkerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      userWorkerCalls++;
      if (userWorkerCalls === 1) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('body-done'));
            controller.close();
          },
        }), {
          headers: { 'content-length': '9' },
        });
      }
      markAfterDetachedBodyEntered();
      return new Response('after-detached-body');
    });

    const detachedBodyFirst = await proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/detached-body-first',
    ));
    const afterDetachedBodyPromise = proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/after-detached-body',
    ));
    const enteredWithoutDetachedBodyConsumption = await Promise.race([
      afterDetachedBodyEntered.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    const detachedBodyText = await detachedBodyFirst.text();
    const afterDetachedBody = await afterDetachedBodyPromise;

    expect(
      enteredWithoutDetachedBodyConsumption,
      'a bounded fully detached body must not retain admission when the downstream omits cancel',
    ).toBe(true);
    expect(detachedBodyText).toBe('body-done');
    expect(afterDetachedBody.status).toBe(200);
    await expect(afterDetachedBody.text()).resolves.toBe('after-detached-body');
    expect(userWorkerCalls).toBe(2);

    let markOversizedDeclaredBodyEntered!: () => void;
    const oversizedDeclaredBodyEntered = new Promise<void>((resolve) => {
      markOversizedDeclaredBodyEntered = resolve;
    });
    userWorkerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      userWorkerCalls++;
      if (userWorkerCalls === 1) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array((64 * 1024) + 1));
            controller.close();
          },
        }), {
          headers: { 'content-length': '9' },
        });
      }
      markOversizedDeclaredBodyEntered();
      return new Response('after-oversized-declared-body');
    });

    const oversizedDeclaredBody = await proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/oversized-declared-body',
    ));
    const afterOversizedDeclaredBodyPromise = proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/after-oversized-declared-body',
    ));
    const enteredBeforeOversizedBodyCancel = await Promise.race([
      oversizedDeclaredBodyEntered.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    await oversizedDeclaredBody.body?.cancel();
    const afterOversizedDeclaredBody = await afterOversizedDeclaredBodyPromise;
    expect(
      enteredBeforeOversizedBodyCancel,
      'a false small Content-Length must not bypass the bounded streaming lifetime',
    ).toBe(false);
    expect(afterOversizedDeclaredBody.status).toBe(200);
    await expect(afterOversizedDeclaredBody.text())
      .resolves.toBe('after-oversized-declared-body');
    expect(userWorkerCalls).toBe(2);

    let connectionTurnSettled = false;
    userWorkerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      userWorkerCalls++;
      if (userWorkerCalls === 1) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('settling'));
            controller.close();
            setTimeout(() => {
              connectionTurnSettled = true;
            }, 0);
          },
        }));
      }
      if (!connectionTurnSettled) {
        throw new Error('Synthetic post-EOF worker connection loss.');
      }
      return new Response('after-connection-turn');
    });

    const settlingFirst = await proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/settling-first',
      {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      },
    ));
    const settlingFirstBody = settlingFirst.text();
    const afterConnectionTurnPromise = proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/after-connection-turn',
      {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      },
    ));
    const [settledBody, afterConnectionTurn] = await Promise.all([
      settlingFirstBody,
      afterConnectionTurnPromise,
    ]);

    expect(settledBody).toBe('settling');
    expect(
      afterConnectionTurn.status,
      'the next ordinary request must wait one bounded turn after downstream EOF',
    ).toBe(200);
    await expect(afterConnectionTurn.text()).resolves.toBe('after-connection-turn');
    expect(userWorkerCalls).toBe(2);

    let cancelledFirstBody = false;
    let settleCancelledFirstBody!: () => void;
    const cancelledFirstBodyCanSettle = new Promise<void>((resolve) => {
      settleCancelledFirstBody = resolve;
    });
    let markAfterCancelEntered!: () => void;
    const afterCancelEntered = new Promise<void>((resolve) => {
      markAfterCancelEntered = resolve;
    });
    active = 0;
    maxActive = 0;
    userWorkerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      userWorkerCalls++;
      active++;
      maxActive = Math.max(maxActive, active);
      if (active > 1) {
        active--;
        throw new Error('Synthetic cancelled-stream connection loss.');
      }
      if (userWorkerCalls === 1) {
        return new Response(new ReadableStream({
          cancel() {
            cancelledFirstBody = true;
            active--;
            return cancelledFirstBodyCanSettle;
          },
        }));
      }
      markAfterCancelEntered();
      active--;
      return new Response('after-cancel');
    });

    const cancelledFirst = await proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/cancelled-first',
    ));
    const afterCancelPromise = proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/after-cancel',
    ));
    await Promise.resolve();
    const cancelledFirstCancel = cancelledFirst.body!.cancel();
    const enteredWhileCancelPending = await Promise.race([
      afterCancelEntered.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    settleCancelledFirstBody();
    await cancelledFirstCancel;
    const afterCancel = await afterCancelPromise;
    expect(cancelledFirstBody).toBe(true);
    expect(
      enteredWhileCancelPending,
      'accepted downstream cancellation must not retain admission on an unsettled source-cancel promise',
    ).toBe(true);
    expect(afterCancel.status).toBe(200);
    await expect(afterCancel.text()).resolves.toBe('after-cancel');
    expect(maxActive).toBe(1);

    let abortedFirstBody = false;
    let markAfterAbortEntered!: () => void;
    const afterAbortEntered = new Promise<void>((resolve) => {
      markAfterAbortEntered = resolve;
    });
    active = 0;
    maxActive = 0;
    userWorkerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      userWorkerCalls++;
      active++;
      maxActive = Math.max(maxActive, active);
      if (active > 1) {
        active--;
        throw new Error('Synthetic aborted-request connection loss.');
      }
      if (userWorkerCalls === 1) {
        return new Response(new ReadableStream({
          cancel() {
            abortedFirstBody = true;
            active--;
          },
        }));
      }
      markAfterAbortEntered();
      active--;
      return new Response('after-request-abort');
    });

    const abortedRequestController = new AbortController();
    const abortedFirst = await proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/aborted-first',
      { signal: abortedRequestController.signal },
    ));
    const afterAbortPromise = proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/after-request-abort',
    ));
    abortedRequestController.abort(new Error('Synthetic downstream abort.'));
    const enteredAfterRequestAbort = await Promise.race([
      afterAbortEntered.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    await abortedFirst.body?.cancel();
    const afterAbort = await afterAbortPromise;
    expect(abortedFirstBody).toBe(true);
    expect(
      enteredAfterRequestAbort,
      'request abort must release admission when the outer response cancel callback is omitted',
    ).toBe(true);
    expect(afterAbort.status).toBe(200);
    await expect(afterAbort.text()).resolves.toBe('after-request-abort');
    expect(maxActive).toBe(1);

    let failFirstBody!: (error: Error) => void;
    active = 0;
    maxActive = 0;
    userWorkerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      userWorkerCalls++;
      active++;
      maxActive = Math.max(maxActive, active);
      if (active > 1) {
        active--;
        throw new Error('Synthetic errored-stream connection loss.');
      }
      if (userWorkerCalls === 1) {
        return new Response(new ReadableStream({
          start(controller) {
            failFirstBody = (error) => {
              active--;
              controller.error(error);
            };
          },
        }));
      }
      active--;
      return new Response('after-error');
    });

    const erroredFirst = await proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/errored-first',
    ));
    const erroredFirstBody = erroredFirst.text();
    const afterErrorPromise = proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/after-error',
    ));
    await Promise.resolve();
    failFirstBody(new Error('Synthetic body failure.'));
    await expect(erroredFirstBody).rejects.toThrow('Synthetic body failure.');
    const afterError = await afterErrorPromise;
    expect(afterError.status).toBe(200);
    await expect(afterError.text()).resolves.toBe('after-error');
    expect(maxActive).toBe(1);

    const NativeResponse = globalThis.Response;
    class WorkerWebSocketResponse {
      body: ReadableStream<Uint8Array> | null;
      headers: Headers;
      status: number;
      webSocket: object | null;

      constructor(
        body: ReadableStream<Uint8Array> | null,
        init: {
          headers?: HeadersInit;
          status?: number;
          webSocket?: object | null;
        } = {},
      ) {
        this.body = body;
        this.headers = new Headers(init.headers);
        this.status = init.status ?? 200;
        this.webSocket = init.webSocket ?? null;
      }
    }
    vi.stubGlobal('Response', WorkerWebSocketResponse);
    let markAfterWebSocketEntered!: () => void;
    const afterWebSocketEntered = new Promise<void>((resolve) => {
      markAfterWebSocketEntered = resolve;
    });
    userWorkerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      userWorkerCalls++;
      if (userWorkerCalls === 1) {
        return new WorkerWebSocketResponse(new ReadableStream(), {
          status: 101,
          webSocket: {},
        }) as unknown as Response;
      }
      markAfterWebSocketEntered();
      return new WorkerWebSocketResponse(null, {
        status: 204,
      }) as unknown as Response;
    });

    const webSocketResponse = await proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/room',
      { headers: { upgrade: 'websocket' } },
    ));
    const afterWebSocketPromise = proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/after-websocket',
    ));
    const enteredWhileWebSocketOpen = await Promise.race([
      afterWebSocketEntered.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    await webSocketResponse.body?.cancel();
    const afterWebSocket = await afterWebSocketPromise;
    vi.stubGlobal('Response', NativeResponse);

    expect(
      enteredWhileWebSocketOpen,
      'a WebSocket upgrade is a long-lived lane and must not retain the ordinary response slot',
    ).toBe(true);
    expect(webSocketResponse.status).toBe(101);
    expect(afterWebSocket.status).toBe(204);

    userWorkerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      userWorkerCalls++;
      throw new Error('Network connection lost.');
    });

    const connectionLossResponse = await proxy.fetch(new Request(
      'http://127.0.0.1:8787/api/functions/same-worker',
      {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      },
    ));
    expect(connectionLossResponse.status).toBe(503);
    await expect(connectionLossResponse.text()).resolves.toContain(
      'request was not retried',
    );
    expect(userWorkerCalls).toBe(1);
    expect(
      controllerMessages,
      'a same-worker connection loss must remain request-scoped instead of terminating Wrangler',
    ).toBe(0);
  });
});
