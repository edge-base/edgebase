import {
  MAX_SELF_HOST_SCHEDULE_ENVELOPES_PER_REQUEST,
  MAX_SELF_HOST_SCHEDULE_REQUEST_BYTES,
  MAX_SELF_HOST_SCHEDULE_RESPONSE_BYTES,
  MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST,
  SELF_HOST_SCHEDULE_PROTOCOL_VERSION,
  assertManagedCronWireBound,
  assertManagedScheduleTargetIdWireBound,
  normalizeCronExpression,
  utf8ByteLength,
  type SelfHostScheduleControlRequest,
  type SelfHostScheduleRequestEnvelope,
  type SelfHostScheduleRequestTarget,
  type SelfHostScheduleWireOutcome,
} from '@edge-base/shared';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import type { Env } from '../types.js';
import {
  executeManagedScheduledEnvelopes,
  type ManagedScheduledRuntimeEnvelope,
} from '../lib/managed-scheduled-runtime.js';

export const SELF_HOST_CONTROL_ROOT = '/__edgebase/internal/self-host';
export const MAX_SELF_HOST_CONTROL_BODY_BYTES = MAX_SELF_HOST_SCHEDULE_REQUEST_BYTES;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CONTROL_SECRET_PATTERN = /^[a-f0-9]{64}$/;

interface RuntimeAuthority {
  generation: `sha256:${string}`;
  scheduleDigest: `sha256:${string}`;
}

function authorized(c: {
  env: Env;
  req: { header(name: string): string | undefined };
}): boolean {
  if (c.env.EDGEBASE_RUNTIME_MODE !== 'self-hosted') return false;
  const expected = c.env.EDGEBASE_SELF_HOST_CONTROL_SECRET;
  if (typeof expected !== 'string' || !CONTROL_SECRET_PATTERN.test(expected)) return false;
  const supplied = c.req.header('x-edgebase-self-host-control');
  return supplied === expected;
}

function runtimeAuthority(env: Env): RuntimeAuthority | null {
  const generation = env.EDGEBASE_SELF_HOST_APP_GENERATION;
  const scheduleDigest = env.EDGEBASE_SELF_HOST_SCHEDULE_DIGEST;
  if (
    typeof generation !== 'string'
    || !SHA256_PATTERN.test(generation)
    || typeof scheduleDigest !== 'string'
    || !SHA256_PATTERN.test(scheduleDigest)
  ) {
    return null;
  }
  return {
    generation: generation as `sha256:${string}`,
    scheduleDigest: scheduleDigest as `sha256:${string}`,
  };
}

function unavailable(c: { json(body: unknown, status: 404): Response }): Response {
  return c.json({ code: 404, message: 'Not found.' }, 404);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function readSha256(value: unknown, context: string): `sha256:${string}` {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${context} must be a lowercase SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function parseTarget(value: unknown, context: string): SelfHostScheduleRequestTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ['id', 'mode'])) throw new Error(`${context} has an invalid shape.`);
  if (typeof record.id !== 'string') throw new Error(`${context}.id must be a string.`);
  assertManagedScheduleTargetIdWireBound(record.id, `${context}.id`);
  if (record.mode !== 'execute' && record.mode !== 'reconcile') {
    throw new Error(`${context}.mode must be execute or reconcile.`);
  }
  return { id: record.id, mode: record.mode };
}

function parseEnvelope(value: unknown, index: number): SelfHostScheduleRequestEnvelope {
  const context = `envelopes[${index}]`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ['cron', 'scheduledTime', 'targets'])) {
    throw new Error(`${context} has an invalid shape.`);
  }
  if (typeof record.cron !== 'string') throw new Error(`${context}.cron must be a string.`);
  assertManagedCronWireBound(record.cron, `${context}.cron`);
  const cron = normalizeCronExpression(record.cron);
  if (cron !== record.cron) throw new Error(`${context}.cron must already be normalized.`);
  if (!Number.isSafeInteger(record.scheduledTime) || (record.scheduledTime as number) < 0) {
    throw new Error(`${context}.scheduledTime must be a non-negative safe integer.`);
  }
  if (!Array.isArray(record.targets) || record.targets.length === 0) {
    throw new Error(`${context}.targets must be a non-empty array.`);
  }
  const targets = record.targets.map((target, targetIndex) => (
    parseTarget(target, `${context}.targets[${targetIndex}]`)
  ));
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.id)) throw new Error(`${context} repeats target '${target.id}'.`);
    seen.add(target.id);
  }
  return { cron, scheduledTime: record.scheduledTime as number, targets };
}

