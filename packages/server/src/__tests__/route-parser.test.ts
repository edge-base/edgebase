/**
 * 서버 단위 테스트 — lib/route-parser.ts
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/route-parser.test.ts
 *
 * 테스트 대상:
 *   parseRoute — analytics route parsing
 */

import { describe, it, expect } from 'vitest';
import { parseRoute } from '../lib/route-parser.js';

// ─── A. Auth routes ─────────────────────────────────────────────────────────

describe('parseRoute — auth', () => {
  it('POST /api/auth/signup', () => {
    const r = parseRoute('POST', '/api/auth/signup');
    expect(r.category).toBe('auth');
    expect(r.subcategory).toBe('signup');
    expect(r.operation).toBe('signup');
  });

  it('POST /api/auth/signin', () => {
    const r = parseRoute('POST', '/api/auth/signin');
    expect(r.category).toBe('auth');
    expect(r.subcategory).toBe('signin');
  });

  it('POST /api/auth/signin/anonymous', () => {
    const r = parseRoute('POST', '/api/auth/signin/anonymous');
    expect(r.subcategory).toBe('signinAnonymous');
  });

  it('POST /api/auth/signin/magic-link', () => {
    const r = parseRoute('POST', '/api/auth/signin/magic-link');
    expect(r.subcategory).toBe('signinMagicLink');
  });

  it('GET /api/auth/me', () => {
    const r = parseRoute('GET', '/api/auth/me');
    expect(r.subcategory).toBe('me');
    expect(r.operation).toBe('me');
  });

  it('POST /api/auth/refresh', () => {
    const r = parseRoute('POST', '/api/auth/refresh');
    expect(r.subcategory).toBe('refresh');
  });

  it('POST /api/auth/signout', () => {
    const r = parseRoute('POST', '/api/auth/signout');
    expect(r.subcategory).toBe('signout');
  });

  it('POST /api/auth/verify-email', () => {
    const r = parseRoute('POST', '/api/auth/verify-email');
    expect(r.subcategory).toBe('verifyEmail');
  });

  it('POST /api/auth/request-password-reset', () => {
    const r = parseRoute('POST', '/api/auth/request-password-reset');
    expect(r.subcategory).toBe('passwordReset');
  });
});

// ─── B. Auth admin routes ───────────────────────────────────────────────────

describe('parseRoute — auth admin', () => {
  it('GET /api/auth/admin/users', () => {
    const r = parseRoute('GET', '/api/auth/admin/users');
    expect(r.category).toBe('auth');
    expect(r.subcategory).toBe('admin');
    expect(r.operation).toBe('getList');
  });

  it('GET /api/auth/admin/users/:id', () => {
    const r = parseRoute('GET', '/api/auth/admin/users/user-123');
    expect(r.subcategory).toBe('admin');
    expect(r.target1).toBe('user-123');
    expect(r.operation).toBe('getOne');
  });

  it('DELETE /api/auth/admin/users/:id/revoke', () => {
    const r = parseRoute('DELETE', '/api/auth/admin/users/u-1/revoke');
    expect(r.subcategory).toBe('admin:revoke');
    expect(r.operation).toBe('revoke');
  });
});

// ─── C. Auth OAuth routes ───────────────────────────────────────────────────

describe('parseRoute — auth oauth', () => {
  it('GET /api/auth/oauth/google', () => {
    const r = parseRoute('GET', '/api/auth/oauth/google');
    expect(r.subcategory).toBe('oauth');
    expect(r.target1).toBe('google');
    expect(r.operation).toBe('oauthRedirect');
  });

  it('GET /api/auth/oauth/google/callback', () => {
    const r = parseRoute('GET', '/api/auth/oauth/google/callback');
    expect(r.subcategory).toBe('oauth');
    expect(r.operation).toBe('oauthCallback');
  });
});

// ─── D. Auth passkeys & MFA ─────────────────────────────────────────────────

describe('parseRoute — auth passkeys & mfa', () => {
  it('POST /api/auth/passkeys/register', () => {
    const r = parseRoute('POST', '/api/auth/passkeys/register');
    expect(r.subcategory).toBe('passkeys');
    expect(r.operation).toBe('register');
  });

  it('GET /api/auth/passkeys (list)', () => {
    const r = parseRoute('GET', '/api/auth/passkeys');
    expect(r.subcategory).toBe('passkeys');
    expect(r.operation).toBe('list');
  });

  it('POST /api/auth/mfa/totp/enable', () => {
    const r = parseRoute('POST', '/api/auth/mfa/totp/enable');
    expect(r.subcategory).toBe('mfa');
    expect(r.operation).toBe('totp/enable');
  });

  it('GET /api/auth/mfa (list)', () => {
    const r = parseRoute('GET', '/api/auth/mfa');
    expect(r.subcategory).toBe('mfa');
    expect(r.operation).toBe('list');
  });
});

