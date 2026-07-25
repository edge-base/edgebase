import { Buffer } from 'node:buffer';
import {
  STATUS_CODES,
  createServer as createHttpServer,
  request as requestHttp,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync, statfsSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';

const LOOPBACK_UPSTREAM_HOST = '127.0.0.1';
const HEALTH_PATH = '/__edgebase/health';
const DEFAULT_MAX_CONNECTIONS = 512;
const DEFAULT_MAX_REQUEST_BODY_BYTES = 5 * 1024 ** 3;
const DEFAULT_HEADERS_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 5_000;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_EVENT_COALESCE_WINDOW_MS = 5_000;
const DEFAULT_MEMORY_SAMPLE_INTERVAL_MS = 250;
const DEFAULT_MEMORY_LIMIT_REFRESH_INTERVAL_MS = 5_000;
const DEFAULT_MEMORY_HIGH_WATERMARK_RATIO = 0.8;
const DEFAULT_MEMORY_RECOVERY_WATERMARK_RATIO = 0.75;
const DEFAULT_MEMORY_MINIMUM_HEADROOM_BYTES = 256 * 1024 ** 2;
const DEFAULT_MEMORY_RETRY_AFTER_SECONDS = 1;
const DEFAULT_STORAGE_SAMPLE_INTERVAL_MS = 250;
const DEFAULT_STORAGE_MINIMUM_FREE_BYTES = 512 * 1024 ** 2;
const DEFAULT_STORAGE_RECOVERY_HEADROOM_BYTES = 128 * 1024 ** 2;
const DEFAULT_STORAGE_RETRY_AFTER_SECONDS = 5;
const MAX_CONFIGURED_FILESYSTEM_BYTES = BigInt(Number.MAX_SAFE_INTEGER);
const RATIO_SCALE = 10_000n;
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

function normalizeBoundedInteger(value, label, defaultValue, maximum) {
  const candidate = value === undefined
    ? defaultValue
    : (typeof value === 'string' && value.trim() !== '' ? Number(value) : value);
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw new TypeError(`${label} must be an integer between 1 and ${maximum}.`);
  }
  return candidate;
}

function normalizeRatio(value, label, defaultValue) {
  const candidate = value === undefined ? defaultValue : Number(value);
  if (!Number.isFinite(candidate) || candidate <= 0 || candidate >= 1) {
    throw new TypeError(`${label} must be a number greater than 0 and less than 1.`);
  }
  const scaled = BigInt(Math.round(candidate * Number(RATIO_SCALE)));
  if (scaled <= 0n || scaled >= RATIO_SCALE) {
    throw new TypeError(`${label} is outside the supported four-decimal precision.`);
  }
  return { scaled };
}

function normalizeFilesystemByteCount(value, label, defaultValue) {
  const candidate = value === undefined ? defaultValue : value;
  let bytes;
  if (typeof candidate === 'bigint') {
    bytes = candidate;
  } else if (typeof candidate === 'number' && Number.isSafeInteger(candidate)) {
    bytes = BigInt(candidate);
  } else if (typeof candidate === 'string' && /^\d+$/.test(candidate.trim())) {
    bytes = BigInt(candidate.trim());
  } else {
    throw new TypeError(`${label} must be a nonnegative integer byte count.`);
  }
  if (bytes < 0n || bytes > MAX_CONFIGURED_FILESYSTEM_BYTES) {
    throw new TypeError(`${label} must be between 0 and Number.MAX_SAFE_INTEGER.`);
  }
  return bytes;
}

function statfsAvailableBytes(value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError('statfs must return an object.');
  }
  const toNonnegativeBigInt = (candidate, label, allowZero) => {
    let parsed;
    if (typeof candidate === 'bigint') parsed = candidate;
    else if (typeof candidate === 'number' && Number.isSafeInteger(candidate)) {
      parsed = BigInt(candidate);
    } else {
      throw new TypeError(`statfs ${label} must be an integer.`);
    }
    if (parsed < 0n || (!allowZero && parsed === 0n)) {
      throw new TypeError(`statfs ${label} is outside its valid range.`);
    }
    return parsed;
  };
  const availableBlocks = toNonnegativeBigInt(value.bavail, 'bavail', true);
  const blockSize = toNonnegativeBigInt(value.bsize, 'bsize', false);
  return availableBlocks * blockSize;
}

function statusByteCount(bytes) {
  if (bytes === null) return null;
  return bytes <= MAX_CONFIGURED_FILESYSTEM_BYTES ? Number(bytes) : bytes.toString();
}

function parseCgroupByteCount(value, { allowUnlimited = false } = {}) {
  const source = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
  const normalized = source.trim();
  if (allowUnlimited && normalized === 'max') return { kind: 'unlimited' };
  if (!/^\d+$/.test(normalized)) return { kind: 'invalid' };
  const bytes = BigInt(normalized);
  if (allowUnlimited && bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { kind: 'unlimited' };
  }
  if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: 'invalid' };
  return { kind: 'finite', bytes };
}

