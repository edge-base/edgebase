import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgAuthDb } from '../lib/auth-db-adapter.js';
import {
  confirmAnon,
  confirmEmail,
  createAdmin,
  createAdminSession,
  deleteEmailPending,
  deleteOAuthPending,
  deletePhonePending,
  ensureAuthSchema,
  getAdminByEmail,
  getAdminSessionById,
  getUserPublic,
  hashAdminRefreshToken,
  lookupEmail,
  lookupOAuth,
  registerEmailPending,
  registerAnonPending,
  registerOAuthPending,
  registerPhonePending,
  resetSchemaInit,
  rotateAdminSession,
  upsertUserPublic,
} from '../lib/auth-d1.js';
import {
  createOAuthAccount,
  createPasskeyIdentity,
  createEmailToken,
  createSession,
  createUser,
  deleteProvisionalUser,
  deletePasskeyIdentity,
  deleteOAuthIdentity,
  completeMfaRecoveryChallenge,
  completeMfaTotpChallenge,
  completePasskeyAuthentication,
  consumeAuthChallenge,
  consumeEmailToken,
  finalizeOAuthIdentity,
  finalizeEmailIdentity,
  finalizePhoneIdentity,
  finalizeManagedUserCreation,
  finalizeManagedUserUpdate,
  finalizeAnonymousEmailUpgrade,
  finalizeAnonymousPhoneUpgrade,
  getAuthChallenge,
  getEmailLinkUpgradeCompletion,
  getPhoneLinkUpgradeCompletion,
  getOAuthAccount,
  getSessionByRefreshToken,
  getUserById,
  listUsers,
  issueAuthChallenge,
  recordAuthChallengeFailure,
  rotateRefreshToken,
  storeWebAuthnChallenge,
  updateUser,
} from '../lib/auth-d1-service.js';

const postgresUrl = process.env.EDGEBASE_TEST_POSTGRES_URL;
const describePostgres = postgresUrl ? describe : describe.skip;

