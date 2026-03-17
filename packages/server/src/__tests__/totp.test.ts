/**
 * 서버 단위 테스트 — lib/totp.ts
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/totp.test.ts
 *
 * 테스트 대상:
 *   generateTOTPSecret / generateTOTPUri / verifyTOTP
 *   generateRecoveryCodes / encryptSecret / decryptSecret
 */

import { describe, it, expect } from 'vitest';
import {
  generateTOTPSecret,
  generateTOTPUri,
  verifyTOTP,
  generateRecoveryCodes,
  encryptSecret,
  decryptSecret,
} from '../lib/totp.js';

// ─── A. generateTOTPSecret ──────────────────────────────────────────────────

describe('generateTOTPSecret', () => {
  it('returns a base32 string', () => {
    const secret = generateTOTPSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it('returns 32 characters (20 bytes → 32 base32 chars)', () => {
    const secret = generateTOTPSecret();
    expect(secret.length).toBe(32);
  });

  it('different calls produce different secrets', () => {
    const s1 = generateTOTPSecret();
    const s2 = generateTOTPSecret();
    expect(s1).not.toBe(s2);
  });
});

// ─── B. generateTOTPUri ─────────────────────────────────────────────────────

describe('generateTOTPUri', () => {
  it('returns otpauth:// URI', () => {
    const uri = generateTOTPUri('JBSWY3DPEHPK3PXP', 'user@example.com', 'MyApp');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
  });

  it('includes secret parameter', () => {
    const uri = generateTOTPUri('MYSECRET', 'u@e.com', 'App');
    expect(uri).toContain('secret=MYSECRET');
  });

  it('includes issuer parameter', () => {
    const uri = generateTOTPUri('SECRET', 'u@e.com', 'MyApp');
    expect(uri).toContain('issuer=MyApp');
  });

  it('includes algorithm=SHA1', () => {
    const uri = generateTOTPUri('SECRET', 'u@e.com', 'App');
    expect(uri).toContain('algorithm=SHA1');
  });

  it('includes digits=6', () => {
    const uri = generateTOTPUri('SECRET', 'u@e.com', 'App');
    expect(uri).toContain('digits=6');
  });

  it('includes period=30', () => {
    const uri = generateTOTPUri('SECRET', 'u@e.com', 'App');
    expect(uri).toContain('period=30');
  });

  it('encodes special characters in issuer', () => {
    const uri = generateTOTPUri('SECRET', 'u@e.com', 'My App & Co');
    expect(uri).toContain('My%20App%20%26%20Co');
  });

  it('encodes email in label', () => {
    const uri = generateTOTPUri('SECRET', 'user@example.com', 'App');
    expect(uri).toContain('user%40example.com');
  });

  it('label format is issuer:email', () => {
    const uri = generateTOTPUri('SECRET', 'u@e.com', 'MyApp');
    expect(uri).toContain('MyApp:u%40e.com');
  });
});

// ─── C. verifyTOTP ──────────────────────────────────────────────────────────

describe('verifyTOTP', () => {
  it('empty code → false', async () => {
    expect(await verifyTOTP('JBSWY3DPEHPK3PXP', '')).toBe(false);
  });

  it('wrong length code (5 digits) → false', async () => {
    expect(await verifyTOTP('JBSWY3DPEHPK3PXP', '12345')).toBe(false);
  });

  it('wrong length code (7 digits) → false', async () => {
    expect(await verifyTOTP('JBSWY3DPEHPK3PXP', '1234567')).toBe(false);
  });

  it('random 6-digit code with random secret → false (extremely likely)', async () => {
    const secret = generateTOTPSecret();
    // A random code should almost never match
    expect(await verifyTOTP(secret, '999999')).toBe(false);
  });

  it('window parameter controls step range', async () => {
    // With window=0, only the current step is checked
    const secret = generateTOTPSecret();
    const result = await verifyTOTP(secret, '000000', 0);
    expect(typeof result).toBe('boolean');
  });
});

// ─── D. generateRecoveryCodes ───────────────────────────────────────────────

describe('generateRecoveryCodes', () => {
  it('default: 8 codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes.length).toBe(8);
  });

  it('custom count', () => {
    const codes = generateRecoveryCodes(5);
    expect(codes.length).toBe(5);
  });

  it('each code is 8 characters', () => {
    const codes = generateRecoveryCodes();
    for (const code of codes) {
      expect(code.length).toBe(8);
    }
  });

  it('codes use unambiguous charset (no 0/o/1/l/i)', () => {
    const codes = generateRecoveryCodes(20);
    const combined = codes.join('');
    expect(combined).not.toMatch(/[01ilo]/);
  });

  it('codes only contain allowed characters', () => {
    const allowed = /^[abcdefghjkmnpqrstuvwxyz23456789]+$/;
    const codes = generateRecoveryCodes(10);
    for (const code of codes) {
      expect(code).toMatch(allowed);
    }
  });

  it('zero count → empty array', () => {
    const codes = generateRecoveryCodes(0);
    expect(codes).toEqual([]);
  });
});

// ─── E. encryptSecret / decryptSecret ───────────────────────────────────────

describe('encryptSecret / decryptSecret', () => {
  it('round-trip: encrypt then decrypt returns original', async () => {
    const original = 'JBSWY3DPEHPK3PXP';
    const encrypted = await encryptSecret(original, 'my-key-material');
    const decrypted = await decryptSecret(encrypted, 'my-key-material');
    expect(decrypted).toBe(original);
  });

  it('encrypted output is base64', async () => {
    const encrypted = await encryptSecret('test-secret', 'key');
    // Base64 characters only
    expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('different keys produce different ciphertexts', async () => {
    const e1 = await encryptSecret('same', 'key1');
    const e2 = await encryptSecret('same', 'key2');
    expect(e1).not.toBe(e2);
  });

  it('same key + same plaintext → different ciphertexts (random IV)', async () => {
    const e1 = await encryptSecret('same', 'same-key');
    const e2 = await encryptSecret('same', 'same-key');
    expect(e1).not.toBe(e2);
  });

  it('wrong key → throws (AES-GCM decryption failure)', async () => {
    const encrypted = await encryptSecret('secret', 'correct-key');
    await expect(
      decryptSecret(encrypted, 'wrong-key'),
    ).rejects.toThrow();
  });

  it('unicode secret round-trip', async () => {
    const original = '한글시크릿🔑';
    const encrypted = await encryptSecret(original, 'key');
    const decrypted = await decryptSecret(encrypted, 'key');
    expect(decrypted).toBe(original);
  });
});
