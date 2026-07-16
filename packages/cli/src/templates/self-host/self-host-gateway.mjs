import { Buffer } from 'node:buffer';
import {
  STATUS_CODES,
  createServer as createHttpServer,
  request as requestHttp,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';

const LOOPBACK_UPSTREAM_HOST = '127.0.0.1';
const HEALTH_PATH = '/__edgebase/health';
const WORKER_TRUST_HEADER = 'x-edgebase-self-host-gateway';
const WORKER_TRUST_SECRET_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_PATH_FAMILIES = Object.freeze([
  '/cdn-cgi/handler/scheduled',
  '/cdn-cgi/mf/scheduled',
  '/__scheduled',
  '/__edgebase/internal',
]);
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const FORBIDDEN_TRAILER_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  'content-length',
  'host',
]);
const SPOOFABLE_FORWARDING_HEADERS = new Set([
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  WORKER_TRUST_HEADER,
]);
const HEADER_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function normalizePort(value, label, allowZero = false) {
  const port = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(port) || port < minimum || port > 65_535) {
    throw new TypeError(`${label} must be an integer between ${minimum} and 65535.`);
  }
  return port;
}

function normalizeDrainTimeout(value) {
  const timeout = value === undefined ? 10_000 : Number(value);
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 300_000) {
    throw new TypeError('drainTimeoutMs must be an integer between 0 and 300000.');
  }
  return timeout;
}

function hasTlsMaterial(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' || Buffer.isBuffer(value)) return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function containsControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function rawHeaderValues(rawHeaders, requestedName) {
  const requested = requestedName.toLowerCase();
  const values = [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === requested) {
      values.push(String(rawHeaders[index + 1]));
    }
  }
  return values;
}

function connectionNominations(rawHeaders) {
  const names = new Set();
  for (const value of rawHeaderValues(rawHeaders, 'connection')) {
    for (const token of value.split(',')) {
      const name = token.trim().toLowerCase();
      if (HEADER_TOKEN_PATTERN.test(name)) names.add(name);
    }
  }
  return names;
}

function declaredTrailerNames(rawHeaders, nominations) {
  const names = new Set();
  for (const value of rawHeaderValues(rawHeaders, 'trailer')) {
    for (const token of value.split(',')) {
      const name = token.trim().toLowerCase();
      if (
        HEADER_TOKEN_PATTERN.test(name)
        && !FORBIDDEN_TRAILER_HEADERS.has(name)
        && !nominations.has(name)
      ) {
        names.add(name);
      }
    }
  }
  return names;
}

function validatedInboundHost(rawHeaders) {
  const values = rawHeaderValues(rawHeaders, 'host');
  if (values.length !== 1) return null;
  const host = values[0].trim();
  if (
    host.length === 0
    || host.length > 255
    || containsControlCharacters(host)
    || /[\s,\\/?#@]/.test(host)
  ) {
    return null;
  }

  try {
    const parsed = new URL(`http://${host}/`);
    if (
      !parsed.hostname
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return host;
}

function validatedAuthority(value) {
  return validatedInboundHost(['Host', value]);
}

function validatedRemoteAddress(remoteAddress) {
  if (
    typeof remoteAddress !== 'string'
    || remoteAddress.length === 0
    || containsControlCharacters(remoteAddress)
    || /[\s,]/.test(remoteAddress)
  ) {
    return null;
  }
  return remoteAddress;
}

function normalizeIpAddress(value) {
  const candidate = String(value ?? '').trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(candidate)?.[1];
  return mapped && isIP(mapped) === 4 ? mapped : candidate;
}

function createTrustedProxyMatcher(value) {
  if (value === undefined) return { cidrs: Object.freeze([]), check: () => false };
  if (!Array.isArray(value)) throw new TypeError('trustedProxyCidrs must be an array of CIDR strings.');
  const blockList = new BlockList();
  const cidrs = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new TypeError(`trustedProxyCidrs[${index}] must be a non-empty CIDR string.`);
    }
    const candidate = entry.trim();
    const separator = candidate.lastIndexOf('/');
    const address = separator === -1 ? candidate : candidate.slice(0, separator);
    const family = isIP(address);
    if (family === 0) throw new TypeError(`trustedProxyCidrs[${index}] has an invalid IP address.`);
    const prefix = separator === -1
      ? (family === 4 ? 32 : 128)
      : Number(candidate.slice(separator + 1));
    const maximum = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maximum) {
      throw new TypeError(`trustedProxyCidrs[${index}] has an invalid prefix length.`);
    }
    blockList.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
    return `${address}/${prefix}`;
  });
  return {
    cidrs: Object.freeze(cidrs),
    check(remoteAddress) {
      const address = normalizeIpAddress(remoteAddress);
      const family = isIP(address);
      return family !== 0 && blockList.check(address, family === 4 ? 'ipv4' : 'ipv6');
    },
  };
}

