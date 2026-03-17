/**
 * Password hashing — PBKDF2-SHA256 via Web Crypto API
 *
 * Workers-compatible (no native modules needed).
 * Format: `pbkdf2:sha256:100000:{salt_base64}:{hash_base64}`
 *
 * Also supports verifying imported password hashes:
 *   - bcrypt ($2a$, $2b$, $2y$) via bcryptjs (pure JS, Workers-compatible)
 *   - Lazy re-hashing: needsRehash() returns true for non-PBKDF2 formats
 */
import bcrypt from 'bcryptjs';

// ─── Constants ───

const ALGORITHM = 'PBKDF2';
const HASH_ALGO = 'SHA-256';
// Cloudflare Workers' WebCrypto PBKDF2 currently rejects iteration counts above 100000.
const ITERATIONS = 100_000;
const SALT_LENGTH = 16;          // 128-bit salt
const KEY_LENGTH = 32;           // 256-bit derived key

// ─── Helpers ───

function toBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// ─── Public API ───

/**
 * Hash a password using PBKDF2-SHA256.
 * Returns a self-describing string: `pbkdf2:sha256:{iterations}:{salt_b64}:{hash_b64}`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    ALGORITHM,
    false,
    ['deriveBits'],
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: ALGORITHM,
      salt,
      iterations: ITERATIONS,
      hash: HASH_ALGO,
    },
    keyMaterial,
    KEY_LENGTH * 8,  // bits
  );

  return `pbkdf2:sha256:${ITERATIONS}:${toBase64(salt.buffer)}:${toBase64(hash)}`;
}

/**
 * Verify a password against a stored hash.
 * Supports:
 *   - pbkdf2:sha256:{iterations}:{salt_b64}:{hash_b64} (native format)
 *   - $2a$... / $2b$... / $2y$... (bcrypt, imported hashes)
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  // Native PBKDF2 format
  if (storedHash.startsWith('pbkdf2:')) {
    return verifyPBKDF2(password, storedHash);
  }

  // bcrypt format ($2a$, $2b$, $2y$)
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    return bcrypt.compareSync(password, storedHash);
  }

  // Unknown format — reject
  return false;
}

/**
 * Check if a stored hash needs to be re-hashed to the native format.
 * Returns true for non-PBKDF2 formats (bcrypt, etc.).
 */
export function needsRehash(storedHash: string): boolean {
  return !storedHash.startsWith('pbkdf2:');
}

/**
 * Check if a string is a recognized password hash format.
 * Used during import to distinguish pre-hashed passwords from plaintext.
 */
export function isPasswordHash(value: string): boolean {
  if (value.startsWith('pbkdf2:sha256:')) return true;
  if (value.startsWith('$2a$') || value.startsWith('$2b$') || value.startsWith('$2y$')) return true;
  return false;
}

// ─── PBKDF2 Verification (internal) ───

async function verifyPBKDF2(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') {
    return false;
  }

  const iterations = parseInt(parts[2], 10);
  const salt = fromBase64(parts[3]);
  const expectedHash = fromBase64(parts[4]);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    ALGORITHM,
    false,
    ['deriveBits'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: ALGORITHM,
      salt: salt as unknown as BufferSource,
      iterations,
      hash: HASH_ALGO,
    },
    keyMaterial,
    KEY_LENGTH * 8,
  );

  // Constant-time comparison to prevent timing attacks
  const derived = new Uint8Array(derivedBits);
  if (derived.length !== expectedHash.length) return false;

  let diff = 0;
  for (let i = 0; i < derived.length; i++) {
    diff |= derived[i] ^ expectedHash[i];
  }
  return diff === 0;
}
