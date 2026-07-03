const encoder = new TextEncoder();

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function hmacSha256Hex(key: string, value: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
  return toHex(signature);
}

export async function hashAuthSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return `sha256:${toHex(digest)}`;
}

export async function authSecretLookupKeys(secret: string): Promise<string[]> {
  const hashed = await hashAuthSecret(secret);
  return secret.startsWith('sha256:') ? [secret] : [hashed, secret];
}

export async function verifyAuthSecret(secret: string, storedHash: string): Promise<boolean> {
  const candidate = await hashAuthSecret(secret);
  return timingSafeStringEqual(candidate, storedHash);
}

export async function hashOtpSecret(otp: string, serverSecret: string): Promise<string> {
  const digest = await hmacSha256Hex(serverSecret, `edgebase:auth:otp:${otp}`);
  return `hmac-sha256:${digest}`;
}

export async function verifyOtpSecret(
  otp: string,
  storedHash: string,
  serverSecret: string,
): Promise<boolean> {
  if (storedHash.startsWith('hmac-sha256:')) {
    const candidate = await hashOtpSecret(otp, serverSecret);
    return timingSafeStringEqual(candidate, storedHash);
  }

  // Backward compatibility for short-lived OTPs stored before HMAC hashing.
  if (storedHash.startsWith('sha256:')) {
    return verifyAuthSecret(otp, storedHash);
  }

  return false;
}
