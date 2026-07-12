import type { Env } from '../types.js';

function coordinator(env: Env, key: string): DurableObjectStub {
  return env.AUTH.get(env.AUTH.idFromName(`edgebase-oauth-state-v1:${key}`));
}

/** Store short-lived OAuth authority in a strongly consistent Durable Object. */
export async function putOAuthTransient(
  env: Env,
  key: string,
  value: string,
  expirationTtl: number,
): Promise<void> {
  const response = await coordinator(env, key).fetch('https://oauth-state.internal/internal/oauth-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, expiresAt: Date.now() + expirationTtl * 1000 }),
  });
  if (!response.ok) throw new Error(`OAuth state coordinator write failed: ${response.status}`);
  // New authority is DO-only. Mirroring a live value into KV would let an old
  // worker consume KV while a new worker independently consumes the DO during
  // a gradual deployment. KV is read only for legacy states created before the
  // coordinator existed.
}

/** Atomically get-and-delete one OAuth authority. */
export async function consumeOAuthTransient(env: Env, key: string): Promise<string | null> {
  const response = await coordinator(env, key).fetch('https://oauth-state.internal/internal/oauth-state', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!response.ok) throw new Error(`OAuth state coordinator consume failed: ${response.status}`);
  const payload = await response.json() as { value?: unknown; coordinated?: unknown };
  let value = typeof payload.value === 'string' ? payload.value : null;
  // Accept states created by the immediately previous release once. Those
  // entries exist only in KV; all newly written entries set coordinated=true.
  if (!value && payload.coordinated === false) {
    const legacyValue = await env.KV.get(key);
    if (legacyValue) {
      const claim = await coordinator(env, key).fetch(
        'https://oauth-state.internal/internal/oauth-state-legacy-claim',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, expiresAt: Date.now() + 300_000 }),
        },
      );
      if (!claim.ok) throw new Error(`OAuth legacy state claim failed: ${claim.status}`);
      const claimed = await claim.json() as { claimed?: unknown };
      if (claimed.claimed === true) value = legacyValue;
    }
  }
  await env.KV.delete(key).catch(() => undefined);
  return value;
}

export type OAuthCompletionClaim =
  | { status: 'claimed'; value: string; claimId: string }
  | { status: 'completed'; value: string }
  | { status: 'in-progress' }
  | { status: 'missing' };

/** Claim a completion ticket without deleting it so retries can recover results. */
export async function claimOAuthCompletion(
  env: Env,
  key: string,
  claimId: string,
  leaseMs = 30_000,
): Promise<OAuthCompletionClaim> {
  const response = await coordinator(env, key).fetch(
    'https://oauth-state.internal/internal/oauth-completion/claim',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, claimId, leaseMs }),
    },
  );
  if (!response.ok) throw new Error(`OAuth completion claim failed: ${response.status}`);
  const payload = await response.json() as { status?: unknown; value?: unknown };
  if (payload.status === 'claimed' && typeof payload.value === 'string') {
    return { status: 'claimed', value: payload.value, claimId };
  }
  if (payload.status === 'completed' && typeof payload.value === 'string') {
    return { status: 'completed', value: payload.value };
  }
  if (payload.status === 'in-progress') return { status: 'in-progress' };
  return { status: 'missing' };
}

/** Persist the exact completion result before exposing it to the caller. */
export async function completeOAuthCompletion(
  env: Env,
  key: string,
  claimId: string,
  value: string,
  expirationTtl: number,
): Promise<void> {
  const response = await coordinator(env, key).fetch(
    'https://oauth-state.internal/internal/oauth-completion/complete',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        claimId,
        value,
        expiresAt: Date.now() + expirationTtl * 1000,
      }),
    },
  );
  if (!response.ok) throw new Error(`OAuth completion result write failed: ${response.status}`);
}

/** Extend an exact active claim; false means another claimant owns it. */
export async function renewOAuthCompletion(
  env: Env,
  key: string,
  claimId: string,
  leaseMs = 30_000,
): Promise<boolean> {
  const response = await coordinator(env, key).fetch(
    'https://oauth-state.internal/internal/oauth-completion/renew',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, claimId, leaseMs }),
    },
  );
  if (!response.ok) throw new Error(`OAuth completion claim renewal failed: ${response.status}`);
  const payload = await response.json() as { renewed?: unknown };
  return payload.renewed === true;
}

/** Persist an exact claimed workflow checkpoint without completing the ticket. */
export async function checkpointOAuthCompletion(
  env: Env,
  key: string,
  claimId: string,
  value: string,
): Promise<void> {
  const response = await coordinator(env, key).fetch(
    'https://oauth-state.internal/internal/oauth-completion/checkpoint',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, claimId, value }),
    },
  );
  if (!response.ok) throw new Error(`OAuth completion checkpoint failed: ${response.status}`);
}

/** Release a failed claim so a later retry can safely resume the same ticket. */
export async function releaseOAuthCompletion(
  env: Env,
  key: string,
  claimId: string,
): Promise<void> {
  const response = await coordinator(env, key).fetch(
    'https://oauth-state.internal/internal/oauth-completion/release',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, claimId }),
    },
  );
  if (!response.ok) throw new Error(`OAuth completion claim release failed: ${response.status}`);
}