function trustedForwardingContext(rawHeaders) {
  const forwardedFor = rawHeaderValues(rawHeaders, 'x-forwarded-for');
  const forwardedProto = rawHeaderValues(rawHeaders, 'x-forwarded-proto');
  const forwardedHost = rawHeaderValues(rawHeaders, 'x-forwarded-host');
  const present = forwardedFor.length + forwardedProto.length + forwardedHost.length;
  if (present === 0) return { kind: 'absent' };
  if (forwardedFor.length !== 1 || forwardedProto.length !== 1 || forwardedHost.length !== 1) {
    return { kind: 'invalid' };
  }
  const clientAddress = normalizeIpAddress(forwardedFor[0]);
  const protocol = forwardedProto[0].trim().toLowerCase();
  const host = validatedAuthority(forwardedHost[0].trim());
  if (
    isIP(clientAddress) === 0
    || /[\s,]/.test(clientAddress)
    || (protocol !== 'http' && protocol !== 'https')
    || !host
  ) {
    return { kind: 'invalid' };
  }
  return { kind: 'trusted', clientAddress, protocol, host };
}

function prepareRequestHeaders(rawHeaders, {
  protocol,
  remoteAddress,
  upgrade,
  trustedProxy,
  workerTrustSecret,
}) {
  const nominations = connectionNominations(rawHeaders);
  const trailerNames = upgrade ? new Set() : declaredTrailerNames(rawHeaders, nominations);
  const host = validatedInboundHost(rawHeaders);
  const forwarding = trustedProxy ? trustedForwardingContext(rawHeaders) : { kind: 'absent' };
  if (forwarding.kind === 'invalid') return null;
  const clientAddress = forwarding.kind === 'trusted'
    ? forwarding.clientAddress
    : validatedRemoteAddress(normalizeIpAddress(remoteAddress));
  if (!host || !clientAddress) return null;
  const output = [];

  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const originalName = String(rawHeaders[index]);
    const name = originalName.toLowerCase();
    const value = String(rawHeaders[index + 1]);

    if (name === 'host' || name === 'connection' || name === 'upgrade' || name === 'trailer') continue;
    if (HOP_BY_HOP_HEADERS.has(name) || nominations.has(name)) continue;
    if (SPOOFABLE_FORWARDING_HEADERS.has(name)) continue;
    output.push(originalName, value);
  }

  output.push('Host', host);
  if (trailerNames.size > 0) output.push('Trailer', [...trailerNames].join(', '));
  if (upgrade) output.push('Connection', 'Upgrade', 'Upgrade', 'websocket');
  output.push('X-Forwarded-For', clientAddress);
  output.push('X-Forwarded-Proto', forwarding.kind === 'trusted' ? forwarding.protocol : protocol);
  output.push('X-Forwarded-Host', forwarding.kind === 'trusted' ? forwarding.host : host);
  output.push('X-EdgeBase-Self-Host-Gateway', workerTrustSecret);

  return { rawHeaders: output, trailerNames };
}

function prepareResponseHeaders(rawHeaders) {
  const nominations = connectionNominations(rawHeaders);
  const hasContentLength = rawHeaderValues(rawHeaders, 'content-length').length > 0;
  const trailerNames = hasContentLength
    ? new Set()
    : declaredTrailerNames(rawHeaders, nominations);
  const output = [];

  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const originalName = String(rawHeaders[index]);
    const name = originalName.toLowerCase();
    const value = String(rawHeaders[index + 1]);
    if (name === 'trailer' || HOP_BY_HOP_HEADERS.has(name) || nominations.has(name)) continue;
    output.push(originalName, value);
  }

  if (trailerNames.size > 0) output.push('Trailer', [...trailerNames].join(', '));
  return { rawHeaders: output, trailerNames };
}

