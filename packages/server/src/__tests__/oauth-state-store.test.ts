import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
}));

import { AuthDO } from '../durable-objects/auth-do.js';
import {
  claimOAuthCompletion,
  checkpointOAuthCompletion,
  completeOAuthCompletion,
  consumeOAuthTransient,
  putOAuthTransient,
  releaseOAuthCompletion,
  renewOAuthCompletion,
} from '../lib/oauth-state-store.js';
import type { Env } from '../types.js';

class FakeDurableObjectStorage {
  readonly records = new Map<string, unknown>();
  alarm: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.records.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.records.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.records.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? '';
    return new Map(
      [...this.records.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key, value as T]),
    );
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async setAlarm(value: number): Promise<void> {
    this.alarm = value;
  }
}

function coordinatorFixture(): {
  env: Env;
  storage: FakeDurableObjectStorage;
  alarm: () => Promise<void>;
} {
  const storage = new FakeDurableObjectStorage();
  const instance = { ctx: { storage } } as unknown as AuthDO;
  const stub = {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => AuthDO.prototype.fetch.call(
      instance,
      new Request(input, init),
    ),
  };
  const env = {
    AUTH: {
      idFromName: (name: string) => name,
      get: () => stub,
    },
    KV: {
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Env;
  return {
    env,
    storage,
    alarm: () => AuthDO.prototype.alarm.call(instance),
  };
}

describe('OAuth durable completion coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('atomically consumes transient state once', async () => {
    const { env } = coordinatorFixture();
    await putOAuthTransient(env, 'state-key', 'state-value', 300);

    await expect(consumeOAuthTransient(env, 'state-key')).resolves.toBe('state-value');
    await expect(consumeOAuthTransient(env, 'state-key')).resolves.toBeNull();
    expect(env.KV.delete).toHaveBeenCalledTimes(2);
  });

  it('extends near-expiry authority through a claim, alarm, checkpoint, and cached completion', async () => {
    const { env, storage, alarm } = coordinatorFixture();
    await putOAuthTransient(env, 'completion-key', 'initial', 1);
    const claimed = await claimOAuthCompletion(env, 'completion-key', 'claim-a', 30_000);
    expect(claimed).toEqual({ status: 'claimed', value: 'initial', claimId: 'claim-a' });
    await checkpointOAuthCompletion(env, 'completion-key', 'claim-a', 'checkpointed');
    await expect(renewOAuthCompletion(env, 'completion-key', 'claim-a', 30_000)).resolves.toBe(true);

    vi.advanceTimersByTime(2_000);
    await alarm();
    expect(storage.records.has('oauth:completion-key')).toBe(true);

    await completeOAuthCompletion(env, 'completion-key', 'claim-a', 'exact-result', 300);
    await expect(claimOAuthCompletion(env, 'completion-key', 'claim-b'))
      .resolves.toEqual({ status: 'completed', value: 'exact-result' });
  });

  it('rejects a stolen old claim after its lease expires and a new claimant takes ownership', async () => {
    const { env } = coordinatorFixture();
    await putOAuthTransient(env, 'stolen-key', 'pending', 300);
    await expect(claimOAuthCompletion(env, 'stolen-key', 'claim-a', 1_000))
      .resolves.toMatchObject({ status: 'claimed' });
    await expect(claimOAuthCompletion(env, 'stolen-key', 'claim-b', 1_000))
      .resolves.toEqual({ status: 'in-progress' });

    vi.advanceTimersByTime(1_001);
    await expect(claimOAuthCompletion(env, 'stolen-key', 'claim-b', 1_000))
      .resolves.toMatchObject({ status: 'claimed', claimId: 'claim-b' });
    await expect(renewOAuthCompletion(env, 'stolen-key', 'claim-a', 1_000)).resolves.toBe(false);
    await expect(completeOAuthCompletion(env, 'stolen-key', 'claim-a', 'stale', 300))
      .rejects.toThrow(/409/);

    await releaseOAuthCompletion(env, 'stolen-key', 'claim-a');
    await completeOAuthCompletion(env, 'stolen-key', 'claim-b', 'winner', 300);
    await expect(claimOAuthCompletion(env, 'stolen-key', 'claim-c'))
      .resolves.toEqual({ status: 'completed', value: 'winner' });
  });
});