// ─── E. Auth sessions ───────────────────────────────────────────────────────

describe('parseRoute — auth sessions', () => {
  it('GET /api/auth/sessions → list', () => {
    const r = parseRoute('GET', '/api/auth/sessions');
    expect(r.subcategory).toBe('sessions');
    expect(r.operation).toBe('list');
  });

  it('DELETE /api/auth/sessions/:id → revoke', () => {
    const r = parseRoute('DELETE', '/api/auth/sessions/s-123');
    expect(r.subcategory).toBe('sessions');
    expect(r.target1).toBe('s-123');
    expect(r.operation).toBe('revoke');
  });
});

// ─── F. Database routes ─────────────────────────────────────────────────────

describe('parseRoute — db', () => {
  it('GET /api/db/app/tables/posts → getList', () => {
    const r = parseRoute('GET', '/api/db/app/tables/posts');
    expect(r.category).toBe('db');
    expect(r.target1).toBe('app');
    expect(r.target2).toBe('posts');
    expect(r.operation).toBe('getList');
  });

  it('GET /api/db/shared/tables/posts/123 → getOne', () => {
    const r = parseRoute('GET', '/api/db/shared/tables/posts/123');
    expect(r.operation).toBe('getOne');
  });

  it('POST /api/db/shared/tables/posts → insert', () => {
    const r = parseRoute('POST', '/api/db/shared/tables/posts');
    expect(r.operation).toBe('insert');
  });

  it('PUT /api/db/shared/tables/posts/123 → update', () => {
    const r = parseRoute('PUT', '/api/db/shared/tables/posts/123');
    expect(r.operation).toBe('update');
  });

  it('DELETE /api/db/shared/tables/posts/123 → delete', () => {
    const r = parseRoute('DELETE', '/api/db/shared/tables/posts/123');
    expect(r.operation).toBe('delete');
  });

  it('dynamic namespace: /api/db/workspace/ws-1/tables/tasks/t-1', () => {
    const r = parseRoute('GET', '/api/db/workspace/ws-1/tables/tasks/t-1');
    expect(r.category).toBe('db');
    expect(r.target1).toBe('workspace');
    expect(r.target2).toBe('tasks');
    expect(r.operation).toBe('getOne');
  });

  it('action after record ID', () => {
    const r = parseRoute('POST', '/api/db/shared/tables/posts/123/export');
    expect(r.operation).toBe('export');
  });
});

// ─── G. Storage routes ──────────────────────────────────────────────────────

describe('parseRoute — storage', () => {
  it('POST /api/storage/avatars/upload', () => {
    const r = parseRoute('POST', '/api/storage/avatars/upload');
    expect(r.category).toBe('storage');
    expect(r.target1).toBe('avatars');
    expect(r.subcategory).toBe('upload');
    expect(r.operation).toBe('upload');
  });

  it('GET /api/storage/avatars → list', () => {
    const r = parseRoute('GET', '/api/storage/avatars');
    expect(r.subcategory).toBe('list');
    expect(r.operation).toBe('list');
  });

  it('GET /api/storage/bucket/file.jpg → download', () => {
    const r = parseRoute('GET', '/api/storage/bucket/file.jpg');
    expect(r.subcategory).toBe('download');
    expect(r.operation).toBe('download');
  });

  it('DELETE /api/storage/bucket/file.jpg → delete', () => {
    const r = parseRoute('DELETE', '/api/storage/bucket/file.jpg');
    expect(r.operation).toBe('delete');
  });

  it('HEAD /api/storage/bucket/file.jpg → head', () => {
    const r = parseRoute('HEAD', '/api/storage/bucket/file.jpg');
    expect(r.operation).toBe('head');
  });

  it('POST /api/storage/bucket/delete-batch', () => {
    const r = parseRoute('POST', '/api/storage/bucket/delete-batch');
    expect(r.subcategory).toBe('batch');
    expect(r.operation).toBe('deleteBatch');
  });

  it('POST /api/storage/bucket/signed-url', () => {
    const r = parseRoute('POST', '/api/storage/bucket/signed-url');
    expect(r.subcategory).toBe('signedUrl');
    expect(r.operation).toBe('createSignedUrl');
  });

  it('POST /api/storage/bucket/signed-urls', () => {
    const r = parseRoute('POST', '/api/storage/bucket/signed-urls');
    expect(r.subcategory).toBe('signedUrl');
  });

  it('POST /api/storage/bucket/signed-upload-url', () => {
    const r = parseRoute('POST', '/api/storage/bucket/signed-upload-url');
    expect(r.subcategory).toBe('signedUpload');
    expect(r.operation).toBe('createSignedUploadUrl');
  });

  it('POST /api/storage/bucket/multipart/create', () => {
    const r = parseRoute('POST', '/api/storage/bucket/multipart/create');
    expect(r.subcategory).toBe('multipart');
    expect(r.operation).toBe('create');
  });

  it('GET /api/storage/bucket/uploads/123/parts', () => {
    const r = parseRoute('GET', '/api/storage/bucket/uploads/123/parts');
    expect(r.subcategory).toBe('multipart');
    expect(r.operation).toBe('listParts');
  });

  it('GET /api/storage/bucket/file.jpg/metadata', () => {
    const r = parseRoute('GET', '/api/storage/bucket/file.jpg/metadata');
    expect(r.subcategory).toBe('metadata');
    expect(r.operation).toBe('getMetadata');
  });

  it('PATCH /api/storage/bucket/file.jpg/metadata', () => {
    const r = parseRoute('PATCH', '/api/storage/bucket/file.jpg/metadata');
    expect(r.operation).toBe('updateMetadata');
  });
});