function prepareUpgradeResponseHeaders(rawHeaders) {
  const nominations = connectionNominations(rawHeaders);
  const output = [];
  let hasConnection = false;
  let hasUpgrade = false;

  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const originalName = String(rawHeaders[index]);
    const name = originalName.toLowerCase();
    const value = String(rawHeaders[index + 1]);
    if (
      name === 'keep-alive'
      || name === 'proxy-authenticate'
      || name === 'proxy-authorization'
      || name === 'proxy-connection'
      || name === 'te'
      || name === 'trailer'
      || name === 'transfer-encoding'
      || (nominations.has(name) && name !== 'upgrade')
    ) {
      continue;
    }
    if (name === 'connection') hasConnection = true;
    if (name === 'upgrade') hasUpgrade = true;
    output.push(originalName, value);
  }

  if (!hasConnection) output.push('Connection', 'Upgrade');
  if (!hasUpgrade) output.push('Upgrade', 'websocket');
  return output;
}

function trailersFromRawHeaders(rawTrailers, allowedNames) {
  const trailers = Object.create(null);
  for (let index = 0; index + 1 < rawTrailers.length; index += 2) {
    const originalName = String(rawTrailers[index]);
    const name = originalName.toLowerCase();
    const value = String(rawTrailers[index + 1]);
    if (!allowedNames.has(name) || FORBIDDEN_TRAILER_HEADERS.has(name)) continue;
    const current = trailers[originalName];
    if (current === undefined) trailers[originalName] = value;
    else if (Array.isArray(current)) current.push(value);
    else trailers[originalName] = [current, value];
  }
  return trailers;
}

