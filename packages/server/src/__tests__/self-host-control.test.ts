import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SELF_HOST_SCHEDULE_REQUEST_BYTES,
  MAX_SELF_HOST_SCHEDULE_RESPONSE_BYTES,
  utf8ByteLength,
  type SelfHostScheduleControlRequest,
  type SelfHostScheduleRequestEnvelope,
  type SelfHostScheduleRequestTarget,
  type SelfHostScheduleWireOutcome,
} from '@edge-base/shared';

const { executeManagedScheduledEnvelopesMock } = vi.hoisted(() => ({
  executeManagedScheduledEnvelopesMock: vi.fn(),
}));

vi.mock('../lib/managed-scheduled-runtime.js', () => ({
  executeManagedScheduledEnvelopes: executeManagedScheduledEnvelopesMock,
}));

import { selfHostControlRoute } from '../routes/self-host-control.js';

const CONTROL_SECRET = 'b'.repeat(64);
const GENERATION: `sha256:${string}` = `sha256:${'1'.repeat(64)}`;
const SCHEDULE_DIGEST: `sha256:${string}` = `sha256:${'2'.repeat(64)}`;
const ENV = {
  EDGEBASE_RUNTIME_MODE: 'self-hosted',
  EDGEBASE_SELF_HOST_CONTROL_SECRET: CONTROL_SECRET,
  EDGEBASE_SELF_HOST_APP_GENERATION: GENERATION,
  EDGEBASE_SELF_HOST_SCHEDULE_DIGEST: SCHEDULE_DIGEST,
} as const;
const EXECUTION_CONTEXT = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};

function controlRequest(path: string, init: RequestInit = {}, env: Record<string, unknown> = ENV) {
  return selfHostControlRoute.fetch(
    new Request(`http://internal${path}`, init),
    env as never,
    EXECUTION_CONTEXT as never,
  );
}

function target(id: string, mode: 'execute' | 'reconcile' = 'execute') {
  return { id: `app-function:${id}#default`, mode } as const;
}

function envelope(
  targets: SelfHostScheduleRequestTarget[] = [target('one')],
  scheduledTime = Date.parse('2026-07-16T12:30:00.000Z'),
): SelfHostScheduleRequestEnvelope {
  return { cron: '* * * * *', scheduledTime, targets };
}

function requestBody(envelopes: SelfHostScheduleRequestEnvelope[]): SelfHostScheduleControlRequest {
  return {
    schemaVersion: 2,
    generation: GENERATION,
    scheduleDigest: SCHEDULE_DIGEST,
    envelopes,
  };
}

function outcome(
  requestEnvelope: SelfHostScheduleRequestEnvelope,
  id: string,
  status: SelfHostScheduleWireOutcome['status'] = 'succeeded',
  error?: string,
): SelfHostScheduleWireOutcome {
  return {
    cron: requestEnvelope.cron,
    scheduledTime: requestEnvelope.scheduledTime,
    itemId: id,
    lane: 'app-function',
    status,
    attempt: 1,
    executed: status === 'succeeded' || status === 'failed' || status === 'timed_out',
    retryable: status !== 'succeeded' && status !== 'duplicate',
    ...(error === undefined ? {} : { error }),
  };
}

async function postSchedules(body: unknown, headers: Record<string, string> = {}) {
  return controlRequest('/schedules', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-edgebase-self-host-control': CONTROL_SECRET,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function postRawSchedules(source: string, headers: Record<string, string> = {}) {
  return controlRequest('/schedules', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-edgebase-self-host-control': CONTROL_SECRET,
      ...headers,
    },
    body: source,
  });
}

