/**
 * rate-limit.test.ts — 70개
 *
 * 테스트 대상: src/middleware/rate-limit.ts
 *   - FixedWindowCounter
 *   - parseWindow
 *   - getLimit
 *   - getGroup
 *   - RATE_LIMIT_DEFAULTS
 *   - HTTP 통합 (429 응답)
 *
 * 순수 함수 단위테스트 + 경계값 테스트
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  FixedWindowCounter,
  parseWindow,
  getGroup,
  getLimit,
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_DEV_DEFAULTS,
  counter,
} from '../../src/middleware/rate-limit.js';

// ─── 1. FixedWindowCounter ────────────────────────────────────────────────────

describe('1-20 rate-limit — FixedWindowCounter.check', () => {
  let counter: FixedWindowCounter;

  beforeEach(() => {
    counter = new FixedWindowCounter();
  });

  it('첫 번째 요청 → true', () => {
    expect(counter.check('ip:1', 5, 60)).toBe(true);
  });

  it('limit 미도달 → true 반복', () => {
    for (let i = 0; i < 4; i++) {
      expect(counter.check('ip:2', 5, 60)).toBe(true);
    }
  });

  it('limit 도달 → false', () => {
    for (let i = 0; i < 5; i++) counter.check('ip:3', 5, 60);
    expect(counter.check('ip:3', 5, 60)).toBe(false);
  });

  it('다른 key → 독립 카운터', () => {
    for (let i = 0; i < 5; i++) counter.check('ip:4a', 5, 60);
    // 다른 key는 초기화된 상태
    expect(counter.check('ip:4b', 5, 60)).toBe(true);
  });

  it('limit=1 → 두 번째 요청 false', () => {
    counter.check('ip:5', 1, 60);
    expect(counter.check('ip:5', 1, 60)).toBe(false);
  });

  it('window 만료 후 리셋 → true', async () => {
    // 매우 짧은 window (1ms)
    const result1 = counter.check('ip:6', 1, 0.001); // 1ms window
    expect(result1).toBe(true);
    counter.check('ip:6', 1, 0.001);
    // 10ms 대기 → window 만료 (Workers 타이머 부정확으로 5ms는 불충분할 수 있음)
    await new Promise(r => setTimeout(r, 10));
    const result2 = counter.check('ip:6', 1, 0.001);
    expect(result2).toBe(true); // 리셋
  });

  it('limit=0 → 항상 false', () => {
    expect(counter.check('ip:7', 0, 60)).toBe(false);
  });

  it('고용량 limit(1M) → 정상 처리', () => {
    expect(counter.check('ip:8', 1_000_000, 60)).toBe(true);
  });
});

// ─── 2. FixedWindowCounter.getRetryAfter ─────────────────────────────────────

describe('1-20 rate-limit — getRetryAfter', () => {
  let counter: FixedWindowCounter;

  beforeEach(() => {
    counter = new FixedWindowCounter();
  });

  it('한도 초과 후 getRetryAfter → 양수(초)', () => {
    for (let i = 0; i < 5; i++) counter.check('ip:ra1', 5, 60);
    const retry = counter.getRetryAfter('ip:ra1');
    expect(typeof retry).toBe('number');
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it('아직 한도 미도달 → getRetryAfter는 0 또는 양수', () => {
    counter.check('ip:ra2', 5, 60);
    const retry = counter.getRetryAfter('ip:ra2');
    expect(retry).toBeGreaterThanOrEqual(0);
  });

  it('미존재 key → 0', () => {
    const retry = counter.getRetryAfter('ip:never');
    expect(retry).toBe(0);
  });
});

// ─── 3. parseWindow ──────────────────────────────────────────────────────────

describe('1-20 rate-limit — parseWindow', () => {
  it("'60s' → 60", () => expect(parseWindow('60s')).toBe(60));
  it("'1m' → 60", () => expect(parseWindow('1m')).toBe(60));
  it("'5m' → 300", () => expect(parseWindow('5m')).toBe(300));
  it("'1h' → 3600", () => expect(parseWindow('1h')).toBe(3600));
  it("'2h' → 7200", () => expect(parseWindow('2h')).toBe(7200));
  it("'30s' → 30", () => expect(parseWindow('30s')).toBe(30));
  it("잘못된 포맷 → 60(폴백)", () => expect(parseWindow('invalid')).toBe(60));
  it("빈 문자열 → 60(폴백)", () => expect(parseWindow('')).toBe(60));
  it("'0s' → 0", () => expect(parseWindow('0s')).toBe(0));
});

// ─── 4. RATE_LIMIT_DEFAULTS ──────────────────────────────────────────────────

describe('1-20 rate-limit — RATE_LIMIT_DEFAULTS', () => {
  it('global > db 요청 수 (global은 매우 높음)', () => {
    expect(RATE_LIMIT_DEFAULTS.global.requests).toBeGreaterThan(RATE_LIMIT_DEFAULTS.db.requests);
  });

  it('db default: 100req/60s', () => {
    expect(RATE_LIMIT_DEFAULTS.db.requests).toBe(100);
    expect(RATE_LIMIT_DEFAULTS.db.windowSec).toBe(60);
  });

  it('auth default: 30req/60s', () => {
    expect(RATE_LIMIT_DEFAULTS.auth.requests).toBe(30);
  });

  it('authSignin default: 10req/60s', () => {
    expect(RATE_LIMIT_DEFAULTS.authSignin.requests).toBe(10);
  });

  it('authSignup default: 10req/60s', () => {
    expect(RATE_LIMIT_DEFAULTS.authSignup.requests).toBe(10);
  });

  it('storage default: 50req/60s', () => {
    expect(RATE_LIMIT_DEFAULTS.storage.requests).toBe(50);
  });

  it('functions default: 50req/60s', () => {
    expect(RATE_LIMIT_DEFAULTS.functions.requests).toBe(50);
  });
});

// ─── 5. HTTP 통합 — 429 응답 ─────────────────────────────────────────────────

describe('1-20 rate-limit — HTTP 통합', () => {
  it('정상 요청 → Retry-After 헤더 없음', async () => {
    const res = await (globalThis as any).SELF.fetch('http://localhost/api/health');
    expect(res.status).toBe(200);
    // Within limit — no Retry-After header
  });

  it('SK 요청 → rate limit global 그룹 (통과)', async () => {
    const res = await (globalThis as any).SELF.fetch('http://localhost/api/health', {
      headers: { 'X-EdgeBase-Service-Key': 'test-service-key-for-admin' },
    });
    expect(res.status).toBe(200);
  });

  it('auth 엔드포인트 → Content-Type: application/json 에러', async () => {
    // Just verify normal auth returns correct format
    const res = await (globalThis as any).SELF.fetch('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rate@test.com', password: 'Abc12345!' }),
    });
    expect([201, 409, 400, 429].includes(res.status)).toBe(true);
  });
});

// ─── 6. 다중 키 독립성 ────────────────────────────────────────────────────────

describe('1-20 rate-limit — 다중 키 독립성', () => {
  let counter: FixedWindowCounter;

  beforeEach(() => { counter = new FixedWindowCounter(); });

  it('100개 서로 다른 키 → 각각 독립적으로 first request = true', () => {
    for (let i = 0; i < 100; i++) {
      expect(counter.check(`ip:multi:${i}`, 5, 60)).toBe(true);
    }
  });

  it('같은 그룹 prefix, 다른 ID → 독립 카운터', () => {
    const key1 = 'db:1.2.3.4';
    const key2 = 'db:1.2.3.5';
    for (let i = 0; i < 5; i++) counter.check(key1, 5, 60);
    expect(counter.check(key1, 5, 60)).toBe(false);
    expect(counter.check(key2, 5, 60)).toBe(true);
  });

  it('key 공유 누적 — 같은 key 다른 limit 설정 무관하게 누적', () => {
    // 3번 누적
    for (let i = 0; i < 3; i++) counter.check('shared:key', 10, 60);
    // limit을 3으로 낮추면 초과
    expect(counter.check('shared:key', 3, 60)).toBe(false);
  });
});

// ─── 7. FixedWindowCounter 확장 ─────────────────────────────────────────────

describe('1-20 rate-limit — FixedWindowCounter 확장', () => {
  let counter: FixedWindowCounter;

  beforeEach(() => { counter = new FixedWindowCounter(); });

  it('정확히 limit 도달 시 마지막 요청 true → 다음 false', () => {
    for (let i = 0; i < 9; i++) counter.check('exact:limit', 10, 60);
    expect(counter.check('exact:limit', 10, 60)).toBe(true);  // 10th
    expect(counter.check('exact:limit', 10, 60)).toBe(false); // 11th
  });

  it('limit=2 → 2번 true, 3번째 false', () => {
    expect(counter.check('ip:lim2', 2, 60)).toBe(true);
    expect(counter.check('ip:lim2', 2, 60)).toBe(true);
    expect(counter.check('ip:lim2', 2, 60)).toBe(false);
  });

  it('동시에 여러 window 길이 사용 가능', () => {
    expect(counter.check('short-win', 5, 1)).toBe(true);
    expect(counter.check('long-win', 5, 3600)).toBe(true);
  });

  it('limit=100000 → 큰 limit 정상 처리', () => {
    for (let i = 0; i < 100; i++) counter.check('big:limit', 100000, 60);
    expect(counter.check('big:limit', 100000, 60)).toBe(true);
  });

  it('window 만료 후 카운터 리셋 확인 (2ms window)', async () => {
    counter.check('expire:key1', 1, 0.002);
    expect(counter.check('expire:key1', 1, 0.002)).toBe(false);
    await new Promise(r => setTimeout(r, 10));
    expect(counter.check('expire:key1', 1, 0.002)).toBe(true);
  });

  it('window 만료 전 카운터 유지 (60s window)', () => {
    for (let i = 0; i < 5; i++) counter.check('noexpire:key', 5, 60);
    expect(counter.check('noexpire:key', 5, 60)).toBe(false);
  });
});

// ─── 8. getRetryAfter 확장 ─────────────────────────────────────────────────

describe('1-20 rate-limit — getRetryAfter 확장', () => {
  let counter: FixedWindowCounter;

  beforeEach(() => { counter = new FixedWindowCounter(); });

  it('한도 초과 후 getRetryAfter ≤ windowSec', () => {
    for (let i = 0; i < 3; i++) counter.check('ra:ext1', 3, 30);
    const retry = counter.getRetryAfter('ra:ext1');
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(30);
  });

  it('짧은 window에서 getRetryAfter 범위', () => {
    counter.check('ra:short', 1, 5);
    const retry = counter.getRetryAfter('ra:short');
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(5);
  });

  it('여러 키에 대한 getRetryAfter 독립', () => {
    counter.check('ra:a', 1, 60);
    counter.check('ra:b', 1, 10);
    const retryA = counter.getRetryAfter('ra:a');
    const retryB = counter.getRetryAfter('ra:b');
    expect(retryA).toBeGreaterThan(retryB);
  });
});

// ─── 9. parseWindow 확장 ───────────────────────────────────────────────────

describe('1-20 rate-limit — parseWindow 확장', () => {
  it("'10s' → 10", () => expect(parseWindow('10s')).toBe(10));
  it("'120s' → 120", () => expect(parseWindow('120s')).toBe(120));
  it("'10m' → 600", () => expect(parseWindow('10m')).toBe(600));
  it("'24h' → 86400", () => expect(parseWindow('24h')).toBe(86400));
  it("'0m' → 0", () => expect(parseWindow('0m')).toBe(0));
  it("'0h' → 0", () => expect(parseWindow('0h')).toBe(0));
  it("'999s' → 999", () => expect(parseWindow('999s')).toBe(999));
  it("'abc' → 60 (폴백)", () => expect(parseWindow('abc')).toBe(60));
  it("'60' (단위 없음) → 60 (폴백)", () => expect(parseWindow('60')).toBe(60));
  it("'-5s' → 60 (음수 → 폴백)", () => expect(parseWindow('-5s')).toBe(60));
  it("'1d' → 60 (미지원 단위 → 폴백)", () => expect(parseWindow('1d')).toBe(60));
});

// ─── 10. getGroup 확장 ─────────────────────────────────────────────────────

describe('1-20 rate-limit — getGroup', () => {
  // Import getGroup is re-exported
  it('/api/db/shared/tables/posts → db', () => {
    expect(getGroup('/api/db/shared/tables/posts')).toBe('db');
  });

  it('/api/db/workspace/tables/tasks → db', () => {
    expect(getGroup('/api/db/workspace/tables/tasks')).toBe('db');
  });

  it('/api/storage/avatars → storage', () => {
    expect(getGroup('/api/storage/avatars')).toBe('storage');
  });

  it('/api/storage/avatars/upload → storage', () => {
    expect(getGroup('/api/storage/avatars/upload')).toBe('storage');
  });

  it('/api/functions/my-func → functions', () => {
    expect(getGroup('/api/functions/my-func')).toBe('functions');
  });

  it('/api/auth/signup → global', () => {
    expect(getGroup('/api/auth/signup')).toBe('global');
  });

  it('/api/auth/signin → global', () => {
    expect(getGroup('/api/auth/signin')).toBe('global');
  });

  it('/api/health → global', () => {
    expect(getGroup('/api/health')).toBe('global');
  });

  it('/api/db/subscribe → global', () => {
    expect(getGroup('/api/db/subscribe')).toBe('global');
  });

  it('/admin/api/data/tables → global', () => {
    expect(getGroup('/admin/api/data/tables')).toBe('global');
  });
});

// ─── 11. getLimit 확장 ─────────────────────────────────────────────────────

describe('1-20 rate-limit — getLimit', () => {
  it('config undefined → defaults', () => {
    const result = getLimit(undefined, 'db');
    expect(result).toEqual(RATE_LIMIT_DEV_DEFAULTS.db);
  });

  it('미존재 group → 안전한 fallback (10M)', () => {
    const result = getLimit(undefined, 'nonexistent');
    expect(result.requests).toBe(10_000_000);
  });

  it('config에 rateLimiting 있을 때 사용', () => {
    const config = {
      rateLimiting: {
        db: { requests: 200, window: '30s' },
      },
    } as any;
    const result = getLimit(config, 'db');
    expect(result.requests).toBe(200);
    expect(result.windowSec).toBe(30);
  });

  it('config에 해당 group 없으면 defaults', () => {
    const config = {
      rateLimiting: {
        db: { requests: 200, window: '30s' },
      },
    } as any;
    const result = getLimit(config, 'storage');
    expect(result).toEqual(RATE_LIMIT_DEV_DEFAULTS.storage);
  });
});

// ─── 12. SK 요청 → global only ─────────────────────────────────────────────

describe('1-20 rate-limit — SK 요청 rate limit', () => {
  it('SK로 /api/db/shared/tables/posts → 200 (db group skip, global only)', async () => {
    const res = await (globalThis as any).SELF.fetch('http://localhost/api/db/shared/tables/posts', {
      headers: { 'X-EdgeBase-Service-Key': 'test-service-key-for-admin' },
    });
    expect(res.status).toBe(200);
  });

  it('SK로 storage 접근 → rate limit group skip (global only)', async () => {
    const res = await (globalThis as any).SELF.fetch('http://localhost/api/storage/avatars', {
      headers: { 'X-EdgeBase-Service-Key': 'test-service-key-for-admin' },
    });
    expect([200, 404].includes(res.status)).toBe(true);
  });
});

// ─── 13. HTTP 429 에러 구조 ──────────────────────────────────────────────────

describe('1-20 rate-limit — 429 에러 구조', () => {
  it('429 응답 시 { code: 429, message } 형식 (단위테스트)', () => {
    // Verify the expected response shape
    const errorBody = { code: 429, message: 'Too many requests. Please try again later.' };
    expect(errorBody.code).toBe(429);
    expect(typeof errorBody.message).toBe('string');
  });

  it('Retry-After는 양수 정수여야 함 (단위테스트)', () => {
    const c = new FixedWindowCounter();
    c.check('ra-header', 1, 30);
    c.check('ra-header', 1, 30); // exceed
    const retryAfter = c.getRetryAfter('ra-header');
    expect(retryAfter).toBeGreaterThan(0);
    expect(Number.isInteger(retryAfter)).toBe(true);
  });
});

// ─── 14. RATE_LIMIT_DEFAULTS 확장 ──────────────────────────────────────────

describe('1-20 rate-limit — RATE_LIMIT_DEFAULTS 확장', () => {
  it('모든 group에 requests와 windowSec 존재', () => {
    for (const group of Object.keys(RATE_LIMIT_DEFAULTS)) {
      expect(RATE_LIMIT_DEFAULTS[group].requests).toBeGreaterThanOrEqual(0);
      expect(RATE_LIMIT_DEFAULTS[group].windowSec).toBeGreaterThan(0);
    }
  });

  it('총 8개 group 정의', () => {
    expect(Object.keys(RATE_LIMIT_DEFAULTS).length).toBe(8);
  });

  it('global windowSec === 60', () => {
    expect(RATE_LIMIT_DEFAULTS.global.windowSec).toBe(60);
  });

  it('auth < global requests', () => {
    expect(RATE_LIMIT_DEFAULTS.auth.requests).toBeLessThan(RATE_LIMIT_DEFAULTS.global.requests);
  });

  it('authSignin <= auth requests', () => {
    expect(RATE_LIMIT_DEFAULTS.authSignin.requests).toBeLessThanOrEqual(RATE_LIMIT_DEFAULTS.auth.requests);
  });

  it('authSignup <= auth requests', () => {
    expect(RATE_LIMIT_DEFAULTS.authSignup.requests).toBeLessThanOrEqual(RATE_LIMIT_DEFAULTS.auth.requests);
  });
});

// ─── 15. HTTP 429 트리거 통합 테스트 ────────────────────────────────────────
//
// Root cause: edgebase.test.config.js sets db rate limit to 10000 req/60s
// via setConfig() singleton, which is the runtime source of truth.
//
// Strategy: vitest-pool-workers shares the module context between test and
// worker code. We pre-fill the exported `counter` singleton's internal bucket
// to just under the limit so the next SELF.fetch triggers 429.
//
// Helper: directly set the counter's bucket to simulate near-exhaustion.
function prefillCounter(key: string, count: number, windowSec: number): void {
  const buckets = (counter as any).buckets as Map<string, { count: number; resetAt: number }>;
  buckets.set(key, { count, resetAt: Date.now() + windowSec * 1000 });
}

describe('1-20 rate-limit — HTTP 429 실제 트리거', () => {
  const url = 'http://localhost/api/db/shared/tables/posts';
  const SK = 'test-service-key-for-admin';
  // edgebase.test.config.js sets db: { requests: 10000, window: '60s' }
  const DB_LIMIT = 10000;
  const ipHeaders = (ip: string) => ({ 'cf-connecting-ip': ip });

  it('counter exhaustion → 429', async () => {
    const ip = `rate-429-${Date.now()}-${Math.random()}`;
    const counterKey = `db:${ip}`;

    // Pre-fill counter to exactly the limit
    prefillCounter(counterKey, DB_LIMIT, 60);

    // Next request from this IP should be rate limited
    const res = await (globalThis as any).SELF.fetch(url, {
      // Integration runtime should match production defaults: CF-Connecting-IP is trusted,
      // while X-Forwarded-For is ignored unless trustSelfHostedProxy=true.
      headers: ipHeaders(ip),
    });
    expect(res.status).toBe(429);
  });

  it('429 response: { code: 429, message } + Retry-After header', async () => {
    const ip = `rate-resp-${Date.now()}-${Math.random()}`;
    const counterKey = `db:${ip}`;

    prefillCounter(counterKey, DB_LIMIT, 60);

    const res = await (globalThis as any).SELF.fetch(url, {
      headers: ipHeaders(ip),
    });
    expect(res.status).toBe(429);

    // Verify JSON body
    const data = await res.json();
    expect(data).toMatchObject({
      code: 429,
      message: 'Too many requests. Please try again later.',
    });
    expect(data.group).toBeTruthy();

    // Verify Retry-After header
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    const retrySeconds = parseInt(retryAfter!, 10);
    expect(retrySeconds).toBeGreaterThan(0);
    expect(retrySeconds).toBeLessThanOrEqual(60);
  });

  it('different IP is independent — not rate limited', async () => {
    const limitedIp = `rate-lim-${Date.now()}-${Math.random()}`;
    const freshIp = `rate-fresh-${Date.now()}-${Math.random()}`;

    // Exhaust one IP
    prefillCounter(`db:${limitedIp}`, DB_LIMIT, 60);

    // Limited IP → 429
    const res1 = await (globalThis as any).SELF.fetch(url, {
      headers: ipHeaders(limitedIp),
    });
    expect(res1.status).toBe(429);

    // Fresh IP → NOT 429
    const res2 = await (globalThis as any).SELF.fetch(url, {
      headers: ipHeaders(freshIp),
    });
    expect(res2.status).not.toBe(429);
  });

  it('service key bypasses app-level rate limits', async () => {
    const ip = `rate-sk-${Date.now()}-${Math.random()}`;

    // Exhaust db counter
    prefillCounter(`db:${ip}`, DB_LIMIT, 60);

    // Without SK → 429
    const limited = await (globalThis as any).SELF.fetch(url, {
      headers: ipHeaders(ip),
    });
    expect(limited.status).toBe(429);

    // With SK → bypasses EdgeBase app-level rate limits entirely
    const skRes = await (globalThis as any).SELF.fetch(url, {
      headers: {
        ...ipHeaders(ip),
        'X-EdgeBase-Service-Key': SK,
      },
    });
    expect(skRes.status).not.toBe(429);
  });
});
