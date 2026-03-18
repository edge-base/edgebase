/**
 * Password Policy — validates passwords against configurable rules + HIBP k-anonymity check.
 *
 * HIBP: Uses k-anonymity (first 5 chars of SHA-1 hash) to check if password has been leaked.
 * Fail-open: If the HIBP API is unavailable, the password is accepted (no false negatives).
 */
import type { PasswordPolicyConfig } from '@edgebase-fun/shared';

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a password against the configured policy.
 * Returns { valid: true } if all checks pass, or { valid: false, errors: [...] } with all failures.
 */
export async function validatePassword(
  password: string,
  policy?: PasswordPolicyConfig,
): Promise<PasswordValidationResult> {
  const errors: string[] = [];

  // Default minLength is 8 regardless of policy config
  const minLength = policy?.minLength ?? 8;

  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters.`);
  }

  if (policy?.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter.');
  }

  if (policy?.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter.');
  }

  if (policy?.requireNumber && !/\d/.test(password)) {
    errors.push('Password must contain at least one digit.');
  }

  if (policy?.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character.');
  }

  // HIBP check (k-anonymity, fail-open)
  if (policy?.checkLeaked && errors.length === 0) {
    const leaked = await checkHIBP(password);
    if (leaked) {
      errors.push('This password has been found in a data breach. Please choose a different password.');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a password has been leaked using HIBP's k-anonymity API.
 * Returns true if the password is found in the breach database.
 * Fail-open: returns false on any error (network, timeout, etc.).
 */
async function checkHIBP(password: string): Promise<boolean> {
  try {
    // SHA-1 hash the password
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

    const prefix = hashHex.substring(0, 5);
    const suffix = hashHex.substring(5);

    // Fetch range from HIBP API (k-anonymity: only send first 5 chars)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout

    const resp = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'EdgeBase-PasswordPolicy' },
    });
    clearTimeout(timeout);

    if (!resp.ok) return false; // fail-open

    const text = await resp.text();
    // Each line is "SUFFIX:COUNT"
    const lines = text.split('\n');
    for (const line of lines) {
      const [lineSuffix] = line.trim().split(':');
      if (lineSuffix === suffix) {
        return true; // password found in breach
      }
    }

    return false;
  } catch {
    // Fail-open: network error, timeout, etc.
    return false;
  }
}
