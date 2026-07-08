/**
 * 서버 단위 테스트 — lib/totp.ts
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/totp.test.ts
 *
 * 테스트 대상:
 *   generateTOTPSecret / generateTOTPUri / verifyTOTP
 *   generateRecoveryCodes / encryptSecret / decryptSecret
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
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

// ─── F. Code generation & round-trip verification (RFC 6238) ────────────────
//
// verifyTOTP has no exported code generator, so we build an independent
// RFC 4226/6238 HOTP implementation in-test (Web Crypto, no network/bindings)
// and cross-check it against the module. Date.now() is deterministically
// mocked per test, so no wall-clock dependence and no fake timers needed.

const STEP = 30;

/** RFC 6238 Appendix B SHA-1 test key ("12345678901234567890") in base32. */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/** Standard base32 decode (RFC 4648, same alphabet as the module). */
function base32Decode(encoded: string): Uint8Array {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const char of cleaned) {
    buffer = (buffer << 5) | CHARS.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/** Independent 6-digit HOTP for a given key + counter (RFC 4226 §5). */
async function hotp(keyBytes: Uint8Array, counter: number): Promise<string> {
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const hmac = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, counterBytes),
  );
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, '0');
}

/** Freeze the clock at a specific unix-second time. */
function freezeAt(unixSeconds: number): void {
  vi.spyOn(Date, 'now').mockReturnValue(unixSeconds * 1000);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TOTP code generation (RFC 6238 SHA-1 vectors)', () => {
  // Truncated 6-digit codes from RFC 6238 Appendix B for the SHA-1 test key.
  const VECTORS: Array<[time: number, code: string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];

  it('our in-test HOTP matches the published RFC 6238 codes', async () => {
    const key = base32Decode(RFC_SECRET);
    for (const [time, expected] of VECTORS) {
      const code = await hotp(key, Math.floor(time / STEP));
      expect(code).toBe(expected);
    }
  });

  it('verifyTOTP accepts each published code at its exact time step (window=0)', async () => {
    for (const [time, code] of VECTORS) {
      freezeAt(time);
      // window=0 → only the current 30s step is checked, proving the module's
      // own code generation agrees with the RFC vectors at that instant.
      expect(await verifyTOTP(RFC_SECRET, code, 0)).toBe(true);
      vi.restoreAllMocks();
    }
  });
});

describe('verifyTOTP round-trip (generate → verify)', () => {
  it('a freshly generated secret verifies its own current-step code', async () => {
    const secret = generateTOTPSecret();
    freezeAt(1_700_000_000);
    const counter = Math.floor(1_700_000_000 / STEP);
    const code = await hotp(base32Decode(secret), counter);
    expect(await verifyTOTP(secret, code)).toBe(true);
  });

  it('rejects a code from a totally different (far-future) step', async () => {
    const secret = generateTOTPSecret();
    freezeAt(1_700_000_000);
    const currentCounter = Math.floor(1_700_000_000 / STEP);
    // Code from 100 steps away is well outside the ±1 window.
    const staleCode = await hotp(base32Decode(secret), currentCounter + 100);
    expect(await verifyTOTP(secret, staleCode)).toBe(false);
  });

  it('rejects a one-off wrong code at the correct time', async () => {
    const secret = generateTOTPSecret();
    freezeAt(1_700_000_000);
    const counter = Math.floor(1_700_000_000 / STEP);
    const valid = await hotp(base32Decode(secret), counter);
    // Perturb one digit to get a definitely-wrong 6-digit code.
    const wrong = (((Number(valid) + 1) % 1_000_000))
      .toString()
      .padStart(6, '0');
    expect(wrong).not.toBe(valid);
    expect(await verifyTOTP(secret, wrong)).toBe(false);
  });
});

describe('verifyTOTP time-window tolerance & edges', () => {
  const key = base32Decode(RFC_SECRET);

  it('accepts the previous step (−1) within the default ±1 window', async () => {
    freezeAt(60); // counter = 2
    const prevCode = await hotp(key, 1); // counter − 1
    expect(await verifyTOTP(RFC_SECRET, prevCode)).toBe(true);
  });

  it('accepts the next step (+1) within the default ±1 window', async () => {
    freezeAt(60); // counter = 2
    const nextCode = await hotp(key, 3); // counter + 1
    expect(await verifyTOTP(RFC_SECRET, nextCode)).toBe(true);
  });

  it('rejects a step just outside the window (−2) — window edge', async () => {
    freezeAt(60); // counter = 2
    const code = await hotp(key, 0); // counter − 2
    expect(await verifyTOTP(RFC_SECRET, code)).toBe(false);
  });

  it('rejects a step just outside the window (+2) — window edge', async () => {
    freezeAt(60); // counter = 2
    const code = await hotp(key, 4); // counter + 2
    expect(await verifyTOTP(RFC_SECRET, code)).toBe(false);
  });

  it('window=0 rejects an otherwise-valid neighbouring-step code', async () => {
    freezeAt(60); // counter = 2
    const prevCode = await hotp(key, 1); // counter − 1
    // Valid under default window, but rejected when tolerance is 0.
    expect(await verifyTOTP(RFC_SECRET, prevCode, 1)).toBe(true);
    expect(await verifyTOTP(RFC_SECRET, prevCode, 0)).toBe(false);
  });

  it('a wider window accepts a step the default window rejects', async () => {
    freezeAt(60); // counter = 2
    const farCode = await hotp(key, 5); // counter + 3
    expect(await verifyTOTP(RFC_SECRET, farCode)).toBe(false); // default ±1
    expect(await verifyTOTP(RFC_SECRET, farCode, 3)).toBe(true); // ±3
  });

  it('an expired code (used a full step later) falls outside a window=0 check', async () => {
    // Generate the code valid at counter 2 ...
    const code = await hotp(key, 2);
    freezeAt(60);
    expect(await verifyTOTP(RFC_SECRET, code, 0)).toBe(true);
    vi.restoreAllMocks();
    // ... then two steps later it is expired even though it once was valid.
    freezeAt(120); // counter = 4
    expect(await verifyTOTP(RFC_SECRET, code, 1)).toBe(false);
  });
});