function parseCgroupInactiveFileBytes(value, keys) {
  const source = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
  if (!source || !Array.isArray(keys) || keys.length === 0) return null;
  const wanted = new Set(keys);
  const values = new Map();
  for (const line of source.split(/\r?\n/u)) {
    const match = /^([a-z0-9_]+)\s+(\d+)$/u.exec(line.trim());
    if (!match || !wanted.has(match[1])) continue;
    const parsed = parseCgroupByteCount(match[2]);
    if (parsed.kind === 'finite') values.set(match[1], parsed.bytes);
  }
  for (const key of keys) {
    if (values.has(key)) return values.get(key);
  }
  return null;
}

function cgroupWorkingSetBytes(currentBytes, inactiveFileBytes) {
  if (inactiveFileBytes === null) return currentBytes;
  return inactiveFileBytes >= currentBytes ? 0n : currentBytes - inactiveFileBytes;
}

/**
 * Build one cached whole-cgroup memory admission controller. Missing or
 * explicitly unlimited cgroups remain admitted; a previously observed
 * pressure state stays closed across transient sensor failures until a valid
 * recovery sample arrives.
 */
export function createCgroupMemoryAdmissionController(options = {}) {
  const readFile = options.readFile ?? ((path) => readFileSync(path, 'utf8'));
  const now = options.now ?? Date.now;
  if (typeof readFile !== 'function') throw new TypeError('readFile must be a function.');
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  const sampleIntervalMs = normalizeBoundedInteger(
    options.sampleIntervalMs,
    'sampleIntervalMs',
    DEFAULT_MEMORY_SAMPLE_INTERVAL_MS,
    60_000,
  );
  const limitRefreshIntervalMs = normalizeBoundedInteger(
    options.limitRefreshIntervalMs,
    'limitRefreshIntervalMs',
    DEFAULT_MEMORY_LIMIT_REFRESH_INTERVAL_MS,
    300_000,
  );
  if (limitRefreshIntervalMs < sampleIntervalMs) {
    throw new TypeError('limitRefreshIntervalMs must be greater than or equal to sampleIntervalMs.');
  }
  const highWatermark = normalizeRatio(
    options.highWatermarkRatio,
    'highWatermarkRatio',
    DEFAULT_MEMORY_HIGH_WATERMARK_RATIO,
  );
  const recoveryWatermark = normalizeRatio(
    options.recoveryWatermarkRatio,
    'recoveryWatermarkRatio',
    DEFAULT_MEMORY_RECOVERY_WATERMARK_RATIO,
  );
  if (recoveryWatermark.scaled >= highWatermark.scaled) {
    throw new TypeError('recoveryWatermarkRatio must be lower than highWatermarkRatio.');
  }
  const minimumHeadroomBytes = normalizeBoundedInteger(
    options.minimumHeadroomBytes,
    'minimumHeadroomBytes',
    DEFAULT_MEMORY_MINIMUM_HEADROOM_BYTES,
    16 * 1024 ** 3,
  );
  const retryAfterSeconds = normalizeBoundedInteger(
    options.retryAfterSeconds,
    'retryAfterSeconds',
    DEFAULT_MEMORY_RETRY_AFTER_SECONDS,
    60,
  );
  const sources = [
    {
      name: 'cgroup-v2',
      currentPath: '/sys/fs/cgroup/memory.current',
      limitPath: '/sys/fs/cgroup/memory.max',
      statPath: '/sys/fs/cgroup/memory.stat',
      inactiveFileKeys: ['inactive_file'],
    },
    {
      name: 'cgroup-v1',
      currentPath: '/sys/fs/cgroup/memory/memory.usage_in_bytes',
      limitPath: '/sys/fs/cgroup/memory/memory.limit_in_bytes',
      statPath: '/sys/fs/cgroup/memory/memory.stat',
      inactiveFileKeys: ['total_inactive_file', 'inactive_file'],
    },
  ];
  const pressureDecision = Object.freeze({
    allowed: false,
    reason: 'memory_pressure',
    retryAfterSeconds,
  });
  let selectedSource = null;
  let currentBytes = null;
  let rawCurrentBytes = null;
  let inactiveFileBytes = null;
  let limitBytes = null;
  let outcome = 'unavailable';
  let shedding = false;
  let sampledAt = null;
  let nextSampleAt = Number.NEGATIVE_INFINITY;
  let nextLimitRefreshAt = Number.NEGATIVE_INFINITY;

  const safeRead = (path) => {
    try {
      return readFile(path);
    } catch {
      return undefined;
    }
  };
  const evaluate = () => {
    if (currentBytes === null || limitBytes === null) return;
    const ratioThreshold = (limitBytes * highWatermark.scaled) / RATIO_SCALE;
    const headroom = BigInt(minimumHeadroomBytes);
    const headroomThreshold = limitBytes > headroom ? limitBytes - headroom : 0n;
    const highThreshold = ratioThreshold < headroomThreshold
      ? ratioThreshold
      : headroomThreshold;
    const ratioRecoveryThreshold = (limitBytes * recoveryWatermark.scaled) / RATIO_SCALE;
    const hysteresisBytes = (
      limitBytes * (highWatermark.scaled - recoveryWatermark.scaled)
    ) / RATIO_SCALE;
    const headroomRecoveryThreshold = highThreshold > hysteresisBytes
      ? highThreshold - hysteresisBytes
      : 0n;
    const recoveryThreshold = ratioRecoveryThreshold < headroomRecoveryThreshold
      ? ratioRecoveryThreshold
      : headroomRecoveryThreshold;
    if (shedding) {
      if (currentBytes <= recoveryThreshold && limitBytes - currentBytes >= headroom) {
        shedding = false;
      }
    } else if (currentBytes >= highThreshold || limitBytes - currentBytes <= headroom) {
      shedding = true;
    }
    outcome = shedding ? 'shedding' : 'ready';
  };
  const discover = () => {
    const wasShedding = shedding;
    for (const candidate of sources) {
      const parsedLimit = parseCgroupByteCount(safeRead(candidate.limitPath), {
        allowUnlimited: true,
      });
      if (parsedLimit.kind === 'invalid') continue;
      selectedSource = candidate;
      if (parsedLimit.kind === 'unlimited') {
        currentBytes = null;
        rawCurrentBytes = null;
        inactiveFileBytes = null;
        limitBytes = null;
        outcome = 'unlimited';
        shedding = false;
        return;
      }
      const parsedCurrent = parseCgroupByteCount(safeRead(candidate.currentPath));
      if (parsedCurrent.kind !== 'finite') continue;
      rawCurrentBytes = parsedCurrent.bytes;
      inactiveFileBytes = parseCgroupInactiveFileBytes(
        safeRead(candidate.statPath),
        candidate.inactiveFileKeys,
      );
      currentBytes = cgroupWorkingSetBytes(rawCurrentBytes, inactiveFileBytes);
      limitBytes = parsedLimit.bytes;
      evaluate();
      return;
    }
    selectedSource = null;
    currentBytes = null;
    rawCurrentBytes = null;
    inactiveFileBytes = null;
    limitBytes = null;
    shedding = wasShedding;
    outcome = wasShedding ? 'shedding' : 'unavailable';
  };
  const sample = () => {
    const sampledNow = Number(now());
    if (!Number.isFinite(sampledNow)) return;
    if (sampledNow >= nextLimitRefreshAt) {
      discover();
      sampledAt = sampledNow;
      nextSampleAt = sampledNow + sampleIntervalMs;
      nextLimitRefreshAt = sampledNow + limitRefreshIntervalMs;
      return;
    }
    if (outcome === 'unlimited' || selectedSource === null || sampledNow < nextSampleAt) return;
    const parsedCurrent = parseCgroupByteCount(safeRead(selectedSource.currentPath));
    sampledAt = sampledNow;
    nextSampleAt = sampledNow + sampleIntervalMs;
    if (parsedCurrent.kind === 'finite') {
      rawCurrentBytes = parsedCurrent.bytes;
      inactiveFileBytes = parseCgroupInactiveFileBytes(
        safeRead(selectedSource.statPath),
        selectedSource.inactiveFileKeys,
      );
      currentBytes = cgroupWorkingSetBytes(rawCurrentBytes, inactiveFileBytes);
      evaluate();
      return;
    }
    const wasShedding = shedding;
    currentBytes = null;
    rawCurrentBytes = null;
    inactiveFileBytes = null;
    shedding = wasShedding;
    outcome = wasShedding ? 'shedding' : 'unavailable';
  };
  return Object.freeze({
    decision() {
      sample();
      return shedding ? pressureDecision : true;
    },
    status() {
      sample();
      return Object.freeze({
        source: selectedSource?.name ?? null,
        outcome,
        currentBytes: currentBytes === null ? null : Number(currentBytes),
        rawCurrentBytes: rawCurrentBytes === null ? null : Number(rawCurrentBytes),
        inactiveFileBytes: inactiveFileBytes === null ? null : Number(inactiveFileBytes),
        limitBytes: limitBytes === null ? null : Number(limitBytes),
        sampledAt,
      });
    },
  });
}