function parseControlRequest(source: string): SelfHostScheduleControlRequest {
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Control request must be an object.');
  }
  const record = parsed as Record<string, unknown>;
  if (
    !exactKeys(record, ['schemaVersion', 'generation', 'scheduleDigest', 'envelopes'])
    || record.schemaVersion !== SELF_HOST_SCHEDULE_PROTOCOL_VERSION
  ) {
    throw new Error(
      `Control request schemaVersion must be ${SELF_HOST_SCHEDULE_PROTOCOL_VERSION} with exact authority and envelopes.`,
    );
  }
  if (
    !Array.isArray(record.envelopes)
    || record.envelopes.length === 0
    || record.envelopes.length > MAX_SELF_HOST_SCHEDULE_ENVELOPES_PER_REQUEST
  ) {
    throw new Error(
      `Control request envelopes must contain 1-${MAX_SELF_HOST_SCHEDULE_ENVELOPES_PER_REQUEST} items.`,
    );
  }
  const envelopes = record.envelopes.map(parseEnvelope);
  const targetCount = envelopes.reduce((count, envelope) => count + envelope.targets.length, 0);
  if (targetCount > MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST) {
    throw new Error(
      `Control request contains more than ${MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST} targets.`,
    );
  }
  const seen = new Set<string>();
  for (const envelope of envelopes) {
    for (const target of envelope.targets) {
      const key = JSON.stringify([envelope.cron, envelope.scheduledTime, target.id]);
      if (seen.has(key)) throw new Error(`Control request repeats target delivery ${key}.`);
      seen.add(key);
    }
  }
  return {
    schemaVersion: SELF_HOST_SCHEDULE_PROTOCOL_VERSION,
    generation: readSha256(record.generation, 'Control request generation'),
    scheduleDigest: readSha256(record.scheduleDigest, 'Control request scheduleDigest'),
    envelopes,
  };
}

function orderExactOutcomes(
  request: SelfHostScheduleControlRequest,
  outcomes: SelfHostScheduleWireOutcome[],
): SelfHostScheduleWireOutcome[] {
  const byKey = new Map<string, SelfHostScheduleWireOutcome>();
  for (const outcome of outcomes) {
    const key = JSON.stringify([outcome.cron, outcome.scheduledTime, outcome.itemId]);
    if (byKey.has(key)) throw new Error(`Runtime duplicated schedule outcome ${key}.`);
    byKey.set(key, outcome);
  }
  const ordered: SelfHostScheduleWireOutcome[] = [];
  for (const envelope of request.envelopes) {
    for (const target of envelope.targets) {
      const key = JSON.stringify([envelope.cron, envelope.scheduledTime, target.id]);
      const outcome = byKey.get(key);
      if (!outcome) throw new Error(`Runtime omitted schedule outcome ${key}.`);
      ordered.push(outcome);
      byKey.delete(key);
    }
  }
  if (byKey.size > 0) {
    throw new Error(`Runtime returned unknown schedule outcomes: ${[...byKey.keys()].join(', ')}.`);
  }
  return ordered;
}

export const selfHostControlRoute = new OpenAPIHono<HonoEnv>();

selfHostControlRoute.get('/ready', (c) => {
  if (!authorized(c as never)) return unavailable(c as never);
  const authority = runtimeAuthority(c.env as Env);
  if (!authority) {
    return c.json({ outcome: 'blocked', message: 'Self-host runtime authority is unavailable.' }, 503);
  }
  return c.json({
    outcome: 'ok',
    runtime: 'edgebase-self-host',
    ...authority,
  });
});

selfHostControlRoute.post('/schedules', async (c) => {
  if (!authorized(c as never)) return unavailable(c as never);
  const authority = runtimeAuthority(c.env as Env);
  if (!authority) {
    return c.json({ outcome: 'blocked', message: 'Self-host runtime authority is unavailable.' }, 503);
  }
  const declaredLength = c.req.header('content-length');
  if (declaredLength !== undefined) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_SELF_HOST_CONTROL_BODY_BYTES) {
      return c.json({ outcome: 'invalid', message: 'Control request body is too large.' }, 413);
    }
  }
  const source = await c.req.text();
  if (utf8ByteLength(source) > MAX_SELF_HOST_CONTROL_BODY_BYTES) {
    return c.json({ outcome: 'invalid', message: 'Control request body is too large.' }, 413);
  }

  let request: SelfHostScheduleControlRequest;
  try {
    request = parseControlRequest(source);
  } catch (error) {
    return c.json({
      outcome: 'invalid',
      message: error instanceof Error ? error.message : String(error),
    }, 400);
  }
  if (
    request.generation !== authority.generation
    || request.scheduleDigest !== authority.scheduleDigest
  ) {
    return c.json({
      outcome: 'stale',
      ...authority,
      message: 'Requested self-host manifest authority is not active.',
    }, 409);
  }

  try {
    const envelopes: ManagedScheduledRuntimeEnvelope[] = request.envelopes;
    const report = await executeManagedScheduledEnvelopes(
      envelopes,
      c.env as Env,
      c.executionCtx,
    );
    const outcomes = orderExactOutcomes(
      request,
      report.outcomes as SelfHostScheduleWireOutcome[],
    );
    const payload = {
      schemaVersion: SELF_HOST_SCHEDULE_PROTOCOL_VERSION,
      outcome: report.complete ? 'ok' : 'incomplete',
      complete: report.complete,
      ...authority,
      outcomes,
    };
    const encoded = JSON.stringify(payload);
    if (utf8ByteLength(encoded) > MAX_SELF_HOST_SCHEDULE_RESPONSE_BYTES) {
      throw new Error('Bounded schedule outcome exceeded the protocol response limit.');
    }
    return new Response(encoded, {
      status: report.complete ? 200 : 409,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
    });
  } catch (error) {
    console.error('[EdgeBase] Self-host schedule control failed', error);
    return c.json({
      outcome: 'blocked',
      message: 'Self-host schedule control could not produce a complete bounded result.',
    }, 503);
  }
});
