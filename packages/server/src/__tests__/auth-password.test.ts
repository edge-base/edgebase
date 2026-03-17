/**
 * 서버 단위 테스트 — lib/password.ts
 * 1-10 auth-password.test.ts — 20개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/auth-password.test.ts
 *
 * 테스트 대상:
 *   hashPassword / verifyPassword
 *   Format: pbkdf2:sha256:{iterations}:{salt_b64}:{hash_b64}
 */

import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword, needsRehash, isPasswordHash } from '../lib/password.js';

// ─── A. hashPassword ─────────────────────────────────────────────────────────

describe('hashPassword', () => {
  it('returns a string', async () => {
    const hash = await hashPassword('MyP@ssword1!');
    expect(typeof hash).toBe('string');
  });

  it('format is pbkdf2:sha256:{iterations}:{salt}:{hash}', async () => {
    const hash = await hashPassword('MyP@ssword1!');
    const parts = hash.split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('pbkdf2');
    expect(parts[1]).toBe('sha256');
    expect(parts[2]).toBe('100000');
    // salt and hash are base64 — non-empty
    expect(parts[3].length).toBeGreaterThan(0);
    expect(parts[4].length).toBeGreaterThan(0);
  });

  it('iterations is 100000 (Cloudflare WebCrypto ceiling)', async () => {
    const hash = await hashPassword('test');
    const iterations = parseInt(hash.split(':')[2], 10);
    expect(iterations).toBe(100000);
  });

  it('different hashes for same password (random salt)', async () => {
    const hash1 = await hashPassword('identical');
    const hash2 = await hashPassword('identical');
    expect(hash1).not.toBe(hash2);
  });

  it('salt segment is base64 encoded (16-byte → ~24 chars)', async () => {
    const hash = await hashPassword('test');
    const salt = hash.split(':')[3];
    // 16 bytes base64 should be 24 chars (with padding)
    expect(salt.length).toBeGreaterThanOrEqual(20);
  });

  it('hash segment is base64 encoded (32-byte → ~44 chars)', async () => {
    const hash = await hashPassword('test');
    const hashPart = hash.split(':')[4];
    // 32 bytes base64 should be 44 chars (with padding)
    expect(hashPart.length).toBeGreaterThanOrEqual(40);
  });
});

// ─── B. verifyPassword ───────────────────────────────────────────────────────