/**
 * Build one cached admission controller for a persistence filesystem. Failed
 * probes close admission, while pressure remains closed until a distinct
 * recovery watermark is observed.
 */
export function createFilesystemCapacityAdmissionController(options = {}) {
  const path = typeof options.path === 'string' ? options.path.trim() : '';
  const readStatfs = options.readStatfs
    ?? ((target) => statfsSync(target, { bigint: true }));
  const now = options.now ?? Date.now;
  if (!path) throw new TypeError('path must be a non-empty string.');
  if (typeof readStatfs !== 'function') throw new TypeError('readStatfs must be a function.');
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  const sampleIntervalMs = normalizeBoundedInteger(
    options.sampleIntervalMs,
    'sampleIntervalMs',
    DEFAULT_STORAGE_SAMPLE_INTERVAL_MS,
    60_000,
  );
  const minimumFreeBytes = normalizeFilesystemByteCount(
    options.minimumFreeBytes,
    'minimumFreeBytes',
    DEFAULT_STORAGE_MINIMUM_FREE_BYTES,
  );
  let recoveryFreeBytes;
  if (options.recoveryFreeBytes === undefined) {
    recoveryFreeBytes = minimumFreeBytes + BigInt(DEFAULT_STORAGE_RECOVERY_HEADROOM_BYTES);
    if (recoveryFreeBytes > MAX_CONFIGURED_FILESYSTEM_BYTES) {
      throw new TypeError('minimumFreeBytes leaves no safe recovery headroom.');
    }
  } else {
    recoveryFreeBytes = normalizeFilesystemByteCount(
      options.recoveryFreeBytes,
      'recoveryFreeBytes',
      0,
    );
  }
  if (recoveryFreeBytes <= minimumFreeBytes) {
    throw new TypeError('recoveryFreeBytes must be greater than minimumFreeBytes.');
  }
  const retryAfterSeconds = normalizeBoundedInteger(
    options.retryAfterSeconds,
    'retryAfterSeconds',
    DEFAULT_STORAGE_RETRY_AFTER_SECONDS,
    60,
  );
  const pressureDecision = Object.freeze({
    allowed: false,
    reason: 'storage_pressure',
    retryAfterSeconds,
  });
  const probeFailedDecision = Object.freeze({
    allowed: false,
    reason: 'storage_probe_failed',
    retryAfterSeconds,
  });
  let availableBytes = null;
  let outcome = 'unavailable';
  let shedding = false;
  let sampledAt = null;
  let nextSampleAt = Number.NEGATIVE_INFINITY;

  const sample = () => {
    let sampledNow;
    try {
      sampledNow = Number(now());
    } catch {
      sampledNow = Number.NaN;
    }
    if (!Number.isFinite(sampledNow)) {
      availableBytes = null;
      outcome = 'unavailable';
      return;
    }
    if (sampledNow < nextSampleAt) return;
    sampledAt = sampledNow;
    nextSampleAt = sampledNow + sampleIntervalMs;
    try {
      availableBytes = statfsAvailableBytes(readStatfs(path));
    } catch {
      availableBytes = null;
      outcome = 'unavailable';
      return;
    }
    if (shedding) {
      if (availableBytes >= recoveryFreeBytes) shedding = false;
    } else if (availableBytes < minimumFreeBytes) {
      shedding = true;
    }
    outcome = shedding ? 'shedding' : 'ready';
  };

  return Object.freeze({
    decision() {
      sample();
      if (outcome === 'unavailable') return probeFailedDecision;
      return shedding ? pressureDecision : true;
    },
    status() {
      sample();
      return Object.freeze({
        path,
        outcome,
        availableBytes: statusByteCount(availableBytes),
        minimumFreeBytes: statusByteCount(minimumFreeBytes),
        recoveryFreeBytes: statusByteCount(recoveryFreeBytes),
        sampledAt,
      });
    },
  });
}

