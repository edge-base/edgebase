// Derived from Cloudflare Wrangler's development ProxyWorker, licensed under
// MIT OR Apache-2.0. EdgeBase owns the bounded request scheduling below.
/* global Headers, HTMLRewriter, ReadableStream, Request, Response, TransformStream, URL, WebSocketPair, clearTimeout, fetch, setTimeout */

const MAX_DOWNSTREAM_CONCURRENCY = 1;
const MAX_PENDING_REQUESTS = 512;
const BOUNDED_RESPONSE_PREFETCH_BYTES = 64 * 1024;
const DOWNSTREAM_IDLE_ABANDON_MS = 15 * 1000;
const LIVE_RELOAD_PROTOCOL = 'WRANGLER_PROXYWORKER_LIVE_RELOAD_PROTOCOL';
const LIVE_RELOAD_PATHNAME = '/cdn-cgi/live-reload';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function urlFromParts(parts, base = 'http://localhost') {
  const url = new URL(base);
  Object.assign(url, parts);
  return url;
}

function workerIdentity(proxyData) {
  return urlFromParts(proxyData.userWorkerUrl).origin;
}

function rewriteUrlInHeaderValue(value, from, to) {
  return value.replace(
    /(https?:\/\/[^/?#\s,;"']+)([^\s,;"']*)/gi,
    (match, origin, rest) => {
      let url;
      try {
        url = new URL(origin);
      } catch {
        return match;
      }
      return url.host === from.host ? to.origin + rest : match;
    },
  );
}

const ProxyWorkerEntrypoint = {
  fetch(request, env) {
    const singleton = env.DURABLE_OBJECT.idFromName('');
    return env.DURABLE_OBJECT.get(singleton).fetch(request);
  },
};

class ProxyWorker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  proxyData;
  proxyDataReady = createDeferred();
  activeDownstreamRequests = 0;
  pendingDownstreamRequests = 0;
  downstreamWaiters = [];
  downstreamIdleAbandonMs = DOWNSTREAM_IDLE_ABANDON_MS;

  fetch(request) {
    if (isRequestForLiveReloadWebsocket(request)) {
      return this.handleLiveReloadWebSocket(request);
    }
    if (isRequestFromProxyController(request, this.env)) {
      return this.processProxyControllerRequest(request);
    }
    return this.proxyRequest(request);
  }

  handleLiveReloadWebSocket(request) {
    const { 0: response, 1: liveReload } = new WebSocketPair();
    const websocketProtocol = request.headers.get('Sec-WebSocket-Protocol') ?? '';
    this.state.acceptWebSocket(liveReload, ['live-reload']);
    return new Response(null, {
      status: 101,
      webSocket: response,
      headers: { 'Sec-WebSocket-Protocol': websocketProtocol },
    });
  }

  processProxyControllerRequest(request) {
    const event = request.cf?.hostMetadata;
    switch (event?.type) {
      case 'pause':
        if (this.proxyData !== undefined) {
          this.proxyDataReady = createDeferred();
        }
        this.proxyData = undefined;
        break;
      case 'play':
        this.proxyData = event.proxyData;
        this.proxyDataReady.resolve();
        this.state.getWebSockets('live-reload').forEach((ws) => ws.send('reload'));
        break;
    }
    return new Response(null, { status: 204 });
  }

  async acquireDownstreamSlot() {
    if (this.activeDownstreamRequests < MAX_DOWNSTREAM_CONCURRENCY) {
      this.activeDownstreamRequests++;
      return true;
    }
    if (this.pendingDownstreamRequests >= MAX_PENDING_REQUESTS) {
      return false;
    }

    this.pendingDownstreamRequests++;
    try {
      await new Promise((resolve) => this.downstreamWaiters.push(resolve));
    } finally {
      this.pendingDownstreamRequests--;
    }
    return true;
  }

  releaseDownstreamSlot() {
    // Workerd can report the response source as closed one event-loop turn
    // before its local UserWorker connection is reusable. Keep the sole
    // ordinary lane occupied through that bounded settlement turn instead of
    // inducing an ambiguous same-worker loss in the next request.
    setTimeout(() => {
      const next = this.downstreamWaiters.shift();
      if (next) {
        next();
        return;
      }
      this.activeDownstreamRequests--;
    }, 0);
  }

  async waitForProxyData() {
    while (this.proxyData === undefined) {
      const ready = this.proxyDataReady.promise;
      await ready;
    }
    return this.proxyData;
  }

  async detachBoundedResponseBody(response) {
    const rawLength = response.headers.get('content-length');
    if (!/^(?:0|[1-9]\d*)$/u.test(rawLength ?? '')) {
      return { detached: false, response };
    }
    const declaredLength = Number(rawLength);
    if (
      !Number.isSafeInteger(declaredLength)
      || declaredLength > BOUNDED_RESPONSE_PREFETCH_BYTES
    ) {
      return { detached: false, response };
    }

    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) {
        const headers = new Headers(response.headers);
        if (totalBytes !== declaredLength) headers.delete('content-length');
        let chunkIndex = 0;
        const detachedBody = new ReadableStream({
          pull(controller) {
            if (chunkIndex < chunks.length) {
              controller.enqueue(chunks[chunkIndex]);
              chunkIndex++;
              return;
            }
            controller.close();
          },
        });
        return {
          detached: true,
          response: new Response(detachedBody, {
            status: response.status,
            statusText: response.statusText,
            headers,
          }),
        };
      }

      chunks.push(result.value);
      totalBytes += result.value?.byteLength ?? 1;
      if (totalBytes > BOUNDED_RESPONSE_PREFETCH_BYTES) {
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        let chunkIndex = 0;
        const replayBody = new ReadableStream({
          async pull(controller) {
            if (chunkIndex < chunks.length) {
              controller.enqueue(chunks[chunkIndex]);
              chunkIndex++;
              return;
            }
            try {
              const next = await reader.read();
              if (next.done) {
                controller.close();
                return;
              }
              controller.enqueue(next.value);
            } catch (error) {
              controller.error(error);
            }
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });
        return {
          detached: false,
          response: new Response(replayBody, {
            status: response.status,
            statusText: response.statusText,
            headers,
          }),
        };
      }
    }
  }

  holdDownstreamSlotUntilBodySettles(response, requestSignal) {
    let producedBytes = 0;
    let deliveredBytes = 0;
    let deliveredController;
    let idleAbandonTimer;
    let reader;
    let released = false;
    const clearIdleAbandonment = () => {
      if (idleAbandonTimer === undefined) return;
      clearTimeout(idleAbandonTimer);
      idleAbandonTimer = undefined;
    };
    const release = () => {
      if (released) return;
      released = true;
      clearIdleAbandonment();
      requestSignal?.removeEventListener('abort', releaseForRequestAbort);
      this.releaseDownstreamSlot();
    };
    const abandonForIdle = () => {
      idleAbandonTimer = undefined;
      if (released || producedBytes <= deliveredBytes) return;
      try {
        deliveredController?.close();
      } catch {
        // The downstream may have settled while the idle callback was queued.
      }
      void reader.cancel(
        new Error('Downstream response body was abandoned after bounded idle.'),
      ).catch(() => {});
      release();
    };
    const refreshIdleAbandonment = () => {
      clearIdleAbandonment();
      if (released || producedBytes <= deliveredBytes) return;
      idleAbandonTimer = setTimeout(
        abandonForIdle,
        this.downstreamIdleAbandonMs,
      );
    };
    const { readable, writable } = new TransformStream(
      {
        transform(chunk, controller) {
          producedBytes += chunk?.byteLength ?? 1;
          controller.enqueue(chunk);
          refreshIdleAbandonment();
        },
      },
      undefined,
      {
        highWaterMark: BOUNDED_RESPONSE_PREFETCH_BYTES,
        size(chunk) {
          return chunk?.byteLength ?? 1;
        },
      },
    );
    // The first bounded queue can prefetch small upstream responses without
    // unbounded memory. A zero-HWM outer stream keeps admission until workerd
    // actually consumes or cancels that queued response; upstream EOF alone
    // can precede the local UserWorker connection becoming reusable.
    reader = readable.getReader();
    let sourceClosed = false;
    const releaseForRequestAbort = () => {
      // Workerd does not always invoke the returned response body's cancel
      // callback when the incoming client request is aborted. Propagate the
      // explicit request lifetime signal and release through the same bounded
      // connection-settlement turn.
      try {
        deliveredController?.close();
      } catch {
        // The downstream may already have closed or errored the response.
      }
      void reader.cancel(requestSignal.reason).catch(() => {});
      release();
    };
    if (requestSignal?.aborted) {
      releaseForRequestAbort();
    } else {
      requestSignal?.addEventListener('abort', releaseForRequestAbort, {
        once: true,
      });
    }
    const finishIfDelivered = () => {
      if (
        released
        || !sourceClosed
        || deliveredController === undefined
        || deliveredBytes < producedBytes
      ) {
        return;
      }
      deliveredController.close();
      release();
    };
    void response.body.pipeTo(writable).then(
      () => {
        sourceClosed = true;
        // A downstream consumer may stop pulling after Content-Length bytes.
        // Close from the producer-settlement path when every produced byte has
        // already been delivered instead of requiring a redundant EOF read.
        finishIfDelivered();
      },
      (error) => {
        if (released) return;
        try {
          deliveredController?.error(error);
        } catch {
          // Downstream cancellation can close the outer stream first.
        }
        release();
      },
    );
    const delivered = new ReadableStream({
      start(controller) {
        deliveredController = controller;
      },
      async pull(controller) {
        // An active pull is downstream progress. Do not classify a slow
        // upstream read as abandonment; re-arm only if buffered bytes remain
        // after this pull is delivered.
        clearIdleAbandonment();
        try {
          const result = await reader.read();
          if (result.done) {
            controller.close();
            release();
            return;
          }
          deliveredBytes += result.value?.byteLength ?? 1;
          controller.enqueue(result.value);
          finishIfDelivered();
          refreshIdleAbandonment();
        } catch (error) {
          controller.error(error);
          release();
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          release();
        }
      },
    }, { highWaterMark: 0 });
    return new Response(delivered, response);
  }

  async forward(request, proxyData) {
    const outerUrl = new URL(request.url);
    const headers = new Headers(request.headers);
    const userWorkerUrl = new URL(request.url);
    Object.assign(userWorkerUrl, proxyData.userWorkerUrl);
    const innerUrl = urlFromParts(
      proxyData.userWorkerInnerUrlOverrides ?? {},
      request.url,
    );
    const encoding = request.cf?.clientAcceptEncoding;
    if (encoding !== undefined) headers.set('Accept-Encoding', encoding);
    rewriteUrlRelatedHeaders(headers, outerUrl, innerUrl);
    headers.set('MF-Original-URL', innerUrl.href);

    for (const [key, value] of Object.entries(proxyData.headers ?? {})) {
      if (value === undefined) continue;
      if (key.toLowerCase() === 'cookie') {
        const existing = request.headers.get('cookie') ?? '';
        headers.set('cookie', `${existing};${value}`);
      } else {
        headers.set(key, value);
      }
    }

    let response = await fetch(userWorkerUrl, new Request(request, { headers }));
    response = new Response(response.body, response);
    rewriteUrlRelatedHeaders(response.headers, innerUrl, outerUrl);
    await checkForPreviewTokenError(response, this.env, proxyData);
    if (isHtmlResponse(response)) {
      response = insertLiveReloadScript(request, response, proxyData);
    }
    if (isSseResponse(response)) {
      void sendMessageToProxyController(this.env, { type: 'sseResponseDetected' });
    }
    return response;
  }

  async proxyRequest(request) {
    const acquired = await this.acquireDownstreamSlot();
    if (!acquired) {
      return new Response('Local development proxy is overloaded.', {
        status: 503,
        headers: { 'Retry-After': '1' },
      });
    }

    let releaseOnExit = true;
    try {
      while (true) {
        const proxyData = await this.waitForProxyData();
        const initialWorkerIdentity = workerIdentity(proxyData);
        try {
          const response = await this.forward(request, proxyData);
          // Finite response streams keep the one-CPU admission slot until the
          // downstream connection has actually completed. Long-lived SSE is a
          // separate latency class: holding the sole slot for its lifetime
          // would starve every ordinary request.
          const isWebSocketResponse = response.status === 101
            || response.webSocket !== null && response.webSocket !== undefined;
          if (
            response.body !== null
            && !isSseResponse(response)
            && !isWebSocketResponse
          ) {
            const boundedResponse = await this.detachBoundedResponseBody(response);
            if (boundedResponse.detached) {
              return boundedResponse.response;
            }
            const heldResponse = this.holdDownstreamSlotUntilBodySettles(
              boundedResponse.response,
              request.signal,
            );
            releaseOnExit = false;
            return heldResponse;
          }
          return response;
        } catch {
          const currentWorkerIdentity = this.proxyData
            ? workerIdentity(this.proxyData)
            : undefined;
          if (initialWorkerIdentity === currentWorkerIdentity) {
            return new Response(
              'The local worker connection was lost. This request was not retried.',
              {
                status: 503,
                headers: { 'Retry-After': '0' },
              },
            );
          }

          if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response(
              'Your worker restarted mid-request. Please try sending the request again. Only GET or HEAD requests are retried automatically.',
              {
                status: 503,
                headers: { 'Retry-After': '0' },
              },
            );
          }
        }
      }
    } finally {
      if (releaseOnExit) this.releaseDownstreamSlot();
    }
  }
}

