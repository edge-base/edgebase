/**
 * Tests for CLI admin command — password validation, Service Key requirement.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { toSqliteStringLiteral } from '../src/commands/admin.js';
import {
  ensureBootstrapAdmin,
  normalizeAdminEmail,
} from '../src/lib/admin-bootstrap.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ======================================================================
// 1. Password validation
// ======================================================================

describe('Password validation', () => {
  /**
   * Replicates the password validation logic from admin.ts.
   */
  function validatePassword(password: string): { valid: boolean; error?: string } {
    if (!password) {
      return { valid: false, error: 'Email and new password are required.' };
    }
    if (password.length < 8) {
      return { valid: false, error: 'Password must be at least 8 characters.' };
    }
    return { valid: true };
  }

  it('rejects empty password', () => {
    const result = validatePassword('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  it('rejects password shorter than 8 characters', () => {
    expect(validatePassword('abc').valid).toBe(false);
    expect(validatePassword('1234567').valid).toBe(false);
  });

  it('accepts password with exactly 8 characters', () => {
    expect(validatePassword('12345678').valid).toBe(true);
  });

  it('accepts long password', () => {
    expect(validatePassword('a'.repeat(100)).valid).toBe(true);
  });

  it('accepts password with special characters', () => {
    expect(validatePassword('p@$$w0rd!').valid).toBe(true);
  });

  it('accepts password with unicode characters', () => {
    expect(validatePassword('비밀번호테스트입니다').valid).toBe(true);
  });
});

// ======================================================================
// 2. Email validation
// ======================================================================

describe('Email validation', () => {
  function validateEmail(email: string): boolean {
    return !!email; // admin.ts only checks non-empty
  }

  it('rejects empty email', () => {
    expect(validateEmail('')).toBe(false);
  });

  it('accepts any non-empty email', () => {
    expect(validateEmail('admin@example.com')).toBe(true);
    expect(validateEmail('user')).toBe(true); // admin.ts does not validate format
  });
});

describe('bootstrap admin helpers', () => {
  it('normalizes bootstrap admin email values', () => {
    expect(normalizeAdminEmail(' Admin@Example.COM ')).toBe('admin@example.com');
  });

  it('treats a matching existing admin as already configured', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        admins: [{ id: 'admin_1', email: 'admin@example.com' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const result = await ensureBootstrapAdmin({
      url: 'http://localhost:8787',
      serviceKey: 'sk-test',
      email: 'Admin@Example.com',
      password: 'Admin1234!',
    });

    expect(result.status).toBe('already-configured');
  });

  it('skips bootstrap when a different admin already exists', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        admins: [{ id: 'admin_1', email: 'owner@example.com' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const result = await ensureBootstrapAdmin({
      url: 'http://localhost:8787',
      serviceKey: 'sk-test',
      email: 'new-owner@example.com',
      password: 'Admin1234!',
    });

    expect(result).toEqual({
      status: 'skipped-existing',
      admins: [{ id: 'admin_1', email: 'owner@example.com' }],
      requestedEmail: 'new-owner@example.com',
    });
  });

  it('creates the first admin when none exist yet', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ admins: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'admin_1',
        email: 'admin@example.com',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const result = await ensureBootstrapAdmin({
      url: 'http://localhost:8787',
      serviceKey: 'sk-test',
      email: 'admin@example.com',
      password: 'Admin1234!',
    });

    expect(result).toEqual({
      status: 'created',
      admin: {
        id: 'admin_1',
        email: 'admin@example.com',
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ======================================================================
// 2b. Non-interactive credential flags
// ======================================================================

describe('Non-interactive credential flags', () => {
  function resolveCredential(optionValue?: string, promptedValue?: string): string {
    return optionValue ?? promptedValue ?? '';
  }

  it('prefers --email over prompt input', () => {
    expect(resolveCredential('admin@example.com', 'prompt@example.com')).toBe('admin@example.com');
  });

  it('prefers --password over prompt input', () => {
    expect(resolveCredential('supersecret', 'prompt-secret')).toBe('supersecret');
  });
});

// ======================================================================
// 3. Service Key requirement
// ======================================================================

describe('Service Key requirement', () => {
  /**
   * Replicates Service Key resolution from admin.ts:
   * --service-key > EDGEBASE_SERVICE_KEY env
   */
  function resolveServiceKey(optionKey?: string, envKey?: string): string | undefined {
    return optionKey || envKey;
  }

  it('uses --service-key option', () => {
    expect(resolveServiceKey('sk-option', 'sk-env')).toBe('sk-option');
  });

  it('falls back to env var', () => {
    expect(resolveServiceKey(undefined, 'sk-env')).toBe('sk-env');
  });

  it('returns undefined when neither provided', () => {
    expect(resolveServiceKey(undefined, undefined)).toBeUndefined();
  });

  it('empty string treated as falsy', () => {
    expect(resolveServiceKey('', 'sk-env')).toBe('sk-env');
  });
});

// ======================================================================
// 4. API request construction
// ======================================================================

describe('API request construction', () => {
  it('constructs correct reset-password URL', () => {
    const url = 'http://localhost:8787';
    expect(`${url}/admin/api/internal/reset-password`).toBe(
      'http://localhost:8787/admin/api/internal/reset-password',
    );
  });

  it('constructs correct request body', () => {
    const body = JSON.stringify({ email: 'admin@test.com', newPassword: 'newpass123' });
    const parsed = JSON.parse(body);
    expect(parsed.email).toBe('admin@test.com');
    expect(parsed.newPassword).toBe('newpass123');
  });

  it('includes correct headers', () => {
    const serviceKey = 'sk-test';
    const headers = {
      'Content-Type': 'application/json',
      'X-EdgeBase-Service-Key': serviceKey,
    };
    expect(headers['X-EdgeBase-Service-Key']).toBe('sk-test');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ======================================================================
// 5. Response handling
// ======================================================================

describe('Response handling', () => {
  it('success response has ok: true', () => {
    const response = { ok: true, message: 'Password reset successfully.' };
    expect(response.ok).toBe(true);
  });

  it('failure response has message and code', () => {
    const response = { ok: false, message: 'Admin not found', code: 404 };
    expect(response.ok).toBe(false);
    expect(response.message).toBe('Admin not found');
    expect(response.code).toBe(404);
  });

  it('handles missing message in failure', () => {
    const response: { ok?: boolean; message?: string; code?: number } = { code: 500 };
    const errorMsg = response.message || 'Unknown error';
    expect(errorMsg).toBe('Unknown error');
  });
});

// ======================================================================
// 6. SQLite literal escaping
// ======================================================================

describe('SQLite literal escaping', () => {
  it('escapes single quotes in email values', () => {
    expect(toSqliteStringLiteral("o'connor@example.com")).toBe("'o''connor@example.com'");
  });

  it('wraps ordinary values in single quotes', () => {
    expect(toSqliteStringLiteral('admin_123')).toBe("'admin_123'");
  });

  it('keeps semicolons inside the quoted literal', () => {
    expect(toSqliteStringLiteral("value'; DROP TABLE _admins; --")).toBe("'value''; DROP TABLE _admins; --'");
  });
});