function createEventReporter(onEvent, coalesceWindowMs) {
  if (!onEvent) {
    return Object.freeze({ report() {}, flush() {} });
  }
  const states = new Map();
  const emit = (payload) => {
    try {
      onEvent(Object.freeze(payload));
    } catch {
      // Operational reporting must never change gateway behavior.
    }
  };
  return Object.freeze({
    report(event) {
      const now = Date.now();
      const { aggregationClass = '', ...payload } = event;
      const key = `${payload.event}:${payload.reason}:${aggregationClass}`;
      const state = states.get(key);
      if (!state) {
        states.set(key, { emittedAt: now, suppressed: 0, lastEvent: payload });
        emit({ schemaVersion: 1, ...payload, occurrences: 1, suppressed: 0 });
        return;
      }
      if (now - state.emittedAt < coalesceWindowMs) {
        state.suppressed += 1;
        state.lastEvent = payload;
        return;
      }
      emit({
        schemaVersion: 1,
        ...payload,
        occurrences: state.suppressed + 1,
        suppressed: state.suppressed,
      });
      state.emittedAt = now;
      state.suppressed = 0;
      state.lastEvent = payload;
    },
    flush() {
      for (const state of states.values()) {
        if (state.suppressed === 0) continue;
        emit({
          schemaVersion: 1,
          ...state.lastEvent,
          occurrences: state.suppressed,
          suppressed: state.suppressed,
          summary: true,
        });
        state.suppressed = 0;
      }
    },
  });
}

function sanitizedErrorCode(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : undefined;
}