function isRequestFromProxyController(request, env) {
  return request.headers.get('Authorization') === env.PROXY_CONTROLLER_AUTH_SECRET;
}

function isHtmlResponse(response) {
  return response.headers.get('content-type')?.startsWith('text/html') ?? false;
}

function isSseResponse(response) {
  return response.headers.get('content-type')?.startsWith('text/event-stream') ?? false;
}

function isRequestForLiveReloadWebsocket(request) {
  if (new URL(request.url).pathname !== LIVE_RELOAD_PATHNAME) return false;
  const websocketProtocol = request.headers.get('Sec-WebSocket-Protocol');
  const isWebSocketUpgrade = request.headers.get('Upgrade') === 'websocket';
  return isWebSocketUpgrade && websocketProtocol === LIVE_RELOAD_PROTOCOL;
}

function sendMessageToProxyController(env, message) {
  return env.PROXY_CONTROLLER.fetch('http://dummy', {
    method: 'POST',
    body: JSON.stringify(message),
  });
}

async function checkForPreviewTokenError(response, env, proxyData) {
  if (response.status !== 400) return;
  const text = await response.clone().text();
  if (
    text.includes('Invalid Workers Preview configuration')
    || text.includes('error code: 1031')
  ) {
    void sendMessageToProxyController(env, {
      type: 'previewTokenExpired',
      proxyData,
    });
  }
}

