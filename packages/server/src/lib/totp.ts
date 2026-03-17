/**
 * TOTP — RFC 6238 Time-Based One-Time Password implementation.
 *
 * Uses Web Crypto API (no Node.js dependencies) for Cloudflare Workers compatibility.
 * Standard: 6-digit codes, 30-second step, SHA-1 HMAC.
 */

// ─── Constants ───

const DIGITS = 6;
const STEP = 30;  // seconds
const WINDOW = 1; // accept ±1 step (covers clock skew)

// ─── Secret Generation ───

/** Generate a random TOTP secret (20 bytes = 160 bits, standard for SHA-1). */
export function generateTOTPSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/** Generate an otpauth:// URI for QR code scanning. */
export function generateTOTPUri(
  secret: string,
  email: string,
  issuer: string,
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
}

// ─── TOTP Verification ───

/**
 * Verify a TOTP code against the secret.
 * Accepts codes within ±window steps (default: ±1 = 90 second window).
 */
export async function verifyTOTP(
  secret: string,
  code: string,
  window: number = WINDOW,
): Promise<boolean> {
  if (!code || code.length !== DIGITS) return false;

  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / STEP);

  for (let i = -window; i <= window; i++) {
    const expected = await generateTOTPCode(secret, counter + i);
    if (timingSafeEqual(code, expected)) {
      return true;
    }
  }
  return false;
}

/** Generate a TOTP code for a given counter value. */
async function generateTOTPCode(secret: string, counter: number): Promise<string> {
  const key = base32Decode(secret);
  const counterBytes = new Uint8Array(8);
  const view = new DataView(counterBytes.buffer);
  view.setBigUint64(0, BigInt(counter));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const hmac = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, counterBytes),
  );

  // Dynamic truncation (RFC 4226 §5.4)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 10 ** DIGITS;
  return otp.toString().padStart(DIGITS, '0');
}

// ─── Recovery Codes ───

/**
 * Generate recovery codes (8 codes, 8 characters each).
 * Returns plaintext codes. Caller must hash them before storage.
 */
export function generateRecoveryCodes(count: number = 8): string[] {
  const codes: string[] = [];
  const charset = 'abcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars (0/o, 1/l/i)
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let code = '';
    for (const b of bytes) {
      code += charset[b % charset.length];
    }
    codes.push(code);
  }
  return codes;
}

// ─── Encryption (AES-GCM for secret storage) ───

/**
 * Encrypt the TOTP secret for storage using AES-256-GCM.
 * @param plaintext The TOTP secret to encrypt
 * @param keyMaterial The encryption key (e.g., JWT_USER_SECRET)
 */
export async function encryptSecret(plaintext: string, keyMaterial: string): Promise<string> {
  const key = await deriveEncryptionKey(keyMaterial);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded),
  );

  // Format: base64(iv + ciphertext)
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);

  return uint8ArrayToBase64(combined);
}

/**
 * Decrypt a stored TOTP secret.
 * @param encrypted Base64-encoded (iv + ciphertext)
 * @param keyMaterial The encryption key (e.g., JWT_USER_SECRET)
 */
export async function decryptSecret(encrypted: string, keyMaterial: string): Promise<string> {
  const key = await deriveEncryptionKey(keyMaterial);
  const combined = base64ToUint8Array(encrypted);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}

async function deriveEncryptionKey(keyMaterial: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(keyMaterial);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ─── Utilities ───

/** Timing-safe string comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ─── Base32 ───

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(data: Uint8Array): string {
  let result = '';
  let bits = 0;
  let buffer = 0;

  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_CHARS[(buffer >> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += BASE32_CHARS[(buffer << (5 - bits)) & 0x1f];
  }

  return result;
}

function base32Decode(encoded: string): Uint8Array {
  const cleaned = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let buffer = 0;

  for (const char of cleaned) {
    const val = BASE32_CHARS.indexOf(char);
    if (val === -1) continue;
    buffer = (buffer << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

// ─── Base64 ───

function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToUint8Array(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