function declaredContentLength(rawHeaders) {
  const values = rawHeaderValues(rawHeaders, 'content-length');
  if (values.length !== 1 || !/^\d+$/.test(values[0].trim())) return null;
  try {
    return BigInt(values[0].trim());
  } catch {
    return null;
  }
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

function writeHttpFailure(request, response, statusCode, body, retryAfterSeconds) {
  if (response.destroyed || response.writableEnded) return;
  const payload = Buffer.from(body, 'utf8');
  response.statusCode = statusCode;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Length', String(payload.length));
  response.setHeader('Connection', 'close');
  if (retryAfterSeconds !== undefined) {
    response.setHeader('Retry-After', String(retryAfterSeconds));
  }
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

function writeRawFailure(socket, statusCode, body, retryAfterSeconds) {
  if (socket.destroyed) return;
  const payload = Buffer.from(body, 'utf8');
  const reason = STATUS_CODES[statusCode] || 'Error';
  socket.end(
    `HTTP/1.1 ${statusCode} ${reason}\r\n`
    + 'Cache-Control: no-store\r\n'
    + 'Content-Type: text/plain; charset=utf-8\r\n'
    + `Content-Length: ${payload.length}\r\n`
    + (retryAfterSeconds === undefined ? '' : `Retry-After: ${retryAfterSeconds}\r\n`)
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

function relayRequestBody(
  clientRequest,
  upstreamRequest,
  trailerNames,
  maxRequestBodyBytes,
  onLimit,
) {
  let receivedBytes = 0;
  let rejected = false;

  clientRequest.on('data', (chunk) => {
    if (rejected || upstreamRequest.destroyed) return;
    if (receivedBytes + chunk.length > maxRequestBodyBytes) {
      rejected = true;
      clientRequest.pause();
      onLimit();
      return;
    }
    receivedBytes += chunk.length;
    clientRequest.pause();
    upstreamRequest.write(chunk, () => {
      if (!rejected && !upstreamRequest.destroyed) clientRequest.resume();
    });
  });
  clientRequest.once('end', () => {
    if (rejected || upstreamRequest.destroyed) return;
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
  const maxConnections = normalizeBoundedInteger(
    options.maxConnections,
    'maxConnections',
    DEFAULT_MAX_CONNECTIONS,
    65_535,
  );
  const maxRequestBodyBytes = normalizeBoundedInteger(
    options.maxRequestBodyBytes,
    'maxRequestBodyBytes',
    DEFAULT_MAX_REQUEST_BODY_BYTES,
    DEFAULT_MAX_REQUEST_BODY_BYTES,
  );
  const headersTimeoutMs = normalizeBoundedInteger(
    options.headersTimeoutMs,
    'headersTimeoutMs',
    DEFAULT_HEADERS_TIMEOUT_MS,
    300_000,
  );
  const requestTimeoutMs = normalizeBoundedInteger(
    options.requestTimeoutMs,
    'requestTimeoutMs',
    DEFAULT_REQUEST_TIMEOUT_MS,
    86_400_000,
  );
  const idleTimeoutMs = normalizeBoundedInteger(
    options.idleTimeoutMs,
    'idleTimeoutMs',
    DEFAULT_IDLE_TIMEOUT_MS,
    3_600_000,
  );
  const keepAliveTimeoutMs = normalizeBoundedInteger(
    options.keepAliveTimeoutMs,
    'keepAliveTimeoutMs',
    DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
    300_000,
  );
  const upstreamTimeoutMs = normalizeBoundedInteger(
    options.upstreamTimeoutMs,
    'upstreamTimeoutMs',
    DEFAULT_UPSTREAM_TIMEOUT_MS,
    3_600_000,
  );
  const eventCoalesceWindowMs = normalizeBoundedInteger(
    options.eventCoalesceWindowMs,
    'eventCoalesceWindowMs',
    DEFAULT_EVENT_COALESCE_WINDOW_MS,
    60_000,
  );
  const trustedProxyMatcher = createTrustedProxyMatcher(options.trustedProxyCidrs);
  const workerTrustSecret = options.workerTrustSecret;
  const healthProvider = options.healthProvider;
  const admissionGuard = options.admissionGuard;
  const memoryAdmissionController = options.memoryAdmissionController
    ?? createCgroupMemoryAdmissionController();
  const storageAdmissionController = options.storageAdmissionController;
  const onEvent = options.onEvent;

  if (typeof workerTrustSecret !== 'string' || !WORKER_TRUST_SECRET_PATTERN.test(workerTrustSecret)) {
    throw new TypeError('workerTrustSecret must be 32 random bytes encoded as lowercase hex.');
  }
  if (healthProvider !== undefined && typeof healthProvider !== 'function') {
    throw new TypeError('healthProvider must be a synchronous function.');
  }
  if (admissionGuard !== undefined && typeof admissionGuard !== 'function') {
    throw new TypeError('admissionGuard must be a synchronous function.');
  }
  if (
    !memoryAdmissionController
    || typeof memoryAdmissionController !== 'object'
    || typeof memoryAdmissionController.decision !== 'function'
  ) {
    throw new TypeError('memoryAdmissionController must expose a synchronous decision function.');
  }
  if (
    storageAdmissionController !== undefined
    && (
      !storageAdmissionController
      || typeof storageAdmissionController !== 'object'
      || typeof storageAdmissionController.decision !== 'function'
    )
  ) {
    throw new TypeError('storageAdmissionController must expose a synchronous decision function.');
  }
  if (onEvent !== undefined && typeof onEvent !== 'function') {
    throw new TypeError('onEvent must be a synchronous function.');
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
  const eventReporter = createEventReporter(onEvent, eventCoalesceWindowMs);
  const reportEvent = (level, event, reason, statusCode, error, aggregationClass) => {
    const errorCode = sanitizedErrorCode(error);
    eventReporter.report({
      level,
      event,
      reason,
      statusCode,
      ...(errorCode ? { errorCode } : {}),
      ...(aggregationClass ? { aggregationClass } : {}),
    });
  };
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
  const allowedDecision = Object.freeze({ allowed: true });
  const closedDecision = Object.freeze({
    allowed: false,
    statusCode: 503,
    body: 'Gateway is stopping.\n',
    reason: 'admission_closed',
    retryAfterSeconds: undefined,
  });
  const memoryPressureDecisions = new Map();
  const memoryPressureDecision = (retryAfterSeconds) => {
    let decision = memoryPressureDecisions.get(retryAfterSeconds);
    if (!decision) {
      decision = Object.freeze({
        allowed: false,
        statusCode: 429,
        body: 'Container memory pressure. Retry later.\n',
        reason: 'memory_pressure',
        retryAfterSeconds,
      });
      memoryPressureDecisions.set(retryAfterSeconds, decision);
    }
    return decision;
  };
  const storageFailureDecisions = new Map();
  const storageFailureDecision = (reason, retryAfterSeconds) => {
    const key = `${reason}:${retryAfterSeconds}`;
    let decision = storageFailureDecisions.get(key);
    if (!decision) {
      const pressure = reason === 'storage_pressure';
      decision = Object.freeze({
        allowed: false,
        statusCode: pressure ? 507 : 503,
        body: pressure
          ? 'Persistence storage is too full. Free disk space and retry.\n'
          : 'Persistence storage is unavailable. Retry later.\n',
        reason,
        retryAfterSeconds,
      });
      storageFailureDecisions.set(key, decision);
    }
    return decision;
  };
  const currentAdmissionDecision = () => {
    if (!accepting) return closedDecision;
    try {
      if (admissionGuard && admissionGuard() !== true) return closedDecision;
    } catch {
      return closedDecision;
    }
    let memoryDecision;
    try {
      memoryDecision = memoryAdmissionController.decision();
    } catch {
      return closedDecision;
    }
    if (memoryDecision !== true && (
      memoryDecision
      && typeof memoryDecision === 'object'
      && !Array.isArray(memoryDecision)
      && Object.keys(memoryDecision).sort().join(',') === 'allowed,reason,retryAfterSeconds'
      && memoryDecision.allowed === false
      && memoryDecision.reason === 'memory_pressure'
      && Number.isInteger(memoryDecision.retryAfterSeconds)
      && memoryDecision.retryAfterSeconds >= 1
      && memoryDecision.retryAfterSeconds <= 60
    )) {
      return memoryPressureDecision(memoryDecision.retryAfterSeconds);
    }
    if (memoryDecision !== true) return closedDecision;
    if (!storageAdmissionController) return allowedDecision;
    let storageDecision;
    try {
      storageDecision = storageAdmissionController.decision();
    } catch {
      return storageFailureDecision('storage_probe_failed', DEFAULT_STORAGE_RETRY_AFTER_SECONDS);
    }
    if (storageDecision === true) return allowedDecision;
    if (
      storageDecision
      && typeof storageDecision === 'object'
      && !Array.isArray(storageDecision)
      && Object.keys(storageDecision).sort().join(',') === 'allowed,reason,retryAfterSeconds'
      && storageDecision.allowed === false
      && (
        storageDecision.reason === 'storage_pressure'
        || storageDecision.reason === 'storage_probe_failed'
      )
      && Number.isInteger(storageDecision.retryAfterSeconds)
      && storageDecision.retryAfterSeconds >= 1
      && storageDecision.retryAfterSeconds <= 60
    ) {
      return storageFailureDecision(storageDecision.reason, storageDecision.retryAfterSeconds);
    }
    return storageFailureDecision('storage_probe_failed', DEFAULT_STORAGE_RETRY_AFTER_SECONDS);
  };
  const admissionAllowed = () => currentAdmissionDecision().allowed;
  const waitForNormalDrain = () => {
    if (activeNormal.size === 0) return Promise.resolve();
    return new Promise((resolve) => drainWaiters.add(resolve));
  };
  const rejectHttp = (
    request,
    response,
    statusCode,
    body,
    reason,
    aggregationClass,
    retryAfterSeconds,
  ) => {
    reportEvent(
      'warning',
      'gateway_request_rejected',
      reason,
      statusCode,
      undefined,
      aggregationClass,
    );
    writeHttpFailure(request, response, statusCode, body, retryAfterSeconds);
  };
  const rejectRaw = (socket, statusCode, body, reason, retryAfterSeconds) => {
    reportEvent('warning', 'gateway_request_rejected', reason, statusCode);
    writeRawFailure(socket, statusCode, body, retryAfterSeconds);
  };

  const proxyHttp = (clientRequest, clientResponse, expectContinue = false) => {
    if (clientRequest.method === 'CONNECT') {
      rejectHttp(
        clientRequest,
        clientResponse,
        405,
        'CONNECT is not allowed.\n',
        'connect_not_allowed',
      );
      return;
    }
    if (
      clientRequest.headers.upgrade !== undefined
      || connectionNominations(clientRequest.rawHeaders).has('upgrade')
    ) {
      rejectHttp(
        clientRequest,
        clientResponse,
        400,
        'Unsupported protocol upgrade.\n',
        'unsupported_upgrade',
      );
      return;
    }

    const target = resolveRequestTarget(clientRequest.url);
    if (target.kind === 'blocked') {
      rejectHttp(clientRequest, clientResponse, 404, 'Not found.\n', 'blocked_target');
      return;
    }
    if (target.kind !== 'proxy') {
      rejectHttp(
        clientRequest,
        clientResponse,
        400,
        'Invalid request target.\n',
        'invalid_target',
      );
      return;
    }
    if (target.target === HEALTH_PATH) {
      if (clientRequest.method !== 'GET') {
        reportEvent('warning', 'gateway_request_rejected', 'health_method_not_allowed', 405);
      }
      writeHealthResponse(clientRequest, clientResponse, healthProvider, admissionAllowed());
      return;
    }
    const admission = currentAdmissionDecision();
    if (!admission.allowed) {
      rejectHttp(
        clientRequest,
        clientResponse,
        admission.statusCode,
        admission.body,
        admission.reason,
        undefined,
        admission.retryAfterSeconds,
      );
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
      rejectHttp(
        clientRequest,
        clientResponse,
        400,
        'Invalid Host authority.\n',
        'invalid_authority',
      );
      return;
    }
    const contentLength = declaredContentLength(clientRequest.rawHeaders);
    if (contentLength !== null && contentLength > BigInt(maxRequestBodyBytes)) {
      rejectHttp(
        clientRequest,
        clientResponse,
        413,
        'Request body is too large.\n',
        'request_body_too_large',
        'declared_length',
      );
      return;
    }
    const exchange = {
      clientSocket: clientRequest.socket,
      upstreamRequest: undefined,
      upstreamResponse: undefined,
      settled: false,
      requestEnded: false,
      responseStarted: false,
      bodyStarted: false,
      clientAborted: false,
      terminalFailure: false,
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
    } catch (error) {
      reportEvent('error', 'gateway_upstream_failure', 'upstream_error', 502, error);
      writeHttpFailure(clientRequest, clientResponse, 502, 'Upstream unavailable.\n');
      settle();
      return;
    }
    exchange.upstreamRequest = upstreamRequest;
    upstreamRequest.setTimeout(upstreamTimeoutMs, () => {
      if (exchange.terminalFailure || exchange.clientAborted || exchange.settled) return;
      exchange.terminalFailure = true;
      reportEvent('warning', 'gateway_timeout', 'upstream_idle_timeout', 504);
      if (exchange.responseStarted || clientResponse.headersSent) clientResponse.destroy();
      else writeHttpFailure(clientRequest, clientResponse, 504, 'Upstream timed out.\n');
      exchange.upstreamResponse?.destroy();
      upstreamRequest.destroy();
    });

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
    upstreamRequest.once('error', (error) => {
      if (
        exchange.terminalFailure
        || exchange.clientAborted
        || clientResponse.destroyed
        || clientResponse.writableEnded
      ) return;
      exchange.terminalFailure = true;
      reportEvent('error', 'gateway_upstream_failure', 'upstream_error', 502, error);
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
    clientRequest.once('end', () => {
      exchange.requestEnded = true;
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
      relayRequestBody(
        clientRequest,
        upstreamRequest,
        preparedRequestHeaders.trailerNames,
        maxRequestBodyBytes,
        () => {
          if (exchange.terminalFailure || exchange.settled) return;
          exchange.terminalFailure = true;
          reportEvent(
            'warning',
            'gateway_request_rejected',
            'request_body_too_large',
            413,
            undefined,
            'stream_limit',
          );
          writeHttpFailure(
            clientRequest,
            clientResponse,
            413,
            'Request body is too large.\n',
          );
          exchange.upstreamResponse?.destroy();
          upstreamRequest.destroy();
        },
      );
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
      rejectRaw(clientSocket, 400, 'Invalid WebSocket method.\n', 'invalid_websocket_method');
      return;
    }
    const target = resolveRequestTarget(request.url);
    if (target.kind === 'blocked') {
      rejectRaw(clientSocket, 404, 'Not found.\n', 'blocked_target');
      return;
    }
    if (target.kind !== 'proxy') {
      rejectRaw(clientSocket, 400, 'Invalid request target.\n', 'invalid_target');
      return;
    }
    if (target.target === HEALTH_PATH) {
      rejectRaw(clientSocket, 404, 'Not found.\n', 'health_upgrade_not_allowed');
      return;
    }
    const admission = currentAdmissionDecision();
    if (!admission.allowed) {
      rejectRaw(
        clientSocket,
        admission.statusCode,
        admission.body,
        admission.reason,
        admission.retryAfterSeconds,
      );
      return;
    }
    const upgrade = String(request.headers.upgrade ?? '').trim().toLowerCase();
    if (upgrade !== 'websocket' || !connectionNominations(request.rawHeaders).has('upgrade')) {
      rejectRaw(clientSocket, 400, 'Unsupported protocol upgrade.\n', 'unsupported_upgrade');
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
      rejectRaw(clientSocket, 400, 'Invalid Host authority.\n', 'invalid_authority');
      return;
    }
    let peerSocket;
    let responseStarted = false;
    let terminalFailure = false;
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
    } catch (error) {
      reportEvent('error', 'gateway_upstream_failure', 'upstream_error', 502, error);
      writeRawFailure(clientSocket, 502, 'Upstream unavailable.\n');
      return;
    }

    upstreamRequest.setTimeout(upstreamTimeoutMs, () => {
      if (terminalFailure || responseStarted || clientSocket.destroyed) return;
      terminalFailure = true;
      reportEvent('warning', 'gateway_timeout', 'upstream_idle_timeout', 504);
      writeRawFailure(clientSocket, 504, 'Upstream timed out.\n');
      upstreamRequest.destroy();
    });

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
    upstreamRequest.once('error', (error) => {
      if (terminalFailure) return;
      terminalFailure = true;
      reportEvent('error', 'gateway_upstream_failure', 'upstream_error', 502, error);
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
  server.maxConnections = maxConnections;
  server.headersTimeout = headersTimeoutMs;
  server.requestTimeout = requestTimeoutMs;
  server.connectionsCheckingInterval = Math.min(1_000, headersTimeoutMs, requestTimeoutMs);
  server.timeout = idleTimeoutMs;
  server.keepAliveTimeout = keepAliveTimeoutMs;
  server.on('connection', (socket) => trackSocket(inboundSockets, socket));
  server.on('drop', () => {
    reportEvent('warning', 'gateway_connection_dropped', 'connection_limit', 503);
  });
  server.on('timeout', (socket) => {
    const socketExchanges = [...activeNormal]
      .filter((exchange) => exchange.clientSocket === socket);
    if (socketExchanges.length > 0 && socketExchanges.every((exchange) => exchange.requestEnded)) {
      return;
    }
    reportEvent('warning', 'gateway_timeout', 'socket_idle_timeout', 408);
    socket.destroy();
  });
  server.on('request', (request, response) => proxyHttp(request, response, false));
  server.on('checkContinue', (request, response) => proxyHttp(request, response, true));
  server.on('upgrade', proxyUpgrade);
  server.on('connect', (_request, socket) => {
    trackSocket(upgradedSockets, socket);
    rejectRaw(socket, 405, 'CONNECT is not allowed.\n', 'connect_not_allowed');
  });
  server.on('clientError', (error, socket) => {
    if (sanitizedErrorCode(error) === 'ERR_HTTP_REQUEST_TIMEOUT') {
      reportEvent('warning', 'gateway_timeout', 'request_deadline', 408, error);
      writeRawFailure(socket, 408, 'Request timed out.\n');
    } else if (blockedTargetFromClientError(error)) {
      reportEvent('warning', 'gateway_request_rejected', 'blocked_target', 404, error);
      writeRawFailure(socket, 404, 'Not found.\n');
    } else {
      reportEvent('warning', 'gateway_request_rejected', 'client_parse_error', 400, error);
      writeRawFailure(socket, 400, 'Invalid HTTP request.\n');
    }
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
      eventReporter.flush();
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
    maxConnections,
    maxRequestBodyBytes,
    headersTimeoutMs,
    requestTimeoutMs,
    idleTimeoutMs,
    keepAliveTimeoutMs,
    upstreamTimeoutMs,
    trustedProxyCidrs: trustedProxyMatcher.cidrs,
    stopAdmission,
    stop,
  });
}