function insertLiveReloadScript(request, response, proxyData) {
  const htmlRewriter = new HTMLRewriter();
  htmlRewriter.onDocument({
    end(end) {
      if (proxyData.liveReload) {
        const websocketUrl = new URL(request.url);
        websocketUrl.protocol = websocketUrl.protocol === 'http:' ? 'ws:' : 'wss:';
        end.append(liveReloadScript, { html: true });
      }
    },
  });
  return htmlRewriter.transform(response);
}

const liveReloadScript = `
<script defer type="application/javascript">
  (function() {
    var ws;
    function recover() {
      ws = null;
      setTimeout(initLiveReload, 100);
    }
    function initLiveReload() {
      if (ws) return;
      var origin = (location.protocol === "http:" ? "ws://" : "wss://") + location.host;
      ws = new WebSocket(origin + "${LIVE_RELOAD_PATHNAME}", "${LIVE_RELOAD_PROTOCOL}");
      ws.onclose = recover;
      ws.onerror = recover;
      ws.onmessage = location.reload.bind(location);
    }
    initLiveReload();
  })();
</script>
`;

function readSetCookies(headers) {
  if (typeof headers.getAll === 'function') return headers.getAll('Set-Cookie');
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const value = headers.get('Set-Cookie');
  return value ? [value] : [];
}

function rewriteUrlRelatedHeaders(headers, from, to) {
  const setCookies = readSetCookies(headers);
  headers.delete('Set-Cookie');
  headers.forEach((value, key) => {
    // Origin is a browser security authority, not a routable URL. Rewriting a
    // trusted TLS proxy's https Origin to Wrangler's HTTP inner URL breaks
    // same-origin cookie validation and weakens the meaning of the header.
    if (key.toLowerCase() === 'origin') return;
    if (typeof value === 'string' && value.includes(from.host)) {
      headers.set(key, rewriteUrlInHeaderValue(value, from, to));
    }
  });
  for (const cookie of setCookies) {
    headers.append(
      'Set-Cookie',
      cookie.replace(
        new RegExp(`Domain=${from.hostname}($|;|,)`),
        `Domain=${to.hostname}$1`,
      ),
    );
  }
}

export {
  ProxyWorker,
  ProxyWorkerEntrypoint as default,
};
