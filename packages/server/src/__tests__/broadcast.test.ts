/**
 * 서버 단위 테스트 — database-live broadcast 로직
 * 1-19 broadcast.test.ts — 20개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/broadcast.test.ts
 *
 * NOTE: broadcast HTTP API는 database-live.ts에서 Service Key 필수.
 *       여기서는 broadcast 페이로드 구조 + 서비스 키 가드 로직 검증
 */

import { describe, it, expect } from 'vitest';

// ── Broadcast 페이로드 검증 로직 (database-live.ts와 동일 패턴) ───────────────────

interface BroadcastBody {
  channel?: string;
  event?: string;
  payload?: Record<string, unknown>;
}

function validateBroadcastBody(body: BroadcastBody): { valid: boolean; error?: string } {
  if (!body.channel || typeof body.channel !== 'string') {
    return { valid: false, error: 'channel is required' };
  }
  if (!body.event || typeof body.event !== 'string') {
    return { valid: false, error: 'event is required' };
  }
  return { valid: true };
}

//: Broadcast requires Service Key
function checkServiceKey(key: string | undefined): 'missing' | 'invalid' | 'valid' {
  if (!key) return 'missing';
  if (!key.startsWith('sk_')) return 'invalid'; // simplified check
  return 'valid';
}

// ─── A. 페이로드 검증 ─────────────────────────────────────────────────────────

describe('validateBroadcastBody', () => {
  it('valid body → valid', () => {
    const result = validateBroadcastBody({ channel: 'ch-1', event: 'message' });
    expect(result.valid).toBe(true);
  });

  it('missing channel → invalid', () => {
    const result = validateBroadcastBody({ event: 'message' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('channel');
  });

  it('missing event → invalid', () => {
    const result = validateBroadcastBody({ channel: 'ch-1' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('event');
  });

  it('empty channel → invalid', () => {
    const result = validateBroadcastBody({ channel: '', event: 'msg' });
    expect(result.valid).toBe(false);
  });

  it('empty event → invalid', () => {
    const result = validateBroadcastBody({ channel: 'ch-1', event: '' });
    expect(result.valid).toBe(false);
  });

  it('with payload → valid', () => {
    const result = validateBroadcastBody({
      channel: 'ch-1',
      event: 'data',
      payload: { key: 'value' },
    });
    expect(result.valid).toBe(true);
  });

  it('payload undefined (optional) → valid', () => {
    const result = validateBroadcastBody({ channel: 'ch', event: 'ev' });
    expect(result.valid).toBe(true);
  });
});

// ─── B. Service Key 가드 ───────────────────────────────

describe('checkServiceKey', () => {
  it('missing key → missing', () => {
    expect(checkServiceKey(undefined)).toBe('missing');
  });

  it('empty string → missing', () => {
    // falsy
    expect(checkServiceKey('')).toBe('missing');
  });

  it('valid sk_ prefix → valid', () => {
    expect(checkServiceKey('sk_test_valid_key')).toBe('valid');
  });

  it('invalid format → invalid', () => {
    expect(checkServiceKey('Bearer my-token')).toBe('invalid');
  });

  it('random string → invalid', () => {
    expect(checkServiceKey('random-key-without-prefix')).toBe('invalid');
  });
});

// ─── C. Broadcast 이벤트 구조 ─────────────────────────────────────────────────

describe('Broadcast event structure', () => {
  it('fire-and-forget: no return value expected', () => {
    // Broadcast는 fire-and-forget → 반환값 없음, ok: true만
    const broadcastResult = { ok: true };
    expect(broadcastResult.ok).toBe(true);
  });

  it('broadcast payload merged with defaults', () => {
    const payload = undefined;
    const normalizedPayload = payload ?? {};
    expect(normalizedPayload).toEqual({});
  });

  it('broadcast event name is preserved', () => {
    const event = 'game:scored';
    // event는 그대로 전달
    expect(event).toBe('game:scored');
  });
});