// ─── H. Database Live routes (under /api/db/) ────────────────────────────────────

describe('parseRoute — databaseLive', () => {
  it('GET /api/db/subscribe → connect', () => {
    const r = parseRoute('GET', '/api/db/subscribe');
    expect(r.category).toBe('databaseLive');
    expect(r.subcategory).toBe('connect');
    expect(r.operation).toBe('connect');
  });

  it('GET /api/db/connect-check → connectCheck', () => {
    const r = parseRoute('GET', '/api/db/connect-check');
    expect(r.category).toBe('databaseLive');
    expect(r.subcategory).toBe('connect-check');
    expect(r.operation).toBe('connectCheck');
  });

  it('POST /api/db/broadcast', () => {
    const r = parseRoute('POST', '/api/db/broadcast');
    expect(r.category).toBe('databaseLive');
    expect(r.subcategory).toBe('broadcast');
    expect(r.operation).toBe('broadcast');
  });
});

// ─── I. Push routes ─────────────────────────────────────────────────────────

describe('parseRoute — push', () => {
  it('POST /api/push/register', () => {
    const r = parseRoute('POST', '/api/push/register');
    expect(r.category).toBe('push');
    expect(r.subcategory).toBe('register');
    expect(r.operation).toBe('register');
  });

  it('POST /api/push/send', () => {
    const r = parseRoute('POST', '/api/push/send');
    expect(r.operation).toBe('send');
  });

  it('POST /api/push/send-many', () => {
    const r = parseRoute('POST', '/api/push/send-many');
    expect(r.operation).toBe('sendMany');
  });

  it('POST /api/push/broadcast', () => {
    const r = parseRoute('POST', '/api/push/broadcast');
    expect(r.operation).toBe('broadcast');
  });

  it('GET /api/push/tokens', () => {
    const r = parseRoute('GET', '/api/push/tokens');
    expect(r.operation).toBe('listTokens');
  });

  it('POST /api/push/topic/news', () => {
    const r = parseRoute('POST', '/api/push/topic/news');
    expect(r.operation).toBe('news');
  });

  it('POST /api/push/unregister', () => {
    const r = parseRoute('POST', '/api/push/unregister');
    expect(r.operation).toBe('unregister');
  });
});

// ─── J. Room routes ─────────────────────────────────────────────────────────

describe('parseRoute — room', () => {
  it('GET /api/room → connect', () => {
    const r = parseRoute('GET', '/api/room');
    expect(r.category).toBe('room');
    expect(r.subcategory).toBe('connect');
  });

  it('GET /api/room/connect-check', () => {
    const r = parseRoute('GET', '/api/room/connect-check');
    expect(r.subcategory).toBe('connect-check');
    expect(r.operation).toBe('connectCheck');
  });

  it('GET /api/room/metadata', () => {
    const r = parseRoute('GET', '/api/room/metadata');
    expect(r.subcategory).toBe('metadata');
    expect(r.operation).toBe('getMetadata');
  });

  it('GET /api/room/summary', () => {
    const r = parseRoute('GET', '/api/room/summary');
    expect(r.subcategory).toBe('summary');
    expect(r.operation).toBe('getSummary');
  });
});