describe('self-host authenticated control plane', () => {
  beforeEach(() => {
    EXECUTION_CONTEXT.waitUntil.mockReset();
    EXECUTION_CONTEXT.passThroughOnException.mockReset();
    executeManagedScheduledEnvelopesMock.mockReset().mockResolvedValue({
      complete: true,
      outcomes: [],
    });
  });

  it('hides readiness unless runtime mode and secret match, then returns exact authority', async () => {
    for (const [headers, env] of [
      [{}, ENV],
      [{ 'x-edgebase-self-host-control': 'c'.repeat(64) }, ENV],
      [{ 'x-edgebase-self-host-control': CONTROL_SECRET }, {
        ...ENV,
        EDGEBASE_RUNTIME_MODE: 'hosted',
      }],
    ] as const) {
      const response = await controlRequest('/ready', { headers }, env);
      expect(response.status).toBe(404);
    }

    const response = await controlRequest('/ready', {
      headers: { 'x-edgebase-self-host-control': CONTROL_SECRET },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcome: 'ok',
      runtime: 'edgebase-self-host',
      generation: GENERATION,
      scheduleDigest: SCHEDULE_DIGEST,
    });
  });

  it('blocks authenticated readiness when generation authority is incomplete', async () => {
    const response = await controlRequest('/ready', {
      headers: { 'x-edgebase-self-host-control': CONTROL_SECRET },
    }, {
      ...ENV,
      EDGEBASE_SELF_HOST_APP_GENERATION: '',
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ outcome: 'blocked' });
  });

  it('executes exact target ids and modes, and returns one-to-one outcomes in request order', async () => {
    const first = envelope([target('one'), target('two', 'reconcile')]);
    const second = envelope([target('three')], first.scheduledTime + 60_000);
    executeManagedScheduledEnvelopesMock.mockResolvedValue({
      complete: false,
      outcomes: [
        outcome(second, target('three').id, 'succeeded'),
        outcome(first, target('two').id, 'timed_out'),
        outcome(first, target('one').id, 'duplicate'),
      ],
    });

    const response = await postSchedules(requestBody([first, second]));

    expect(executeManagedScheduledEnvelopesMock).toHaveBeenCalledWith(
      [first, second],
      ENV,
      EXECUTION_CONTEXT,
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 2,
      outcome: 'incomplete',
      complete: false,
      generation: GENERATION,
      scheduleDigest: SCHEDULE_DIGEST,
      outcomes: [
        outcome(first, target('one').id, 'duplicate'),
        outcome(first, target('two').id, 'timed_out'),
        outcome(second, target('three').id, 'succeeded'),
      ],
    });
  });

  it('rejects stale generation or schedule digest without executing', async () => {
    for (const authority of [
      { generation: `sha256:${'3'.repeat(64)}`, scheduleDigest: SCHEDULE_DIGEST },
      { generation: GENERATION, scheduleDigest: `sha256:${'4'.repeat(64)}` },
    ]) {
      const response = await postSchedules({
        ...requestBody([envelope()]),
        ...authority,
      });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        outcome: 'stale',
        generation: GENERATION,
        scheduleDigest: SCHEDULE_DIGEST,
        message: 'Requested self-host manifest authority is not active.',
      });
    }
    expect(executeManagedScheduledEnvelopesMock).not.toHaveBeenCalled();
  });

  it('accepts 1 and 64 targets but rejects 65 targets and 65 envelopes', async () => {
    for (const count of [1, 64]) {
      const current = envelope(Array.from({ length: count }, (_, index) => target(`t-${index}`)));
      executeManagedScheduledEnvelopesMock.mockResolvedValueOnce({
        complete: true,
        outcomes: current.targets.map(({ id }) => outcome(current, id)),
      });
      const response = await postSchedules(requestBody([current]));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ complete: true });
    }

    for (const invalid of [
      requestBody([envelope(Array.from({ length: 65 }, (_, index) => target(`t-${index}`)))]),
      requestBody(Array.from({ length: 65 }, (_, index) => (
        envelope([target(`e-${index}`)], Date.parse('2026-07-16T12:30:00.000Z') + index * 60_000)
      ))),
    ]) {
      const response = await postSchedules(invalid);
      expect(response.status).toBe(400);
    }
    expect(executeManagedScheduledEnvelopesMock).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate deliveries and non-exact target or envelope shapes before execution', async () => {
    const duplicated = envelope([target('same'), target('same')]);
    const malformed = [
      requestBody([duplicated]),
      {
        ...requestBody([envelope()]),
        unexpected: true,
      },
      requestBody([{
        ...envelope(),
        unexpected: true,
      } as SelfHostScheduleRequestEnvelope]),
      requestBody([envelope([{
        ...target('one'),
        unexpected: true,
      } as never])]),
    ];
    for (const body of malformed) {
      const response = await postSchedules(body);
      expect(response.status).toBe(400);
    }
    expect(executeManagedScheduledEnvelopesMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', (items: SelfHostScheduleWireOutcome[]) => items.slice(0, 1)],
    ['duplicate', (items: SelfHostScheduleWireOutcome[]) => [items[0]!, items[0]!]],
    ['extra', (items: SelfHostScheduleWireOutcome[], current: SelfHostScheduleRequestEnvelope) => [
      ...items,
      outcome(current, target('unknown').id),
    ]],
  ])('blocks a runtime that returns %s outcomes', async (_name, mutate) => {
    const current = envelope([target('one'), target('two')]);
    const items = current.targets.map(({ id }) => outcome(current, id));
    executeManagedScheduledEnvelopesMock.mockResolvedValue({
      complete: true,
      outcomes: mutate(items, current),
    });
    const response = await postSchedules(requestBody([current]));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ outcome: 'blocked' });
  });

  it('enforces bounded request and response bytes', async () => {
    const tooLarge = await postSchedules(requestBody([envelope()]), {
      'content-length': String(128 * 1024 + 1),
    });
    expect(tooLarge.status).toBe(413);
    expect(executeManagedScheduledEnvelopesMock).not.toHaveBeenCalled();

    const current = envelope();
    executeManagedScheduledEnvelopesMock.mockResolvedValue({
      complete: true,
      outcomes: [outcome(current, target('one').id, 'failed', 'x'.repeat(
        MAX_SELF_HOST_SCHEDULE_RESPONSE_BYTES,
      ))],
    });
    const response = await postSchedules(requestBody([current]));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ outcome: 'blocked' });
  });

  it('accepts request bodies at the exact byte cap and rejects one byte over', async () => {
    const current = envelope();
    const body = JSON.stringify(requestBody([current]));
    executeManagedScheduledEnvelopesMock.mockResolvedValue({
      complete: true,
      outcomes: [outcome(current, target('one').id)],
    });

    for (const expectedBytes of [MAX_SELF_HOST_SCHEDULE_REQUEST_BYTES - 1, MAX_SELF_HOST_SCHEDULE_REQUEST_BYTES]) {
      const source = `${body}${' '.repeat(expectedBytes - utf8ByteLength(body))}`;
      expect(utf8ByteLength(source)).toBe(expectedBytes);
      const response = await postRawSchedules(source, {
        'content-length': String(expectedBytes),
      });
      expect(response.status).toBe(200);
    }

    const over = `${body}${' '.repeat(MAX_SELF_HOST_SCHEDULE_REQUEST_BYTES + 1 - utf8ByteLength(body))}`;
    const response = await postRawSchedules(over);
    expect(response.status).toBe(413);
    expect(executeManagedScheduledEnvelopesMock).toHaveBeenCalledTimes(2);
  });

  it('accepts an exact UTF-8 target id and rejects one byte over before execution', async () => {
    const exactRoute = `${'가'.repeat(78)}a`;
    const exactId = `app-function:${exactRoute}#default`;
    expect(utf8ByteLength(exactId)).toBe(256);
    const current = envelope([{ id: exactId, mode: 'execute' }]);
    executeManagedScheduledEnvelopesMock.mockResolvedValue({
      complete: true,
      outcomes: [outcome(current, exactId)],
    });
    expect((await postSchedules(requestBody([current]))).status).toBe(200);

    const over = envelope([{ id: `${exactId}b`, mode: 'execute' }]);
    expect((await postSchedules(requestBody([over]))).status).toBe(400);
    expect(executeManagedScheduledEnvelopesMock).toHaveBeenCalledTimes(1);
  });
});