function matchesControlFamily(candidate) {
  const queryIndex = candidate.search(/[?#]/);
  const pathOnly = (queryIndex === -1 ? candidate : candidate.slice(0, queryIndex))
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
  const lower = pathOnly.toLowerCase();
  return CONTROL_PATH_FAMILIES.some(
    (family) => lower === family || lower.startsWith(`${family}/`),
  );
}

function inspectControlPath(rawPath) {
  const seen = new Set();
  let current = rawPath;
  let invalid = false;

  while (!seen.has(current)) {
    seen.add(current);
    const queryIndex = current.search(/[?#]/);
    const pathOnly = queryIndex === -1 ? current : current.slice(0, queryIndex);
    const slashNormalized = pathOnly.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    let dotNormalized = slashNormalized;
    try {
      dotNormalized = new URL(`http://edgebase.invalid${slashNormalized}`).pathname;
    } catch {
      invalid = true;
    }

    if (matchesControlFamily(pathOnly) || matchesControlFamily(slashNormalized)
      || matchesControlFamily(dotNormalized)) {
      return { blocked: true, invalid: false };
    }
    if (containsControlCharacters(pathOnly)) invalid = true;

    let decoded;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      invalid = true;
      break;
    }
    if (decoded === current) break;
    current = decoded;
  }

  return { blocked: false, invalid };
}

function resolveRequestTarget(rawTarget) {
  if (typeof rawTarget !== 'string' || rawTarget.length === 0) {
    return { kind: 'invalid' };
  }
  if (rawTarget === '*') return { kind: 'proxy', target: '*' };
  if (rawTarget.includes('#') || containsControlCharacters(rawTarget)) {
    return { kind: 'invalid' };
  }

  const slashNormalized = rawTarget.replace(/\\/g, '/');
  let path;
  let target;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(slashNormalized)) {
    if (!/^https?:\/\//i.test(slashNormalized)) return { kind: 'invalid' };
    try {
      const parsed = new URL(slashNormalized);
      if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        || parsed.username
        || parsed.password
        || parsed.hash
      ) {
        return { kind: 'invalid' };
      }
      path = parsed.pathname || '/';
      target = `${path}${parsed.search}`;
    } catch {
      return { kind: 'invalid' };
    }
  } else {
    if (!slashNormalized.startsWith('/')) return { kind: 'invalid' };
    const queryIndex = slashNormalized.indexOf('?');
    path = queryIndex === -1 ? slashNormalized : slashNormalized.slice(0, queryIndex);
    target = slashNormalized;
  }

  const inspection = inspectControlPath(path);
  if (inspection.blocked) return { kind: 'blocked' };
  if (inspection.invalid) return { kind: 'invalid' };
  return { kind: 'proxy', target };
}

function blockedTargetFromClientError(error) {
  const rawPacket = error && typeof error === 'object' ? error.rawPacket : undefined;
  if (!Buffer.isBuffer(rawPacket) || rawPacket.length === 0) return false;
  const firstLineEnd = rawPacket.indexOf('\r\n');
  const firstLine = rawPacket
    .subarray(0, firstLineEnd === -1 ? rawPacket.length : firstLineEnd)
    .toString('latin1');
  const match = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+[ \t]+([^ \t]+)[ \t]+HTTP\/\d(?:\.\d)?$/.exec(firstLine);
  return match ? resolveRequestTarget(match[1]).kind === 'blocked' : false;
}

function writeHttpFailure(request, response, statusCode, body) {
  if (response.destroyed || response.writableEnded) return;
  const payload = Buffer.from(body, 'utf8');
  response.statusCode = statusCode;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Length', String(payload.length));
  response.setHeader('Connection', 'close');
  response.end(request.method === 'HEAD' ? undefined : payload);
}

function schedulerHealthPayload(healthProvider, admissionAllowed) {
  if (!admissionAllowed) {
    return {
      statusCode: 503,
      payload: {
        schemaVersion: 1,
        outcome: 'blocked',
        product: 'proxy-ready',
        scheduler: null,
      },
    };
  }
  let scheduler;
  try {
    scheduler = healthProvider?.();
  } catch {
    scheduler = null;
  }
  const state = scheduler?.state;
  const structurallyReady = scheduler?.structuralReady === true
    && (state === 'ready' || state === 'degraded' || state === 'running');
  const degraded = structurallyReady
    && (state === 'degraded' || Number(scheduler?.itemFailureCount) > 0);
  return {
    statusCode: structurallyReady ? 200 : 503,
    payload: {
      schemaVersion: 1,
      outcome: structurallyReady ? (degraded ? 'degraded' : 'ok') : 'blocked',
      product: 'proxy-ready',
      scheduler: scheduler ?? null,
    },
  };
}

function writeHealthResponse(request, response, healthProvider, admissionAllowed) {
  if (request.method !== 'GET') {
    writeHttpFailure(request, response, 405, 'Method not allowed.\n');
    return;
  }
  const { statusCode, payload } = schedulerHealthPayload(healthProvider, admissionAllowed);
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  response.statusCode = statusCode;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', String(body.length));
  response.end(body);
}

function writeRawFailure(socket, statusCode, body) {
  if (socket.destroyed) return;
  const payload = Buffer.from(body, 'utf8');
  const reason = STATUS_CODES[statusCode] || 'Error';
  socket.end(
    `HTTP/1.1 ${statusCode} ${reason}\r\n`
    + 'Cache-Control: no-store\r\n'
    + 'Content-Type: text/plain; charset=utf-8\r\n'
    + `Content-Length: ${payload.length}\r\n`
    + 'Connection: close\r\n'
    + '\r\n'
    + payload,
  );
}

function serializeRawResponse(response, rawHeaders, forceClose = false) {
  const reason = response.statusMessage || STATUS_CODES[response.statusCode] || '';
  let serialized = `HTTP/${response.httpVersion || '1.1'} ${response.statusCode} ${reason}\r\n`;
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    serialized += `${rawHeaders[index]}: ${rawHeaders[index + 1]}\r\n`;
  }
  if (forceClose) serialized += 'Connection: close\r\n';
  return `${serialized}\r\n`;
}

function trackSocket(set, socket) {
  set.add(socket);
  socket.once('close', () => set.delete(socket));
  return socket;
}

function destroySockets(sockets) {
  for (const socket of sockets) {
    if (!socket.destroyed) socket.destroy();
  }
}

function relayRequestBody(clientRequest, upstreamRequest, trailerNames) {
  let backpressured = false;

  clientRequest.on('data', (chunk) => {
    if (upstreamRequest.destroyed) return;
    if (!upstreamRequest.write(chunk)) {
      backpressured = true;
      clientRequest.pause();
    }
  });
  upstreamRequest.on('drain', () => {
    if (!backpressured) return;
    backpressured = false;
    clientRequest.resume();
  });
  clientRequest.once('end', () => {
    if (upstreamRequest.destroyed) return;
    const trailers = trailersFromRawHeaders(clientRequest.rawTrailers, trailerNames);
    if (Object.keys(trailers).length > 0) upstreamRequest.addTrailers(trailers);
    upstreamRequest.end();
  });
}

function bridgeRawSockets(clientSocket, upstreamSocket) {
  clientSocket.setTimeout(0);
  upstreamSocket.setTimeout(0);
  clientSocket.pipe(upstreamSocket, { end: false });
  upstreamSocket.pipe(clientSocket, { end: false });
  clientSocket.once('end', () => upstreamSocket.end());
  upstreamSocket.once('end', () => clientSocket.end());
  clientSocket.once('error', () => upstreamSocket.destroy());
  upstreamSocket.once('error', () => clientSocket.destroy());
  clientSocket.once('close', () => {
    if (!upstreamSocket.destroyed) upstreamSocket.destroy();
  });
  upstreamSocket.once('close', () => {
    if (!clientSocket.destroyed) clientSocket.destroy();
  });
}

async function waitWithTimeout(promise, timeoutMs) {
  if (timeoutMs === 0) return false;
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Start the portable self-host ingress boundary.
 *
 * The upstream host is intentionally not configurable: Wrangler must listen on
 * loopback HTTP only. `protocol: 'https'` requires caller-supplied certificate
 * and key material and marks only that directly terminated hop as HTTPS.
 */
export async function startSelfHostGateway(options = {}) {
  const host = typeof options.host === 'string' && options.host.trim()
    ? options.host.trim()
    : '0.0.0.0';
  const port = normalizePort(options.port ?? 8787, 'port', true);
  const upstreamPort = normalizePort(options.upstreamPort, 'upstreamPort');
  const protocol = options.protocol ?? 'http';
  const defaultDrainTimeoutMs = normalizeDrainTimeout(options.drainTimeoutMs);
  const trustedProxyMatcher = createTrustedProxyMatcher(options.trustedProxyCidrs);
  const workerTrustSecret = options.workerTrustSecret;
  const healthProvider = options.healthProvider;
  const admissionGuard = options.admissionGuard;

  if (typeof workerTrustSecret !== 'string' || !WORKER_TRUST_SECRET_PATTERN.test(workerTrustSecret)) {
    throw new TypeError('workerTrustSecret must be 32 random bytes encoded as lowercase hex.');
  }
  if (healthProvider !== undefined && typeof healthProvider !== 'function') {
    throw new TypeError('healthProvider must be a synchronous function.');
  }
  if (admissionGuard !== undefined && typeof admissionGuard !== 'function') {
    throw new TypeError('admissionGuard must be a synchronous function.');
  }

  if (protocol !== 'http' && protocol !== 'https') {
    throw new TypeError("protocol must be either 'http' or 'https'.");
  }
  if (port !== 0 && port === upstreamPort) {
    throw new TypeError('port and upstreamPort must be different.');
  }
  if (protocol === 'http' && options.tls !== undefined) {
    throw new TypeError('tls is only valid when protocol is https.');
  }
  if (
    protocol === 'https'
    && (!options.tls || !hasTlsMaterial(options.tls.cert) || !hasTlsMaterial(options.tls.key))
  ) {
    throw new TypeError('HTTPS self-host gateway requires explicit tls.cert and tls.key.');
  }

  let accepting = true;
  let stopPromise;
  const inboundSockets = new Set();
  const upstreamSockets = new Set();
  const upgradedSockets = new Set();
  const activeNormal = new Set();
  const drainWaiters = new Set();

  const notifyDrained = () => {
    if (activeNormal.size !== 0) return;
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  };
  const admissionAllowed = () => {
    if (!accepting) return false;
    try {
      return admissionGuard ? admissionGuard() === true : true;
    } catch {
      return false;
    }
  };
  const waitForNormalDrain = () => {
    if (activeNormal.size === 0) return Promise.resolve();
    return new Promise((resolve) => drainWaiters.add(resolve));
  };

  const proxyHttp = (clientRequest, clientResponse, expectContinue = false) => {
    if (clientRequest.method === 'CONNECT') {
      writeHttpFailure(clientRequest, clientResponse, 405, 'CONNECT is not allowed.\n');
      return;
    }
    if (
      clientRequest.headers.upgrade !== undefined
      || connectionNominations(clientRequest.rawHeaders).has('upgrade')
    ) {
      writeHttpFailure(clientRequest, clientResponse, 400, 'Unsupported protocol upgrade.\n');
      return;
    }

    const target = resolveRequestTarget(clientRequest.url);
    if (target.kind === 'blocked') {
      writeHttpFailure(clientRequest, clientResponse, 404, 'Not found.\n');
      return;
    }
    if (target.kind !== 'proxy') {
      writeHttpFailure(clientRequest, clientResponse, 400, 'Invalid request target.\n');
      return;
    }
    if (target.target === HEALTH_PATH) {
      writeHealthResponse(clientRequest, clientResponse, healthProvider, admissionAllowed());
      return;
    }
    if (!admissionAllowed()) {
      writeHttpFailure(clientRequest, clientResponse, 503, 'Gateway is stopping.\n');
      return;
    }

    const preparedRequestHeaders = prepareRequestHeaders(clientRequest.rawHeaders, {
      protocol,
      remoteAddress: clientRequest.socket.remoteAddress,
      upgrade: false,
      trustedProxy: trustedProxyMatcher.check(clientRequest.socket.remoteAddress),
      workerTrustSecret,
    });
    if (!preparedRequestHeaders) {
      writeHttpFailure(clientRequest, clientResponse, 400, 'Invalid Host authority.\n');
      return;
    }
    const exchange = {
      upstreamRequest: undefined,
      upstreamResponse: undefined,
      settled: false,
      responseStarted: false,
      bodyStarted: false,
      clientAborted: false,
    };
    activeNormal.add(exchange);
    const settle = () => {
      if (exchange.settled) return;
      exchange.settled = true;
      activeNormal.delete(exchange);
      notifyDrained();
    };

    let upstreamRequest;
    try {
      upstreamRequest = requestHttp({
        hostname: LOOPBACK_UPSTREAM_HOST,
        port: upstreamPort,
        method: clientRequest.method,
        path: target.target,
        headers: preparedRequestHeaders.rawHeaders,
        setHost: false,
        agent: false,
      });
    } catch {
      writeHttpFailure(clientRequest, clientResponse, 502, 'Upstream unavailable.\n');
      settle();
      return;
    }
    exchange.upstreamRequest = upstreamRequest;

    upstreamRequest.once('socket', (socket) => trackSocket(upstreamSockets, socket));
    upstreamRequest.once('response', (upstreamResponse) => {
      exchange.responseStarted = true;
      exchange.upstreamResponse = upstreamResponse;
      const preparedResponseHeaders = prepareResponseHeaders(upstreamResponse.rawHeaders);
      try {
        clientResponse.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.statusMessage,
          preparedResponseHeaders.rawHeaders,
        );
      } catch {
        upstreamResponse.destroy();
        clientResponse.destroy();
        return;
      }

      upstreamResponse.pipe(clientResponse, { end: false });
      upstreamResponse.once('end', () => {
        if (clientResponse.destroyed || clientResponse.writableEnded) return;
        const trailers = trailersFromRawHeaders(
          upstreamResponse.rawTrailers,
          preparedResponseHeaders.trailerNames,
        );
        if (Object.keys(trailers).length > 0) clientResponse.addTrailers(trailers);
        clientResponse.end();
      });
      upstreamResponse.once('aborted', () => clientResponse.destroy());
      upstreamResponse.once('error', () => clientResponse.destroy());
    });
    upstreamRequest.once('error', () => {
      if (exchange.clientAborted || clientResponse.destroyed || clientResponse.writableEnded) return;
      if (exchange.responseStarted || clientResponse.headersSent) clientResponse.destroy();
      else writeHttpFailure(clientRequest, clientResponse, 502, 'Upstream unavailable.\n');
    });

    clientRequest.once('aborted', () => {
      exchange.clientAborted = true;
      upstreamRequest.destroy();
      exchange.upstreamResponse?.destroy();
    });
    clientRequest.once('error', () => {
      exchange.clientAborted = true;
      upstreamRequest.destroy();
      exchange.upstreamResponse?.destroy();
    });
    clientResponse.once('finish', settle);
    clientResponse.once('close', () => {
      if (!clientResponse.writableFinished) {
        exchange.clientAborted = true;
        upstreamRequest.destroy();
        exchange.upstreamResponse?.destroy();
      }
      settle();
    });

    const startBody = () => {
      if (exchange.bodyStarted || exchange.responseStarted || exchange.clientAborted) return;
      exchange.bodyStarted = true;
      relayRequestBody(clientRequest, upstreamRequest, preparedRequestHeaders.trailerNames);
    };
    if (expectContinue) {
      upstreamRequest.once('continue', () => {
        if (!clientResponse.headersSent && !clientResponse.destroyed) clientResponse.writeContinue();
        startBody();
      });
      upstreamRequest.flushHeaders();
    } else {
      startBody();
    }
  };

  const proxyUpgrade = (request, clientSocket, clientHead) => {
    trackSocket(upgradedSockets, clientSocket);
    if (request.method !== 'GET') {
      writeRawFailure(clientSocket, 400, 'Invalid WebSocket method.\n');
      return;
    }
    const target = resolveRequestTarget(request.url);
    if (target.kind === 'blocked') {
      writeRawFailure(clientSocket, 404, 'Not found.\n');
      return;
    }
    if (target.kind !== 'proxy') {
      writeRawFailure(clientSocket, 400, 'Invalid request target.\n');
      return;
    }
    if (target.target === HEALTH_PATH) {
      writeRawFailure(clientSocket, 404, 'Not found.\n');
      return;
    }
    if (!admissionAllowed()) {
      writeRawFailure(clientSocket, 503, 'Gateway is stopping.\n');
      return;
    }
    const upgrade = String(request.headers.upgrade ?? '').trim().toLowerCase();
    if (upgrade !== 'websocket' || !connectionNominations(request.rawHeaders).has('upgrade')) {
      writeRawFailure(clientSocket, 400, 'Unsupported protocol upgrade.\n');
      return;
    }

    const preparedHeaders = prepareRequestHeaders(request.rawHeaders, {
      protocol,
      remoteAddress: request.socket.remoteAddress,
      upgrade: true,
      trustedProxy: trustedProxyMatcher.check(request.socket.remoteAddress),
      workerTrustSecret,
    });
    if (!preparedHeaders) {
      writeRawFailure(clientSocket, 400, 'Invalid Host authority.\n');
      return;
    }
    let peerSocket;
    let responseStarted = false;
    let upstreamRequest;
    try {
      upstreamRequest = requestHttp({
        hostname: LOOPBACK_UPSTREAM_HOST,
        port: upstreamPort,
        method: 'GET',
        path: target.target,
        headers: preparedHeaders.rawHeaders,
        setHost: false,
        agent: false,
      });
    } catch {
      writeRawFailure(clientSocket, 502, 'Upstream unavailable.\n');
      return;
    }

    upstreamRequest.once('socket', (socket) => {
      peerSocket = socket;
      trackSocket(upstreamSockets, socket);
      trackSocket(upgradedSockets, socket);
    });
    upstreamRequest.once('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      responseStarted = true;
      peerSocket = upstreamSocket;
      trackSocket(upstreamSockets, upstreamSocket);
      trackSocket(upgradedSockets, upstreamSocket);
      const responseHeaders = prepareUpgradeResponseHeaders(upstreamResponse.rawHeaders);
      clientSocket.cork();
      clientSocket.write(serializeRawResponse(upstreamResponse, responseHeaders));
      if (upstreamHead.length > 0) clientSocket.write(upstreamHead);
      clientSocket.uncork();
      if (clientHead.length > 0) upstreamSocket.write(clientHead);
      bridgeRawSockets(clientSocket, upstreamSocket);
    });
    upstreamRequest.once('response', (upstreamResponse) => {
      responseStarted = true;
      peerSocket = upstreamResponse.socket;
      if (peerSocket) {
        trackSocket(upstreamSockets, peerSocket);
        trackSocket(upgradedSockets, peerSocket);
      }
      const responseHeaders = prepareResponseHeaders(upstreamResponse.rawHeaders).rawHeaders;
      clientSocket.write(serializeRawResponse(upstreamResponse, responseHeaders, true));
      upstreamResponse.pipe(clientSocket, { end: false });
      upstreamResponse.once('end', () => clientSocket.end());
      upstreamResponse.once('aborted', () => clientSocket.destroy());
      upstreamResponse.once('error', () => clientSocket.destroy());
    });
    upstreamRequest.once('error', () => {
      if (!responseStarted && !clientSocket.destroyed) {
        writeRawFailure(clientSocket, 502, 'Upstream unavailable.\n');
      } else if (!clientSocket.destroyed) {
        clientSocket.destroy();
      }
    });
    clientSocket.once('error', () => {
      if (peerSocket && !peerSocket.destroyed) peerSocket.destroy();
      else upstreamRequest.destroy();
    });
    clientSocket.once('close', () => {
      if (peerSocket && !peerSocket.destroyed) peerSocket.destroy();
      else upstreamRequest.destroy();
    });
    upstreamRequest.end();
  };

  const server = protocol === 'https'
    ? createHttpsServer({
      cert: options.tls.cert,
      key: options.tls.key,
      minVersion: 'TLSv1.2',
      allowHalfOpen: true,
    })
    : createHttpServer({ allowHalfOpen: true });
  server.timeout = 0;
  server.requestTimeout = 0;
  server.on('connection', (socket) => trackSocket(inboundSockets, socket));
  server.on('request', (request, response) => proxyHttp(request, response, false));
  server.on('checkContinue', (request, response) => proxyHttp(request, response, true));
  server.on('upgrade', proxyUpgrade);
  server.on('connect', (_request, socket) => {
    trackSocket(upgradedSockets, socket);
    writeRawFailure(socket, 405, 'CONNECT is not allowed.\n');
  });
  server.on('clientError', (error, socket) => {
    if (blockedTargetFromClientError(error)) writeRawFailure(socket, 404, 'Not found.\n');
    else writeRawFailure(socket, 400, 'Invalid HTTP request.\n');
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host, port, exclusive: true });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Self-host gateway did not receive a TCP listening address.');
  }

  let admissionClosePromise;
  let admissionCloseResolved = false;
  const stopAdmission = () => {
    accepting = false;
    if (admissionClosePromise) return admissionClosePromise;
    admissionClosePromise = new Promise((resolve) => {
      if (!server.listening) {
        admissionCloseResolved = true;
        resolve();
        return;
      }
      server.close(() => {
        admissionCloseResolved = true;
        resolve();
      });
    });
    server.closeIdleConnections?.();
    return admissionClosePromise;
  };

  const stop = (stopOptions = {}) => {
    if (stopPromise) return stopPromise;
    const drainTimeoutMs = normalizeDrainTimeout(
      stopOptions.drainTimeoutMs ?? defaultDrainTimeoutMs,
    );
    stopPromise = (async () => {
      const closePromise = stopAdmission();

      const drained = await waitWithTimeout(waitForNormalDrain(), drainTimeoutMs);
      destroySockets(upgradedSockets);
      if (!drained) {
        for (const exchange of activeNormal) {
          exchange.upstreamRequest?.destroy();
          exchange.upstreamResponse?.destroy();
        }
        destroySockets(inboundSockets);
        destroySockets(upstreamSockets);
      }
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      if (!admissionCloseResolved) await waitWithTimeout(closePromise, 250);
      if (!admissionCloseResolved) {
        destroySockets(inboundSockets);
        destroySockets(upstreamSockets);
        await waitWithTimeout(closePromise, 250);
      }
    })();
    return stopPromise;
  };

  return Object.freeze({
    server,
    address,
    host,
    port: address.port,
    protocol,
    upstreamHost: LOOPBACK_UPSTREAM_HOST,
    upstreamPort,
    trustedProxyCidrs: trustedProxyMatcher.cidrs,
    stopAdmission,
    stop,
  });
}