describe('verifyPassword', () => {
  it('correct password → true', async () => {
    const hash = await hashPassword('CorrectPw1!');
    const result = await verifyPassword('CorrectPw1!', hash);
    expect(result).toBe(true);
  });

  it('wrong password → false', async () => {
    const hash = await hashPassword('CorrectPw1!');
    const result = await verifyPassword('WrongPw1!', hash);
    expect(result).toBe(false);
  });

  it('empty password → false against normal hash', async () => {
    const hash = await hashPassword('CorrectPw1!');
    const result = await verifyPassword('', hash);
    expect(result).toBe(false);
  });

  it('case-sensitive: lowercase ≠ uppercase', async () => {
    const hash = await hashPassword('Password1!');
    const result = await verifyPassword('password1!', hash);
    expect(result).toBe(false);
  });

  it('malformed hash (too few parts) → false', async () => {
    const result = await verifyPassword('test', 'pbkdf2:sha256:100000:salt');
    expect(result).toBe(false);
  });

  it('wrong algorithm prefix → false', async () => {
    const result = await verifyPassword('test', 'bcrypt:sha256:100000:salt:hash');
    expect(result).toBe(false);
  });

  it('different hash algorithm (sha512) → false', async () => {
    const result = await verifyPassword('test', 'pbkdf2:sha512:100000:salt:hash');
    expect(result).toBe(false);
  });

  it('blank hash → false', async () => {
    const result = await verifyPassword('test', '');
    expect(result).toBe(false);
  });

  it('correct unicode password → true', async () => {
    const pw = '한국어비밀번호';
    const hash = await hashPassword(pw);
    expect(await verifyPassword(pw, hash)).toBe(true);
  });

  it('trailing space in password treated as different password', async () => {
    const hash = await hashPassword('Password1!');
    expect(await verifyPassword('Password1! ', hash)).toBe(false);
  });

  it('very long password → true', async () => {
    const longPw = 'a'.repeat(1000);
    const hash = await hashPassword(longPw);
    expect(await verifyPassword(longPw, hash)).toBe(true);
  });

  it('timing-safe: wrong hash still evaluates same path', async () => {
    // Just verify it doesn't throw on wrong secret comparison
    const hash = await hashPassword('correct');
    const result = await verifyPassword('wrong', hash);
    expect(typeof result).toBe('boolean');
  });

  it('special characters in password', async () => {
    const pw = '!@#$%^&*()_+-=[]{};\':"\\|,.<>/?`~';
    const hash = await hashPassword(pw);
    expect(await verifyPassword(pw, hash)).toBe(true);
  });

  it('empty stored hash parts[3] invalid salt → false', async () => {
    const result = await verifyPassword('test', 'pbkdf2:sha256:100000::');
    // Should return false (empty salt) or throw — either way not true
    expect(result).not.toBe(true);
  });

  it('tampered iteration count → false', async () => {
    const hash = await hashPassword('correct');
    const parts = hash.split(':');
    // Replace 100000 with 100 — different iterations produce different derived key
    const tampered = [parts[0], parts[1], '100', parts[3], parts[4]].join(':');
    expect(await verifyPassword('correct', tampered)).toBe(false);
  });

  it('swapped salt and hash parts → false', async () => {
    const hash = await hashPassword('correct');
    const parts = hash.split(':');
    // Swap parts[3] (salt) and parts[4] (hash)
    const swapped = [parts[0], parts[1], parts[2], parts[4], parts[3]].join(':');
    expect(await verifyPassword('correct', swapped)).toBe(false);
  });

  it('truncated hash (length mismatch) → false', async () => {
    const hash = await hashPassword('correct');
    const parts = hash.split(':');
    // Shorten the hash part to trigger length mismatch in constant-time comparison
    const truncated = [parts[0], parts[1], parts[2], parts[3], 'AA'].join(':');
    expect(await verifyPassword('correct', truncated)).toBe(false);
  });

  it('extra parts in hash (6 segments) → false', async () => {
    const hash = await hashPassword('correct');
    const result = await verifyPassword('correct', hash + ':extra');
    expect(result).toBe(false);
  });

  it('unknown hash format → false', async () => {
    expect(await verifyPassword('test', 'scrypt:sha256:100:salt:hash')).toBe(false);
  });

  it('$2c$ prefix (not recognized bcrypt variant) → false', async () => {
    expect(await verifyPassword('test', '$2c$10$abcdefghijklmnopqrstuuxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(false);
  });
});

// ─── C. needsRehash ──────────────────────────────────────────────────────────

describe('needsRehash', () => {
  it('pbkdf2 hash → false (no rehash needed)', async () => {
    const hash = await hashPassword('test');
    expect(needsRehash(hash)).toBe(false);
  });

  it('bcrypt $2a$ hash → true (needs upgrade)', () => {
    expect(needsRehash('$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(true);
  });

  it('bcrypt $2b$ hash → true', () => {
    expect(needsRehash('$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(true);
  });

  it('bcrypt $2y$ hash → true', () => {
    expect(needsRehash('$2y$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(true);
  });

  it('empty string → true', () => {
    expect(needsRehash('')).toBe(true);
  });

  it('random string → true', () => {
    expect(needsRehash('not-a-real-hash')).toBe(true);
  });
});

// ─── D. isPasswordHash ──────────────────────────────────────────────────────

describe('isPasswordHash', () => {
  it('pbkdf2:sha256: prefix → true', async () => {
    const hash = await hashPassword('test');
    expect(isPasswordHash(hash)).toBe(true);
  });

  it('$2a$ bcrypt → true', () => {
    expect(isPasswordHash('$2a$10$abcdefghijklmnop')).toBe(true);
  });

  it('$2b$ bcrypt → true', () => {
    expect(isPasswordHash('$2b$10$abcdefghijklmnop')).toBe(true);
  });

  it('$2y$ bcrypt → true', () => {
    expect(isPasswordHash('$2y$10$abcdefghijklmnop')).toBe(true);
  });

  it('plaintext password → false', () => {
    expect(isPasswordHash('MyPassword123!')).toBe(false);
  });

  it('empty string → false', () => {
    expect(isPasswordHash('')).toBe(false);
  });

  it('pbkdf2: without sha256 → false', () => {
    expect(isPasswordHash('pbkdf2:sha512:100000:salt:hash')).toBe(false);
  });

  it('$2c$ not recognized → false', () => {
    expect(isPasswordHash('$2c$10$abcdefghijklmnop')).toBe(false);
  });
});

// ─── E. verifyPassword — bcrypt mutation-killing ────────────────────────────
// Kills 11 survived mutants on line 78 (bcrypt prefix detection) and 2 on line 73

describe('verifyPassword — real bcrypt hashes', () => {
  // Use low cost (4) for speed — these test dispatch logic, not bcrypt strength
  const COST = 4;

  it('$2b$ real hash + correct password → true', async () => {
    const hash = bcrypt.hashSync('TestPw1!', COST);
    expect(hash).toMatch(/^\$2[ab]\$/);
    expect(await verifyPassword('TestPw1!', hash)).toBe(true);
  });

  it('$2b$ real hash + wrong password → false', async () => {
    const hash = bcrypt.hashSync('TestPw1!', COST);
    expect(await verifyPassword('WrongPw1!', hash)).toBe(false);
  });

  it('$2a$ real hash + correct password → true', async () => {
    // bcryptjs v3 defaults to $2b$; convert to $2a$ (compatible variant)
    const hash = bcrypt.hashSync('BcryptA!', COST);
    const a2Hash = hash.replace('$2b$', '$2a$');
    expect(a2Hash).toMatch(/^\$2a\$/);
    expect(await verifyPassword('BcryptA!', a2Hash)).toBe(true);
  });

  it('pbkdf2 hash dispatches to PBKDF2 path (not bcrypt)', async () => {
    // If line 73 is mutated to `if (true)`, ALL hashes go through verifyPBKDF2.
    // A bcrypt hash in PBKDF2 path → always false.
    // So we need: pbkdf2 correct + bcrypt correct in same test suite.
    const pbkdf2Hash = await hashPassword('TestPw1!');
    expect(await verifyPassword('TestPw1!', pbkdf2Hash)).toBe(true);

    const bcryptHash = bcrypt.hashSync('TestPw1!', COST);
    expect(await verifyPassword('TestPw1!', bcryptHash)).toBe(true);
  });

  it('bcrypt hash is NOT handled by PBKDF2 verifier', async () => {
    // Specifically ensures line 73 `startsWith("pbkdf2:")` check matters
    const bcryptHash = bcrypt.hashSync('hello', COST);
    // bcrypt hash does NOT start with 'pbkdf2:', so must go through bcrypt path
    expect(bcryptHash.startsWith('pbkdf2:')).toBe(false);
    expect(await verifyPassword('hello', bcryptHash)).toBe(true);
  });
});

// ─── F. verifyPBKDF2 — parts validation mutation-killing ────────────────────
// Kills 2 survived mutants on line 108 (independent parts[0] and parts[1] checks)

describe('verifyPBKDF2 — independent parts validation', () => {
  it('parts[0] = "argon2" but parts[1] = "sha256" → false', async () => {
    // Kills mutation: parts[0] !== "pbkdf2" check → if (false)
    const hash = await hashPassword('test');
    const parts = hash.split(':');
    const tampered = ['argon2', parts[1], parts[2], parts[3], parts[4]].join(':');
    expect(await verifyPassword('test', tampered)).toBe(false);
  });

  it('parts[0] = "pbkdf2" but parts[1] = "sha384" → false', async () => {
    // Kills mutation: parts[1] !== "sha256" check → if (false)
    const hash = await hashPassword('test');
    const parts = hash.split(':');
    const tampered = [parts[0], 'sha384', parts[2], parts[3], parts[4]].join(':');
    expect(await verifyPassword('test', tampered)).toBe(false);
  });

  it('parts[0] changed only → false (parts[1] intact)', async () => {
    const hash = await hashPassword('pw');
    const parts = hash.split(':');
    parts[0] = 'scrypt';
    // Starts with 'scrypt:' not 'pbkdf2:' — falls through to unknown format
    expect(await verifyPassword('pw', parts.join(':'))).toBe(false);
  });
});

// ─── G. Constant-time comparison — mutation-killing ─────────────────────────
// Kills survived mutant on line 137 (length check → if (false))

describe('verifyPBKDF2 — constant-time comparison edge cases', () => {
  it('half-length hash part (correct password) → false', async () => {
    // Construct a hash where the hash portion is exactly half length (16 bytes).
    // With line 137 mutation (if (false)), XOR loop would read undefined bytes
    // from expectedHash, producing NaN→0 in bitwise ops → false positive.
    const hash = await hashPassword('correct');
    const parts = hash.split(':');
    // 32 bytes base64 → 44 chars. Take first 24 chars = 16 bytes.
    const halfHash = parts[4].substring(0, 24);
    // Pad to valid base64 if needed
    const padded = halfHash.length % 4 === 0 ? halfHash : halfHash + '='.repeat(4 - (halfHash.length % 4));
    const truncated = [parts[0], parts[1], parts[2], parts[3], padded].join(':');
    expect(await verifyPassword('correct', truncated)).toBe(false);
  });

  it('extended hash part (48 bytes vs 32) → false', async () => {
    const hash = await hashPassword('correct');
    const parts = hash.split(':');
    // 48 bytes = valid base64 of 64 chars. Build a standalone valid base64 string.
    const extended = btoa(String.fromCharCode(...new Uint8Array(48)));
    const oversized = [parts[0], parts[1], parts[2], parts[3], extended].join(':');
    expect(await verifyPassword('correct', oversized)).toBe(false);
  });

  it('single-byte hash part → false', async () => {
    const hash = await hashPassword('correct');
    const parts = hash.split(':');
    // Single byte base64: 'QQ==' = [0x41]
    const single = [parts[0], parts[1], parts[2], parts[3], 'QQ=='].join(':');
    expect(await verifyPassword('correct', single)).toBe(false);
  });

  it('empty base64 hash part → false', async () => {
    const hash = await hashPassword('correct');
    const parts = hash.split(':');
    const empty = [parts[0], parts[1], parts[2], parts[3], ''].join(':');
    expect(await verifyPassword('correct', empty)).toBe(false);
  });
});
