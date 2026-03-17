/**
 * password.test.ts — 20개 (기존 13 + 추가 7)
 *
 * 테스트 대상: src/lib/password.ts
 *   hashPassword, verifyPassword
 *   PBKDF2-SHA256, 100K iterations, 16-byte salt, 32-byte key
 *   Format: `pbkdf2:sha256:{iterations}:{salt_b64}:{hash_b64}`
 */
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/password.js';

describe('1-10 password — hashPassword', () => {
  it('반환값이 pbkdf2:sha256:100000:...:... 형식', async () => {
    const hash = await hashPassword('myPassword123!');
    expect(hash).toMatch(/^pbkdf2:sha256:100000:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });

  it('반환값은 5개 콜론 구분 파트', async () => {
    const hash = await hashPassword('test');
    const parts = hash.split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('pbkdf2');
    expect(parts[1]).toBe('sha256');
    expect(parts[2]).toBe('100000');
  });

  it('salt 파트는 base64 형식 (16바이트 → 24자)', async () => {
    const hash = await hashPassword('test');
    const saltB64 = hash.split(':')[3];
    // 16 bytes → 24 base64 chars (with padding)
    expect(saltB64.length).toBeGreaterThanOrEqual(22); // min without padding
    expect(() => atob(saltB64)).not.toThrow();
  });

  it('동일 비밀번호 두 번 해시 → 다른 해시 (salt 랜덤)', async () => {
    const h1 = await hashPassword('samePassword');
    const h2 = await hashPassword('samePassword');
    expect(h1).not.toBe(h2);
  });

  it('빈 문자열 비밀번호도 해시 가능', async () => {
    const hash = await hashPassword('');
    expect(hash).toMatch(/^pbkdf2:sha256:/);
  });
});

describe('1-10 password — verifyPassword', () => {
  it('올바른 비밀번호 → true', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('correct-password', hash)).toBe(true);
  });

  it('틀린 비밀번호 → false', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('비밀번호 대소문자 구분', async () => {
    const hash = await hashPassword('Password123');
    expect(await verifyPassword('password123', hash)).toBe(false);
    expect(await verifyPassword('Password123', hash)).toBe(true);
  });

  it('잘못된 형식 해시 → false', async () => {
    expect(await verifyPassword('any', 'invalid-hash-string')).toBe(false);
  });

  it('파트 수 잘못된 해시 → false', async () => {
    expect(await verifyPassword('any', 'a:b:c')).toBe(false);
  });

  it('알고리즘 필드 변조 → false', async () => {
    const hash = await hashPassword('test');
    const mangled = hash.replace('pbkdf2', 'scrypt');
    expect(await verifyPassword('test', mangled)).toBe(false);
  });

  it('unicode 비밀번호 round-trip', async () => {
    const pw = '비밀번호123🔐';
    const hash = await hashPassword(pw);
    expect(await verifyPassword(pw, hash)).toBe(true);
    expect(await verifyPassword('비밀번호124🔐', hash)).toBe(false);
  });

  it('긴 비밀번호 (200자) round-trip', async () => {
    const pw = 'a'.repeat(200);
    const hash = await hashPassword(pw);
    expect(await verifyPassword(pw, hash)).toBe(true);
    expect(await verifyPassword('a'.repeat(199), hash)).toBe(false);
  });
});

// ─── 추가 테스트: hashPassword 심층 ──────────────────────────────────────────

describe('1-10 password — hashPassword 심층', () => {
  it('PBKDF2 100K iterations 확인', async () => {
    const hash = await hashPassword('iterCheck');
    const iterations = parseInt(hash.split(':')[2], 10);
    expect(iterations).toBe(100000);
  });

  it('hash 파트(32바이트 키) base64 길이 ≥ 42자', async () => {
    const hash = await hashPassword('hashLenCheck');
    const hashB64 = hash.split(':')[4];
    // 32 bytes → 44 base64 chars (with padding)
    expect(hashB64.length).toBeGreaterThanOrEqual(42);
    expect(() => atob(hashB64)).not.toThrow();
  });

  it('salt 파트 base64 디코드 → 16바이트', async () => {
    const hash = await hashPassword('saltSizeCheck');
    const saltB64 = hash.split(':')[3];
    const saltBytes = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    expect(saltBytes.length).toBe(16);
  });

  it('hash 파트 base64 디코드 → 32바이트', async () => {
    const hash = await hashPassword('keySizeCheck');
    const hashB64 = hash.split(':')[4];
    const hashBytes = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0));
    expect(hashBytes.length).toBe(32);
  });

  it('동일 비밀번호 3회 해시 → 3개 모두 다름 (salt 랜덤)', async () => {
    const pw = 'tripleSame';
    const h1 = await hashPassword(pw);
    const h2 = await hashPassword(pw);
    const h3 = await hashPassword(pw);
    expect(h1).not.toBe(h2);
    expect(h2).not.toBe(h3);
    expect(h1).not.toBe(h3);
  });
});

// ─── 추가 테스트: verifyPassword 엣지 케이스 ─────────────────────────────────

describe('1-10 password — verifyPassword 엣지 케이스', () => {
  it('iteration 수 변조 → false', async () => {
    const hash = await hashPassword('tamperIter');
    const mangled = hash.replace(':100000:', ':50000:');
    expect(await verifyPassword('tamperIter', mangled)).toBe(false);
  });

  it('salt 변조 → false', async () => {
    const hash = await hashPassword('tamperSalt');
    const parts = hash.split(':');
    // Replace first char of salt
    parts[3] = 'A' + parts[3].slice(1);
    const mangled = parts.join(':');
    expect(await verifyPassword('tamperSalt', mangled)).toBe(false);
  });
});