describePostgres('PostgreSQL auth compatibility and atomicity', () => {
  const schema = `auth_review_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  let adminClient: Client;
  let db: PgAuthDb;

  beforeAll(async () => {
    adminClient = new Client({ connectionString: postgresUrl! });
    await adminClient.connect();
    await adminClient.query(`CREATE SCHEMA ${schema}`);

    const scopedUrl = new URL(postgresUrl!);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    db = new PgAuthDb(scopedUrl.toString());
    // Simulate an existing pre-reservation deployment so ensureAuthSchema must
    // apply the additive reservationId migrations rather than relying on a
    // fresh CREATE TABLE.
    await db.run(`CREATE TABLE _email_index (
      email TEXT PRIMARY KEY, userId TEXT NOT NULL, shardId INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', createdAt TEXT NOT NULL
    )`);
    await db.run(`CREATE TABLE _oauth_index (
      provider TEXT NOT NULL, providerUserId TEXT NOT NULL, userId TEXT NOT NULL,
      shardId INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      createdAt TEXT NOT NULL, PRIMARY KEY (provider, providerUserId)
    )`);
    await db.run(`CREATE TABLE _phone_index (
      phone TEXT PRIMARY KEY, userId TEXT NOT NULL, shardId INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', createdAt TEXT NOT NULL
    )`);
    await db.run(`CREATE TABLE _users (
      id TEXT PRIMARY KEY, email TEXT, passwordHash TEXT, displayName TEXT,
      avatarUrl TEXT, emailVisibility TEXT DEFAULT 'private', role TEXT DEFAULT 'user',
      verified INTEGER DEFAULT 0, isAnonymous INTEGER DEFAULT 0, customClaims TEXT,
      phone TEXT, phoneVerified INTEGER DEFAULT 0, metadata TEXT, appMetadata TEXT,
      disabled INTEGER DEFAULT 0, status TEXT DEFAULT 'active', locale TEXT DEFAULT 'en',
      lastSignedInAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )`);
    await db.run(`CREATE TABLE _webauthn_credentials (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, credentialId TEXT NOT NULL,
      credentialPublicKey TEXT NOT NULL, counter INTEGER DEFAULT 0,
      transports TEXT, createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES _users(id)
    )`);
    resetSchemaInit();
    await ensureAuthSchema(db);
  }, 30_000);

  afterAll(async () => {
    if (adminClient) {
      await adminClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await adminClient.end();
    }
    resetSchemaInit();
  });

  it('initializes schema and returns canonical camelCase user/admin/public rows', async () => {
    const migratedColumns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = ? AND table_name IN ('_email_index', '_oauth_index', '_phone_index')
         AND column_name = 'reservationid'`,
      [schema],
    );
    expect(migratedColumns).toHaveLength(3);
    const userMigrationColumns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = ? AND table_name = '_users'
         AND column_name IN ('authrevision', 'authmutationid')`,
      [schema],
    );
    expect(userMigrationColumns).toHaveLength(2);
    const counterColumn = await db.first<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = ? AND table_name = '_webauthn_credentials'
         AND column_name = 'counter'`,
      [schema],
    );
    expect(counterColumn?.data_type).toBe('bigint');

    const user = await createUser(db, {
      userId: 'shape-user',
      email: 'shape@example.com',
      passwordHash: 'password-hash',
      displayName: 'Shape User',
      avatarUrl: 'https://example.com/avatar.png',
      verified: true,
      metadata: { source: 'test' },
    });
    expect(user).toMatchObject({
      id: 'shape-user',
      passwordHash: 'password-hash',
      displayName: 'Shape User',
      avatarUrl: 'https://example.com/avatar.png',
      isAnonymous: 0,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(user).not.toHaveProperty('passwordhash');
    await expect(updateUser(db, 'shape-user', {
      displayName: 'Updated Shape',
      metadata: { source: 'updated' },
      disabled: false,
    })).resolves.toMatchObject({
      displayName: 'Updated Shape',
      metadata: JSON.stringify({ source: 'updated' }),
      disabled: 0,
      updatedAt: expect.any(String),
    });
    await expect(listUsers(db, 10, 0)).resolves.toMatchObject({ total: 1 });

    await createAdmin(db, 'admin-1', 'admin@example.com', 'admin-hash');
    const admin = await getAdminByEmail(db, 'admin@example.com');
    expect(admin).toMatchObject({
      id: 'admin-1',
      passwordHash: 'admin-hash',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    await upsertUserPublic(db, 'shape-user', {
      email: 'shape@example.com',
      displayName: 'First',
      avatarUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await upsertUserPublic(db, 'shape-user', {
      email: 'shape@example.com',
      displayName: 'Updated',
      avatarUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    await expect(getUserPublic(db, 'shape-user')).resolves.toMatchObject({
      id: 'shape-user',
      displayName: 'Updated',
      isAnonymous: 0,
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('supports owner-bound signup/signin and portable stale pending cleanup', async () => {
    const emailReservation = await registerEmailPending(
      db,
      'signup@example.com',
      'signup-user',
      'email-owner-signup',
    );
    await createUser(db, {
      userId: 'signup-user',
      email: 'signup@example.com',
      passwordHash: 'signup-hash',
    });
    await confirmEmail(db, 'signup@example.com', 'signup-user', emailReservation);
    await expect(lookupEmail(db, 'signup@example.com')).resolves.toEqual({
      userId: 'signup-user',
      shardId: 0,
    });

    await createSession(db, {
      id: 'signup-session',
      userId: 'signup-user',
      refreshToken: 'signup-refresh',
      expiresAt: '2099-01-01T00:00:00.000Z',
      metadata: JSON.stringify({ ip: '127.0.0.1' }),
    });
    await expect(getSessionByRefreshToken(db, 'signup-refresh', 'signup-user'))
      .resolves.toMatchObject({ matchType: 'current' });
    await expect(rotateRefreshToken(
      db,
      'signup-session',
      'signup-refresh-next',
      'signup-refresh',
      '2099-02-01T00:00:00.000Z',
    )).resolves.toBe(true);

    await db.run(
      `INSERT INTO _email_index
       (email, userId, shardId, status, reservationId, createdAt)
       VALUES (?, ?, 0, 'pending', ?, ?)`,
      ['stale@example.com', 'stale-user', 'stale-owner', '2000-01-01T00:00:00.000Z'],
    );
    await lookupEmail(db, 'missing@example.com');
    await expect(db.first(`SELECT email FROM _email_index WHERE email = ?`, ['stale@example.com']))
      .resolves.toBeNull();
  });

  it('allows exactly one reservation owner and loser cleanup cannot touch the winner', async () => {
    const emailAttempts = await Promise.allSettled([
      registerEmailPending(db, 'race@example.com', 'email-user-a', 'email-owner-a'),
      registerEmailPending(db, 'race@example.com', 'email-user-b', 'email-owner-b'),
    ]);
    expect(emailAttempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const emailWinner = emailAttempts[0].status === 'fulfilled'
      ? { userId: 'email-user-a', reservationId: 'email-owner-a' }
      : { userId: 'email-user-b', reservationId: 'email-owner-b' };
    const emailLoser = emailWinner.userId === 'email-user-a'
      ? { userId: 'email-user-b', reservationId: 'email-owner-b' }
      : { userId: 'email-user-a', reservationId: 'email-owner-a' };
    await expect(deleteEmailPending(
      db,
      'race@example.com',
      emailLoser.userId,
      emailLoser.reservationId,
    )).resolves.toBe(false);
    await expect(db.first<{ userId: string; reservationId: string }>(
      `SELECT userId, reservationId FROM _email_index WHERE email = ?`,
      ['race@example.com'],
    )).resolves.toEqual(emailWinner);

    const oauthAttempts = await Promise.allSettled([
      registerOAuthPending(db, 'google', 'provider-race', 'oauth-user-a', 'oauth-owner-a'),
      registerOAuthPending(db, 'google', 'provider-race', 'oauth-user-b', 'oauth-owner-b'),
    ]);
    expect(oauthAttempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const oauthWinner = oauthAttempts[0].status === 'fulfilled'
      ? { userId: 'oauth-user-a', reservationId: 'oauth-owner-a' }
      : { userId: 'oauth-user-b', reservationId: 'oauth-owner-b' };
    const oauthLoser = oauthWinner.userId === 'oauth-user-a'
      ? { userId: 'oauth-user-b', reservationId: 'oauth-owner-b' }
      : { userId: 'oauth-user-a', reservationId: 'oauth-owner-a' };
    await expect(deleteOAuthPending(
      db,
      'google',
      'provider-race',
      oauthLoser.userId,
      oauthLoser.reservationId,
    )).resolves.toBe(false);
    await expect(db.first<{ userId: string; reservationId: string }>(
      `SELECT userId, reservationId FROM _oauth_index
       WHERE provider = ? AND providerUserId = ?`,
      ['google', 'provider-race'],
    )).resolves.toEqual(oauthWinner);

    const phoneAttempts = await Promise.allSettled([
      registerPhonePending(db, '+15550000001', 'phone-user-a', 'phone-owner-a'),
      registerPhonePending(db, '+15550000001', 'phone-user-b', 'phone-owner-b'),
    ]);
    expect(phoneAttempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const phoneWinner = phoneAttempts[0].status === 'fulfilled'
      ? { userId: 'phone-user-a', reservationId: 'phone-owner-a' }
      : { userId: 'phone-user-b', reservationId: 'phone-owner-b' };
    const phoneLoser = phoneWinner.userId === 'phone-user-a'
      ? { userId: 'phone-user-b', reservationId: 'phone-owner-b' }
      : { userId: 'phone-user-a', reservationId: 'phone-owner-a' };
    await expect(deletePhonePending(
      db,
      '+15550000001',
      phoneLoser.userId,
      phoneLoser.reservationId,
    )).resolves.toBe(false);
    await expect(db.first<{ userId: string; reservationId: string }>(
      `SELECT userId, reservationId FROM _phone_index WHERE phone = ?`,
      ['+15550000001'],
    )).resolves.toEqual(phoneWinner);
  });

  it('finalizes user/account/index mutations atomically and rolls back account conflicts', async () => {
    const oauthReservationId = await registerOAuthPending(
      db,
      'github',
      'atomic-provider-user',
      'atomic-user',
      'oauth-owner-atomic',
    );
    const emailReservationId = await registerEmailPending(
      db,
      'atomic@example.com',
      'atomic-user',
      'email-owner-atomic',
    );
    await finalizeOAuthIdentity(db, {
      oauthAccount: {
        id: 'oauth-account-atomic',
        userId: 'atomic-user',
        provider: 'github',
        providerUserId: 'atomic-provider-user',
      },
      oauthReservationId,
      emailReservation: {
        email: 'atomic@example.com',
        userId: 'atomic-user',
        reservationId: emailReservationId,
      },
      user: {
        mode: 'create',
        input: {
          userId: 'atomic-user',
          email: 'atomic@example.com',
          passwordHash: '',
          displayName: 'Atomic User',
          verified: true,
        },
      },
    });
    await expect(lookupOAuth(db, 'github', 'atomic-provider-user')).resolves.toEqual({
      userId: 'atomic-user',
      shardId: 0,
    });
    await expect(getOAuthAccount(db, 'github', 'atomic-provider-user')).resolves.toMatchObject({
      userId: 'atomic-user',
      providerUserId: 'atomic-provider-user',
    });

    await createUser(db, {
      userId: 'heal-owner',
      email: 'heal-owner@example.com',
      passwordHash: '',
      displayName: 'Before Heal',
    });
    await createOAuthAccount(db, {
      id: 'heal-account',
      userId: 'heal-owner',
      provider: 'microsoft',
      providerUserId: 'heal-provider-user',
    });
    const healReservation = await registerOAuthPending(
      db,
      'microsoft',
      'heal-provider-user',
      'heal-owner',
      'heal-reservation',
    );
    await finalizeOAuthIdentity(db, {
      oauthAccount: {
        id: 'heal-account-retry',
        userId: 'heal-owner',
        provider: 'microsoft',
        providerUserId: 'heal-provider-user',
      },
      oauthReservationId: healReservation,
      user: {
        mode: 'update',
        userId: 'heal-owner',
        updates: { displayName: 'After Heal' },
        expectedAuthRevision: 0,
      },
    });
    await expect(getUserById(db, 'heal-owner')).resolves.toMatchObject({
      displayName: 'After Heal',
    });
    await expect(lookupOAuth(db, 'microsoft', 'heal-provider-user')).resolves.toEqual({
      userId: 'heal-owner',
      shardId: 0,
    });

    await createUser(db, {
      userId: 'account-winner',
      email: 'account-winner@example.com',
      passwordHash: '',
    });
    await createOAuthAccount(db, {
      id: 'account-winner-id',
      userId: 'account-winner',
      provider: 'discord',
      providerUserId: 'strict-conflict',
    });
    await expect(createOAuthAccount(db, {
      id: 'account-loser-id',
      userId: 'atomic-user',
      provider: 'discord',
      providerUserId: 'strict-conflict',
    })).rejects.toThrow('OAUTH_ACCOUNT_CONFLICT');

    await createUser(db, {
      userId: 'account-race-a',
      email: 'account-race-a@example.com',
      passwordHash: '',
    });
    await createUser(db, {
      userId: 'account-race-b',
      email: 'account-race-b@example.com',
      passwordHash: '',
    });
    const accountRace = await Promise.allSettled([
      createOAuthAccount(db, {
        id: 'account-race-id-a',
        userId: 'account-race-a',
        provider: 'slack',
        providerUserId: 'account-race-provider',
      }),
      createOAuthAccount(db, {
        id: 'account-race-id-b',
        userId: 'account-race-b',
        provider: 'slack',
        providerUserId: 'account-race-provider',
      }),
    ]);
    expect(accountRace.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(accountRace.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const conflictReservation = await registerOAuthPending(
      db,
      'discord',
      'strict-conflict',
      'rolled-back-user',
      'oauth-owner-rollback',
    );
    await expect(finalizeOAuthIdentity(db, {
      oauthAccount: {
        id: 'account-conflicting-finalize',
        userId: 'rolled-back-user',
        provider: 'discord',
        providerUserId: 'strict-conflict',
      },
      oauthReservationId: conflictReservation,
      user: {
        mode: 'create',
        input: {
          userId: 'rolled-back-user',
          email: 'rolled-back@example.com',
          passwordHash: '',
        },
      },
    })).rejects.toThrow();
    await expect(getUserById(db, 'rolled-back-user')).resolves.toBeNull();
    await expect(db.first<{ status: string }>(
      `SELECT status FROM _oauth_index WHERE provider = ? AND providerUserId = ?`,
      ['discord', 'strict-conflict'],
    )).resolves.toEqual({ status: 'pending' });
  });

  it('serializes user/admin CAS and concurrent maxActiveSessions transitions', async () => {
    await createAdminSession(
      db,
      'admin-session',
      'admin-1',
      'admin-refresh-current',
      '2099-01-01T00:00:00.000Z',
    );
    const adminRotations = await Promise.all([
      rotateAdminSession(
        db,
        'admin-session',
        'admin-refresh-current',
        'admin-refresh-a',
        '2099-02-01T00:00:00.000Z',
      ),
      rotateAdminSession(
        db,
        'admin-session',
        'admin-refresh-current',
        'admin-refresh-b',
        '2099-02-01T00:00:00.000Z',
      ),
    ]);
    expect(adminRotations.filter(Boolean)).toHaveLength(1);
    const adminSession = await getAdminSessionById(db, 'admin-session');
    expect([await hashAdminRefreshToken('admin-refresh-a'), await hashAdminRefreshToken('admin-refresh-b')])
      .toContain(adminSession?.refreshToken);

    await createUser(db, {
      userId: 'session-race-user',
      email: 'session-race@example.com',
      passwordHash: '',
    });
    await createSession(db, {
      id: 'expired-but-newer',
      userId: 'session-race-user',
      refreshToken: 'expired-refresh',
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    await Promise.all(Array.from({ length: 8 }, (_, index) => createSession(db, {
      id: `capped-session-${index}`,
      userId: 'session-race-user',
      refreshToken: `capped-refresh-${index}`,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }, 1)));
    const sessions = await db.query<{ id: string; expiresAt: string }>(
      `SELECT id, expiresAt FROM _sessions WHERE userId = ?`,
      ['session-race-user'],
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].expiresAt).toBe('2099-01-01T00:00:00.000Z');

    await createSession(db, {
      id: 'cas-session',
      userId: 'session-race-user',
      refreshToken: 'cas-current',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const userRotations = await Promise.all([
      rotateRefreshToken(db, 'cas-session', 'cas-a', 'cas-current', '2099-02-01T00:00:00.000Z'),
      rotateRefreshToken(db, 'cas-session', 'cas-b', 'cas-current', '2099-02-01T00:00:00.000Z'),
    ]);
    expect(userRotations.filter(Boolean)).toHaveLength(1);
  });

  it('rolls back provisional users owner-safely without deleting a newer index winner', async () => {
    await createUser(db, {
      userId: 'provisional-user',
      email: 'winner@example.com',
      passwordHash: '',
    });
    await createSession(db, {
      id: 'provisional-session',
      userId: 'provisional-user',
      refreshToken: 'provisional-refresh',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    await db.run(
      `INSERT INTO _email_index
       (email, userId, shardId, status, reservationId, createdAt)
       VALUES (?, ?, 0, 'pending', ?, ?)`,
      ['winner@example.com', 'new-winner', 'winner-reservation', new Date().toISOString()],
    );

    await deleteProvisionalUser(db, 'provisional-user');

    await expect(getUserById(db, 'provisional-user')).resolves.toBeNull();
    await expect(db.first(`SELECT id FROM _sessions WHERE id = ?`, ['provisional-session']))
      .resolves.toBeNull();
    await expect(db.first<{ userId: string }>(
      `SELECT userId FROM _email_index WHERE email = ?`,
      ['winner@example.com'],
    )).resolves.toEqual({ userId: 'new-winner' });

    await createUser(db, {
      userId: 'pg-passkey-user',
      email: 'pg-passkey@example.com',
      passwordHash: '',
    });
    await createPasskeyIdentity(db, {
      id: 'pg-passkey-row',
      userId: 'pg-passkey-user',
      credentialId: 'pg-passkey-credential',
      credentialPublicKey: 'public-key',
    });
    await deletePasskeyIdentity(db, 'pg-passkey-credential', 'pg-passkey-user');
    await expect(db.first(
      `SELECT id FROM _webauthn_credentials WHERE credentialId = ?`,
      ['pg-passkey-credential'],
    )).resolves.toBeNull();
    await expect(db.first(
      `SELECT credentialId FROM _passkey_index WHERE credentialId = ?`,
      ['pg-passkey-credential'],
    )).resolves.toBeNull();

    await db.run(
      `INSERT INTO _webauthn_credentials
       (id, userId, credentialId, credentialPublicKey, counter, transports, createdAt)
       VALUES (?, ?, ?, ?, 0, NULL, ?)`,
      ['pg-passkey-heal-row', 'pg-passkey-user', 'pg-passkey-heal', 'public-key', new Date().toISOString()],
    );
    await createPasskeyIdentity(db, {
      id: 'pg-passkey-heal-retry',
      userId: 'pg-passkey-user',
      credentialId: 'pg-passkey-heal',
      credentialPublicKey: 'public-key',
    });
    await expect(db.first<{ userId: string }>(
      `SELECT userId FROM _passkey_index WHERE credentialId = ?`,
      ['pg-passkey-heal'],
    )).resolves.toEqual({ userId: 'pg-passkey-user' });

    await db.run(
      `INSERT INTO _passkey_index (credentialId, userId, shardId, createdAt)
       VALUES (?, ?, 0, ?)`,
      ['pg-passkey-conflict', 'another-owner', new Date().toISOString()],
    );
    await expect(createPasskeyIdentity(db, {
      id: 'pg-passkey-conflict-row',
      userId: 'pg-passkey-user',
      credentialId: 'pg-passkey-conflict',
      credentialPublicKey: 'public-key',
    })).rejects.toThrow();
    await expect(db.first(
      `SELECT id FROM _webauthn_credentials WHERE credentialId = ?`,
      ['pg-passkey-conflict'],
    )).resolves.toBeNull();

    await createUser(db, {
      userId: 'contact-user',
      email: 'contact-old@example.com',
      passwordHash: '',
    });
    await db.run(
      `INSERT INTO _email_index
       (email, userId, shardId, status, reservationId, createdAt)
       VALUES (?, ?, 0, 'confirmed', NULL, ?)`,
      ['contact-old@example.com', 'contact-user', new Date().toISOString()],
    );
    const contactEmailReservation = await registerEmailPending(
      db,
      'contact-new@example.com',
      'contact-user',
    );
    await finalizeEmailIdentity(db, {
      userId: 'contact-user',
      expectedAuthRevision: 0,
      value: 'contact-new@example.com',
      reservationId: contactEmailReservation,
      previousValue: 'contact-old@example.com',
      updates: { email: 'contact-new@example.com' },
    });
    await expect(getUserById(db, 'contact-user')).resolves.toMatchObject({
      email: 'contact-new@example.com',
    });
    await expect(lookupEmail(db, 'contact-old@example.com')).resolves.toBeNull();
    await expect(lookupEmail(db, 'contact-new@example.com')).resolves.toEqual({
      userId: 'contact-user',
      shardId: 0,
    });

    const contactPhoneReservation = await registerPhonePending(
      db,
      '+15550000002',
      'contact-user',
    );
    await finalizePhoneIdentity(db, {
      userId: 'contact-user',
      expectedAuthRevision: 1,
      value: '+15550000002',
      reservationId: contactPhoneReservation,
      updates: { phone: '+15550000002', phoneVerified: true },
    });
    await expect(getUserById(db, 'contact-user')).resolves.toMatchObject({
      phone: '+15550000002',
      phoneVerified: 1,
    });

    await createUser(db, {
      userId: 'method-guard-user',
      email: null,
      passwordHash: '',
    });
    await createOAuthAccount(db, {
      id: 'method-guard-oauth-account',
      userId: 'method-guard-user',
      provider: 'github',
      providerUserId: 'method-guard-oauth',
    });
    await db.run(
      `INSERT INTO _oauth_index
       (provider, providerUserId, userId, shardId, status, reservationId, createdAt)
       VALUES (?, ?, ?, 0, 'confirmed', NULL, ?)`,
      ['github', 'method-guard-oauth', 'method-guard-user', new Date().toISOString()],
    );
    await createPasskeyIdentity(db, {
      id: 'method-guard-passkey-row',
      userId: 'method-guard-user',
      credentialId: 'method-guard-passkey',
      credentialPublicKey: 'public-key',
    });
    const methodDeletes = await Promise.allSettled([
      deleteOAuthIdentity(db, {
        accountId: 'method-guard-oauth-account',
        userId: 'method-guard-user',
        provider: 'github',
        providerUserId: 'method-guard-oauth',
        remainingMethodGuard: { independentMethodCount: 0, includePasskeys: true, expectedAuthRevision: 0 },
      }),
      deletePasskeyIdentity(
        db,
        'method-guard-passkey',
        'method-guard-user',
        { independentMethodCount: 0, includePasskeys: true, expectedAuthRevision: 0 },
      ),
    ]);
    expect(methodDeletes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(methodDeletes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const remainingMethods = await db.first<{ count: number }>(
      `SELECT
        (SELECT COUNT(*) FROM _oauth_accounts WHERE userId = ?) +
        (SELECT COUNT(*) FROM _webauthn_credentials WHERE userId = ?) AS count`,
      ['method-guard-user', 'method-guard-user'],
    );
    expect(remainingMethods?.count).toBe(1);
  });

  it('enforces auth CAS, one-time challenges, uint32 passkey counters, and upgrade revocation', async () => {
    const suffix = crypto.randomUUID();
    const collidingUserId = `pg-managed-create-${suffix}`;
    await createUser(db, {
      userId: collidingUserId,
      email: `pg-existing-${suffix}@example.com`,
      passwordHash: 'existing',
    });
    const requestedEmail = `pg-requested-${suffix}@example.com`;
    const createReservation = await registerEmailPending(db, requestedEmail, collidingUserId);
    await expect(finalizeManagedUserCreation(db, {
      user: { userId: collidingUserId, email: requestedEmail, passwordHash: 'replacement' },
      emailReservationId: createReservation,
    })).rejects.toThrow();
    await expect(getUserById(db, collidingUserId)).resolves.toMatchObject({
      email: `pg-existing-${suffix}@example.com`,
    });

    const casUserId = `pg-cas-${suffix}`;
    const oldEmail = `pg-old-${suffix}@example.com`;
    const emailA = `pg-a-${suffix}@example.com`;
    const emailB = `pg-b-${suffix}@example.com`;
    await createUser(db, { userId: casUserId, email: oldEmail, passwordHash: 'password' });
    await db.run(
      `INSERT INTO _email_index
       (email, userId, shardId, status, reservationId, createdAt)
       VALUES (?, ?, 0, 'confirmed', NULL, ?)`,
      [oldEmail, casUserId, new Date().toISOString()],
    );
    const reservationA = await registerEmailPending(db, emailA, casUserId);
    const reservationB = await registerEmailPending(db, emailB, casUserId);
    const casResults = await Promise.allSettled([
      finalizeManagedUserUpdate(db, {
        userId: casUserId,
        expectedAuthRevision: 0,
        updates: { email: emailA },
        contacts: [{ kind: 'email', previousValue: oldEmail, nextValue: emailA, reservationId: reservationA }],
      }),
      finalizeManagedUserUpdate(db, {
        userId: casUserId,
        expectedAuthRevision: 0,
        updates: { email: emailB },
        contacts: [{ kind: 'email', previousValue: oldEmail, nextValue: emailB, reservationId: reservationB }],
      }),
    ]);
    expect(casResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(getUserById(db, casUserId)).resolves.toMatchObject({ authRevision: 1 });

    const passkeyUserId = `pg-passkey-auth-${suffix}`;
    const credentialId = `pg-passkey-auth-credential-${suffix}`;
    const challenge = `pg_passkey_auth_challenge_${suffix}`;
    await createUser(db, { userId: passkeyUserId, email: null, passwordHash: '' });
    await createPasskeyIdentity(db, {
      id: `pg-passkey-auth-row-${suffix}`,
      userId: passkeyUserId,
      credentialId,
      credentialPublicKey: 'public-key',
      counter: 0xffff_fffe,
    });
    await storeWebAuthnChallenge(db, { challenge, kind: 'authentication', userId: passkeyUserId });
    const passkeyAttempts = await Promise.allSettled([
      completePasskeyAuthentication(db, {
        challenge,
        credentialId,
        userId: passkeyUserId,
        expectedCounter: 0xffff_fffe,
        newCounter: 0xffff_ffff,
      }),
      completePasskeyAuthentication(db, {
        challenge,
        credentialId,
        userId: passkeyUserId,
        expectedCounter: 0xffff_fffe,
        newCounter: 0xffff_ffff,
      }),
    ]);
    expect(passkeyAttempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(db.first<{ counter: number }>(
      `SELECT counter FROM _webauthn_credentials WHERE credentialId = ?`,
      [credentialId],
    )).resolves.toEqual({ counter: 0xffff_ffff });

    const otpKey = `pg-otp-${suffix}`;
    await issueAuthChallenge(db, {
      kind: 'phone-otp',
      lookupKey: otpKey,
      userId: passkeyUserId,
      secretHash: 'otp-hash',
      maxAttempts: 5,
    });
    const failures = await Promise.all(
      Array.from({ length: 6 }, () => recordAuthChallengeFailure(db, 'phone-otp', otpKey)),
    );
    expect(failures.filter(Boolean)).toHaveLength(5);
    await expect(getAuthChallenge(db, 'phone-otp', otpKey)).resolves.toMatchObject({
      attempts: 5,
      maxAttempts: 5,
    });
    await expect(consumeAuthChallenge(db, 'phone-otp', otpKey)).resolves.toBeNull();
    await issueAuthChallenge(db, {
      kind: 'phone-otp',
      lookupKey: otpKey,
      userId: passkeyUserId,
      secretHash: 'replacement-hash',
    });
    const otpConsumes = await Promise.all([
      consumeAuthChallenge(db, 'phone-otp', otpKey),
      consumeAuthChallenge(db, 'phone-otp', otpKey),
    ]);
    expect(otpConsumes.filter(Boolean)).toHaveLength(1);

    const ticket = `pg-mfa-ticket-${suffix}`;
    await issueAuthChallenge(db, { kind: 'mfa-ticket', lookupKey: ticket, userId: passkeyUserId });
    const totpResults = await Promise.allSettled([
      completeMfaTotpChallenge(db, { ticket, userId: passkeyUserId, replayScope: `pg:${passkeyUserId}`, counter: 42 }),
      completeMfaTotpChallenge(db, { ticket, userId: passkeyUserId, replayScope: `pg:${passkeyUserId}`, counter: 42 }),
    ]);
    expect(totpResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const recoveryTicket = `pg-recovery-ticket-${suffix}`;
    const recoveryId = `pg-recovery-${suffix}`;
    await db.run(
      `INSERT INTO _mfa_recovery_codes (id, userId, codeHash, used, createdAt)
       VALUES (?, ?, 'hash', 0, ?)`,
      [recoveryId, passkeyUserId, new Date().toISOString()],
    );
    await issueAuthChallenge(db, { kind: 'mfa-ticket', lookupKey: recoveryTicket, userId: passkeyUserId });
    const recoveryResults = await Promise.allSettled([
      completeMfaRecoveryChallenge(db, { ticket: recoveryTicket, userId: passkeyUserId, recoveryCodeId: recoveryId }),
      completeMfaRecoveryChallenge(db, { ticket: recoveryTicket, userId: passkeyUserId, recoveryCodeId: recoveryId }),
    ]);
    expect(recoveryResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const emailToken = `pg-email-token-${suffix}`;
    await createEmailToken(db, {
      token: emailToken,
      userId: passkeyUserId,
      type: 'password-reset',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const tokenConsumes = await Promise.all([
      consumeEmailToken(db, emailToken, 'password-reset'),
      consumeEmailToken(db, emailToken, 'password-reset'),
    ]);
    expect(tokenConsumes.filter(Boolean)).toHaveLength(1);

    const anonymousUserId = `pg-anon-upgrade-${suffix}`;
    await createUser(db, { userId: anonymousUserId, email: null, passwordHash: '' });
    await updateUser(db, anonymousUserId, { isAnonymous: true });
    await createSession(db, {
      id: `pg-anon-session-a-${suffix}`,
      userId: anonymousUserId,
      refreshToken: `pg-anon-refresh-a-${suffix}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await createSession(db, {
      id: `pg-anon-session-b-${suffix}`,
      userId: anonymousUserId,
      refreshToken: `pg-anon-refresh-b-${suffix}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const upgradeEmail = `pg-upgrade-${suffix}@example.com`;
    const upgradeReservation = await registerEmailPending(db, upgradeEmail, anonymousUserId);
    await finalizeEmailIdentity(db, {
      userId: anonymousUserId,
      expectedAuthRevision: 1,
      value: upgradeEmail,
      reservationId: upgradeReservation,
      updates: { email: upgradeEmail, passwordHash: 'password', isAnonymous: false },
      deleteAnonymousIndex: true,
      revokeSessionsOnUpgrade: true,
    });
    await expect(db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM _sessions WHERE userId = ?`,
      [anonymousUserId],
    )).resolves.toEqual({ count: 0 });
  });

  it('converges concurrent anonymous phone completions on one recoverable PostgreSQL session', async () => {
    const suffix = crypto.randomUUID();
    const userId = `pg-phone-upgrade-${suffix}`;
    const phone = `+1555${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
    const reservationId = `pg-phone-reservation-${suffix}`;
    const sessionId = `pg-phone-session-${suffix}`;
    const secretHash = `hmac-sha256:${'b'.repeat(64)}`;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const completionExpiresAt = new Date(Date.now() + 300_000).toISOString();

    await createUser(db, { userId, email: null, passwordHash: '' });
    await updateUser(db, userId, { isAnonymous: true });
    await registerAnonPending(db, userId);
    await confirmAnon(db, userId);
    await createSession(db, {
      id: `pg-old-phone-session-a-${suffix}`,
      userId,
      refreshToken: `pg-old-phone-refresh-a-${suffix}`,
      expiresAt,
    });
    await createSession(db, {
      id: `pg-old-phone-session-b-${suffix}`,
      userId,
      refreshToken: `pg-old-phone-refresh-b-${suffix}`,
      expiresAt,
    });
    await issueAuthChallenge(db, {
      kind: 'phone-link-otp',
      lookupKey: phone,
      userId,
      subject: phone,
      secretHash,
    });
    const challenge = await getAuthChallenge(db, 'phone-link-otp', phone);
    expect(challenge).toBeTruthy();
    await registerPhonePending(db, phone, userId, reservationId);

    const candidates = [
      { refreshToken: `pg-replacement-phone-refresh-a-${suffix}`, encryptedCompletion: `pg-ciphertext-a-${suffix}` },
      { refreshToken: `pg-replacement-phone-refresh-b-${suffix}`, encryptedCompletion: `pg-ciphertext-b-${suffix}` },
    ];
    const attempts = await Promise.allSettled(candidates.map((candidate) =>
      finalizeAnonymousPhoneUpgrade(db, {
        userId,
        expectedAuthRevision: 1,
        phone,
        reservationId,
        challengeKey: challenge!.key,
        challengeSecretHash: secretHash,
        encryptedCompletion: candidate.encryptedCompletion,
        completionExpiresAt,
        replacementSession: {
          id: sessionId,
          userId,
          refreshToken: candidate.refreshToken,
          expiresAt,
          metadata: JSON.stringify({ source: 'pg-response-loss-test' }),
        },
      }),
    ));

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const sessions = await db.query<{ id: string; refreshToken: string }>(
      `SELECT id, refreshToken FROM _sessions WHERE userId = ?`,
      [userId],
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionId);
    const winner = candidates.find((candidate) => candidate.refreshToken === sessions[0].refreshToken);
    expect(winner).toBeTruthy();
    await expect(getPhoneLinkUpgradeCompletion(db, phone)).resolves.toMatchObject({
      kind: 'phone-link-completion',
      userId,
      subject: phone,
      secretHash,
      payload: winner!.encryptedCompletion,
    });
    await expect(getUserById(db, userId)).resolves.toMatchObject({
      phone,
      phoneVerified: 1,
      isAnonymous: 0,
      authRevision: 2,
    });
  });

  it('converges concurrent anonymous email completions on one recoverable PostgreSQL session', async () => {
    const suffix = crypto.randomUUID();
    const userId = `pg-email-upgrade-${suffix}`;
    const email = `pg-email-upgrade-${suffix}@example.com`;
    const reservationId = `pg-email-reservation-${suffix}`;
    const sessionId = `pg-email-session-${suffix}`;
    const initiatingSessionId = `pg-old-email-session-a-${suffix}`;
    const passwordHash = `pbkdf2:sha256:100000:${'e'.repeat(24)}:${'f'.repeat(44)}`;
    const passwordProof = `hmac-sha256:${'a'.repeat(64)}`;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const completionExpiresAt = new Date(Date.now() + 300_000).toISOString();

    await createUser(db, { userId, email: null, passwordHash: '' });
    await updateUser(db, userId, { isAnonymous: true });
    await registerAnonPending(db, userId);
    await confirmAnon(db, userId);
    await createSession(db, {
      id: initiatingSessionId,
      userId,
      refreshToken: `pg-old-email-refresh-a-${suffix}`,
      expiresAt,
    });
    await createSession(db, {
      id: `pg-old-email-session-b-${suffix}`,
      userId,
      refreshToken: `pg-old-email-refresh-b-${suffix}`,
      expiresAt,
    });
    await registerEmailPending(db, email, userId, reservationId);

    const candidates = [
      { refreshToken: `pg-replacement-email-refresh-a-${suffix}`, encryptedCompletion: `pg-email-ciphertext-a-${suffix}` },
      { refreshToken: `pg-replacement-email-refresh-b-${suffix}`, encryptedCompletion: `pg-email-ciphertext-b-${suffix}` },
    ];
    const attempts = await Promise.allSettled(candidates.map((candidate) =>
      finalizeAnonymousEmailUpgrade(db, {
        userId,
        initiatingSessionId,
        expectedAuthRevision: 1,
        email,
        passwordHash,
        reservationId,
        passwordProof,
        encryptedCompletion: candidate.encryptedCompletion,
        completionExpiresAt,
        replacementSession: {
          id: sessionId,
          userId,
          refreshToken: candidate.refreshToken,
          expiresAt,
          metadata: JSON.stringify({ source: 'pg-email-response-loss-test' }),
        },
      }),
    ));

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const sessions = await db.query<{ id: string; refreshToken: string }>(
      `SELECT id, refreshToken FROM _sessions WHERE userId = ?`,
      [userId],
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionId);
    const winner = candidates.find((candidate) => candidate.refreshToken === sessions[0].refreshToken);
    expect(winner).toBeTruthy();
    await expect(getEmailLinkUpgradeCompletion(db, userId, email)).resolves.toMatchObject({
      kind: 'email-link-completion',
      userId,
      subject: email,
      secretHash: passwordProof,
      payload: winner!.encryptedCompletion,
    });
    await expect(lookupEmail(db, email)).resolves.toEqual({ userId, shardId: 0 });
    await expect(getUserById(db, userId)).resolves.toMatchObject({
      email,
      passwordHash,
      isAnonymous: 0,
      authRevision: 2,
    });
    await expect(db.first(
      `SELECT userId FROM _anon_index WHERE userId = ?`,
      [userId],
    )).resolves.toBeNull();
  });
});