// ─── K. Other feature routes ────────────────────────────────────────────────

describe('parseRoute — other features', () => {
  it('POST /api/functions/myFunc → function execute', () => {
    const r = parseRoute('POST', '/api/functions/myFunc');
    expect(r.category).toBe('function');
    expect(r.target1).toBe('myFunc');
    expect(r.operation).toBe('execute');
  });

  it('POST /api/functions/nested/path → target1 joins segments', () => {
    const r = parseRoute('POST', '/api/functions/a/b/c');
    expect(r.target1).toBe('a/b/c');
  });

  it('POST /api/kv/myNs', () => {
    const r = parseRoute('POST', '/api/kv/myNs');
    expect(r.category).toBe('kv');
    expect(r.target1).toBe('myNs');
    expect(r.operation).toBe('execute');
  });

  it('POST /api/sql', () => {
    const r = parseRoute('POST', '/api/sql');
    expect(r.category).toBe('sql');
    expect(r.operation).toBe('execute');
  });

  it('POST /api/d1', () => {
    const r = parseRoute('POST', '/api/d1');
    expect(r.category).toBe('d1');
    expect(r.operation).toBe('execute');
  });

  it('POST /api/vectorize/my-index/upsert', () => {
    const r = parseRoute('POST', '/api/vectorize/my-index/upsert');
    expect(r.category).toBe('vectorize');
    expect(r.target1).toBe('my-index');
    expect(r.operation).toBe('upsert');
  });

  it('GET /api/config', () => {
    const r = parseRoute('GET', '/api/config');
    expect(r.category).toBe('config');
    expect(r.operation).toBe('read');
  });

  it('PUT /api/config', () => {
    const r = parseRoute('PUT', '/api/config');
    expect(r.operation).toBe('write');
  });

  it('GET /api/users → other/unknown after route removal', () => {
    const r = parseRoute('GET', '/api/users');
    expect(r.category).toBe('other');
    expect(r.subcategory).toBe('users');
    expect(r.operation).toBe('unknown');
  });

  it('GET /api/users/u-1 → other/unknown after route removal', () => {
    const r = parseRoute('GET', '/api/users/u-1');
    expect(r.category).toBe('other');
    expect(r.subcategory).toBe('users');
    expect(r.operation).toBe('unknown');
  });

  it('GET /api/health', () => {
    const r = parseRoute('GET', '/api/health');
    expect(r.category).toBe('health');
    expect(r.operation).toBe('check');
  });
});

// ─── L. Admin routes ────────────────────────────────────────────────────────

describe('parseRoute — admin', () => {
  it('GET /admin/api/data/logs', () => {
    const r = parseRoute('GET', '/admin/api/data/logs');
    expect(r.category).toBe('admin');
    expect(r.subcategory).toBe('logs');
    expect(r.operation).toBe('read');
  });

  it('POST /admin/api/auth', () => {
    const r = parseRoute('POST', '/admin/api/auth');
    expect(r.category).toBe('admin');
    expect(r.subcategory).toBe('auth');
    expect(r.operation).toBe('write');
  });

  it('POST /admin/api/setup', () => {
    const r = parseRoute('POST', '/admin/api/setup');
    expect(r.subcategory).toBe('setup');
  });
});

// ─── M. Edge cases ──────────────────────────────────────────────────────────

describe('parseRoute — edge cases', () => {
  it('non-api path → other', () => {
    const r = parseRoute('GET', '/something/else');
    expect(r.category).toBe('other');
    expect(r.operation).toBe('unknown');
  });

  it('unknown feature → other', () => {
    const r = parseRoute('GET', '/api/unknown-feature');
    expect(r.category).toBe('other');
    expect(r.subcategory).toBe('unknown-feature');
  });

  it('lowercase method is uppercased', () => {
    const r = parseRoute('get', '/api/health');
    expect(r.operation).toBe('check');
  });

  it('PATCH method → update', () => {
    const r = parseRoute('PATCH', '/api/db/shared/tables/posts/123');
    expect(r.operation).toBe('update');
  });

  it('OPTIONS method → unknown', () => {
    const r = parseRoute('OPTIONS', '/api/db/shared/tables/posts');
    expect(r.operation).toBe('unknown');
  });
});
