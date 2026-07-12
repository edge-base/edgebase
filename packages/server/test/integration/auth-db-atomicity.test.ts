import { beforeAll, describe, expect, it } from 'vitest';
import { D1AuthDb } from '../../src/lib/auth-db-adapter.js';
import {
  ensureAuthSchema,
  confirmAnon,
  deletePhonePending,
  lookupEmail,
  lookupOAuth,
  registerEmailPending,
  registerAnonPending,
  registerOAuthPending,
  registerPhonePending,
  resetSchemaInit,
} from '../../src/lib/auth-d1.js';
import {
  createOAuthAccount,
  createPasskeyIdentity,
  createEmailToken,
  createUser,
  completeMfaRecoveryChallenge,
  completeMfaTotpChallenge,
  completePasskeyAuthentication,
  consumeAuthChallenge,
  consumeEmailToken,
  deletePasskeyIdentity,
  deleteAllUserSessions,
  deleteOAuthIdentity,
  deleteProvisionalUser,
  finalizeOAuthIdentity,
  finalizeManagedUserCreation,
  finalizeManagedUserUpdate,
  finalizeAnonymousEmailUpgrade,
  finalizeAnonymousPhoneUpgrade,
  getAuthChallenge,
  getEmailLinkUpgradeCompletion,
  getPhoneLinkUpgradeCompletion,
  getWebAuthnChallenge,
  getUserById,
  issueAuthChallenge,
  recordAuthChallengeFailure,
  storeWebAuthnChallenge,
  updateUser,
} from '../../src/lib/auth-d1-service.js';
import { signAccessToken, TokenInvalidError } from '../../src/lib/jwt.js';
import { resolveAuthContextFromToken } from '../../src/middleware/auth.js';

describe('auth database atomic identity finalization (D1)', () => {
  let db: D1AuthDb;

  beforeAll(async () => {
    db = new D1AuthDb((globalThis as any).env.AUTH_DB as D1Database);
    resetSchemaInit();
    await ensureAuthSchema(db);
  });

  it('heals a same-owner account/index split without duplicating the account', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-heal-user-${suffix}`;
    const providerUserId = `d1-heal-provider-${suffix}`;
    await createUser(db, {
      userId,
      email: `d1-heal-${suffix}@example.com`,
      passwordHash: '',
      displayName: 'Before Heal',
    });
    await createOAuthAccount(db, {
      id: `d1-heal-account-${suffix}`,
      userId,
      provider: 'microsoft',
      providerUserId,
    });
    const reservationId = await registerOAuthPending(
      db,
      'microsoft',
      providerUserId,
      userId,
    );

    await finalizeOAuthIdentity(db, {
      oauthAccount: {
        id: `d1-heal-account-retry-${suffix}`,
        userId,
        provider: 'microsoft',
        providerUserId,
      },
      oauthReservationId: reservationId,
      user: {
        mode: 'update',
        userId,
        updates: { displayName: 'After Heal' },
        expectedAuthRevision: 0,
      },
    });

    await expect(getUserById(db, userId)).resolves.toMatchObject({ displayName: 'After Heal' });
    await expect(lookupOAuth(db, 'microsoft', providerUserId)).resolves.toEqual({
      userId,
      shardId: 0,
    });
    const accountCount = await db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM _oauth_accounts
       WHERE provider = ? AND providerUserId = ?`,
      ['microsoft', providerUserId],
    );
    expect(accountCount?.count).toBe(1);
  });

  it('does not mutate a losing user when the actual identity belongs to another owner', async () => {
    const suffix = crypto.randomUUID();
    const winnerId = `d1-winner-${suffix}`;
    const loserId = `d1-loser-${suffix}`;
    const providerUserId = `d1-conflict-provider-${suffix}`;
    await createUser(db, {
      userId: winnerId,
      email: `d1-winner-${suffix}@example.com`,
      passwordHash: '',
    });
    await createUser(db, {
      userId: loserId,
      email: `d1-loser-${suffix}@example.com`,
      passwordHash: '',
      displayName: 'Unchanged Loser',
    });
    await createOAuthAccount(db, {
      id: `d1-winner-account-${suffix}`,
      userId: winnerId,
      provider: 'discord',
      providerUserId,
    });
    const loserReservation = await registerOAuthPending(
      db,
      'discord',
      providerUserId,
      loserId,
    );

    await expect(finalizeOAuthIdentity(db, {
      oauthAccount: {
        id: `d1-loser-account-${suffix}`,
        userId: loserId,
        provider: 'discord',
        providerUserId,
      },
      oauthReservationId: loserReservation,
      user: {
        mode: 'update',
        userId: loserId,
        updates: { displayName: 'Must Not Persist' },
        expectedAuthRevision: 0,
      },
    })).rejects.toThrow('OAUTH_FINALIZATION_CONFLICT');

    await expect(getUserById(db, loserId)).resolves.toMatchObject({
      displayName: 'Unchanged Loser',
    });
    await expect(db.first<{ userId: string; status: string }>(
      `SELECT userId, status FROM _oauth_index
       WHERE provider = ? AND providerUserId = ?`,
      ['discord', providerUserId],
    )).resolves.toEqual({ userId: loserId, status: 'pending' });
    await expect(db.first<{ userId: string }>(
      `SELECT userId FROM _oauth_accounts WHERE provider = ? AND providerUserId = ?`,
      ['discord', providerUserId],
    )).resolves.toEqual({ userId: winnerId });
  });

  it('serializes phone reservations and loser cleanup preserves the winner', async () => {
    const phone = `+1555${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
    const attempts = await Promise.allSettled([
      registerPhonePending(db, phone, 'd1-phone-user-a', 'd1-phone-owner-a'),
      registerPhonePending(db, phone, 'd1-phone-user-b', 'd1-phone-owner-b'),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const winner = attempts[0].status === 'fulfilled'
      ? { userId: 'd1-phone-user-a', reservationId: 'd1-phone-owner-a' }
      : { userId: 'd1-phone-user-b', reservationId: 'd1-phone-owner-b' };
    const loser = winner.userId === 'd1-phone-user-a'
      ? { userId: 'd1-phone-user-b', reservationId: 'd1-phone-owner-b' }
      : { userId: 'd1-phone-user-a', reservationId: 'd1-phone-owner-a' };
    await expect(deletePhonePending(db, phone, loser.userId, loser.reservationId))
      .resolves.toBe(false);
    await expect(db.first<{ userId: string; reservationId: string }>(
      `SELECT userId, reservationId FROM _phone_index WHERE phone = ?`,
      [phone],
    )).resolves.toEqual(winner);
  });

  it('rolls back passkey index/credential splits and deletes both atomically', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-passkey-user-${suffix}`;
    const credentialId = `d1-passkey-${suffix}`;
    await createUser(db, {
      userId,
      email: `d1-passkey-${suffix}@example.com`,
      passwordHash: '',
    });

    await createPasskeyIdentity(db, {
      id: `d1-passkey-row-${suffix}`,
      userId,
      credentialId,
      credentialPublicKey: 'public-key',
    });
    await expect(db.first(`SELECT credentialId FROM _passkey_index WHERE credentialId = ?`, [credentialId]))
      .resolves.toBeTruthy();
    await deletePasskeyIdentity(db, credentialId, userId);
    await expect(db.first(`SELECT id FROM _webauthn_credentials WHERE credentialId = ?`, [credentialId]))
      .resolves.toBeNull();
    await expect(db.first(`SELECT credentialId FROM _passkey_index WHERE credentialId = ?`, [credentialId]))
      .resolves.toBeNull();

    const healCredential = `d1-passkey-heal-${suffix}`;
    await db.run(
      `INSERT INTO _webauthn_credentials
       (id, userId, credentialId, credentialPublicKey, counter, transports, createdAt)
       VALUES (?, ?, ?, ?, 0, NULL, ?)`,
      [`d1-passkey-heal-row-${suffix}`, userId, healCredential, 'public-key', new Date().toISOString()],
    );
    await createPasskeyIdentity(db, {
      id: `d1-passkey-heal-retry-${suffix}`,
      userId,
      credentialId: healCredential,
      credentialPublicKey: 'public-key',
    });
    await expect(db.first<{ userId: string }>(
      `SELECT userId FROM _passkey_index WHERE credentialId = ?`,
      [healCredential],
    )).resolves.toEqual({ userId });

    const conflictingCredential = `d1-passkey-conflict-${suffix}`;
    await db.run(
      `INSERT INTO _passkey_index (credentialId, userId, shardId, createdAt) VALUES (?, ?, 0, ?)`,
      [conflictingCredential, 'other-owner', new Date().toISOString()],
    );
    await expect(createPasskeyIdentity(db, {
      id: `d1-passkey-conflicting-row-${suffix}`,
      userId,
      credentialId: conflictingCredential,
      credentialPublicKey: 'public-key',
    })).rejects.toThrow();
    await expect(db.first(
      `SELECT id FROM _webauthn_credentials WHERE credentialId = ?`,
      [conflictingCredential],
    )).resolves.toBeNull();
  });

  it('provisional cleanup removes user/session but preserves another owner index row', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-provisional-${suffix}`;
    const email = `d1-provisional-${suffix}@example.com`;
    await createUser(db, { userId, email, passwordHash: '' });
    await db.run(
      `INSERT INTO _sessions (id, userId, refreshToken, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [`d1-provisional-session-${suffix}`, userId, `refresh-${suffix}`, '2099-01-01', new Date().toISOString()],
    );
    await db.run(
      `INSERT INTO _email_index
       (email, userId, shardId, status, reservationId, createdAt)
       VALUES (?, ?, 0, 'pending', ?, ?)`,
      [email, 'new-owner', `new-owner-reservation-${suffix}`, new Date().toISOString()],
    );

    await deleteProvisionalUser(db, userId);

    await expect(getUserById(db, userId)).resolves.toBeNull();
    await expect(db.first<{ userId: string }>(
      `SELECT userId FROM _email_index WHERE email = ?`,
      [email],
    )).resolves.toEqual({ userId: 'new-owner' });
  });

  it('serializes concurrent OAuth/passkey deletion so one sign-in method always remains', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-method-guard-${suffix}`;
    const providerUserId = `d1-method-oauth-${suffix}`;
    const credentialId = `d1-method-passkey-${suffix}`;
    await createUser(db, {
      userId,
      email: null,
      passwordHash: '',
    });
    await createOAuthAccount(db, {
      id: `d1-method-account-${suffix}`,
      userId,
      provider: 'github',
      providerUserId,
    });
    await db.run(
      `INSERT INTO _oauth_index
       (provider, providerUserId, userId, shardId, status, reservationId, createdAt)
       VALUES (?, ?, ?, 0, 'confirmed', NULL, ?)`,
      ['github', providerUserId, userId, new Date().toISOString()],
    );
    await createPasskeyIdentity(db, {
      id: `d1-method-passkey-row-${suffix}`,
      userId,
      credentialId,
      credentialPublicKey: 'public-key',
    });

    const deletes = await Promise.allSettled([
      deleteOAuthIdentity(db, {
        accountId: `d1-method-account-${suffix}`,
        userId,
        provider: 'github',
        providerUserId,
        remainingMethodGuard: { independentMethodCount: 0, includePasskeys: true, expectedAuthRevision: 0 },
      }),
      deletePasskeyIdentity(
        db,
        credentialId,
        userId,
        { independentMethodCount: 0, includePasskeys: true, expectedAuthRevision: 0 },
      ),
    ]);
    expect(deletes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(deletes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const oauthCount = await db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM _oauth_accounts WHERE userId = ?`,
      [userId],
    );
    const passkeyCount = await db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM _webauthn_credentials WHERE userId = ?`,
      [userId],
    );
    expect((oauthCount?.count ?? 0) + (passkeyCount?.count ?? 0)).toBe(1);
  });

  it('atomically creates an admin-managed user and never deletes a colliding existing id', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-managed-create-${suffix}`;
    await createUser(db, {
      userId,
      email: `existing-${suffix}@example.com`,
      passwordHash: 'existing-password',
      displayName: 'Existing User',
    });
    const requestedEmail = `requested-${suffix}@example.com`;
    const reservationId = await registerEmailPending(db, requestedEmail, userId);

    await expect(finalizeManagedUserCreation(db, {
      user: {
        userId,
        email: requestedEmail,
        passwordHash: 'new-password',
      },
      emailReservationId: reservationId,
    })).rejects.toThrow();

    await expect(getUserById(db, userId)).resolves.toMatchObject({
      email: `existing-${suffix}@example.com`,
      displayName: 'Existing User',
    });
    await expect(db.first<{ userId: string; status: string; reservationId: string }>(
      `SELECT userId, status, reservationId FROM _email_index WHERE email = ?`,
      [requestedEmail],
    )).resolves.toEqual({ userId, status: 'pending', reservationId });
  });

  it('CAS-serializes concurrent admin contact updates', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-managed-update-${suffix}`;
    const oldEmail = `old-${suffix}@example.com`;
    const emailA = `a-${suffix}@example.com`;
    const emailB = `b-${suffix}@example.com`;
    await createUser(db, { userId, email: oldEmail, passwordHash: 'password' });
    await db.run(
      `INSERT INTO _email_index
       (email, userId, shardId, status, reservationId, createdAt)
       VALUES (?, ?, 0, 'confirmed', NULL, ?)`,
      [oldEmail, userId, new Date().toISOString()],
    );
    const reservationA = await registerEmailPending(db, emailA, userId);
    const reservationB = await registerEmailPending(db, emailB, userId);

    const results = await Promise.allSettled([
      finalizeManagedUserUpdate(db, {
        userId,
        expectedAuthRevision: 0,
        updates: { email: emailA },
        contacts: [{ kind: 'email', previousValue: oldEmail, nextValue: emailA, reservationId: reservationA }],
      }),
      finalizeManagedUserUpdate(db, {
        userId,
        expectedAuthRevision: 0,
        updates: { email: emailB },
        contacts: [{ kind: 'email', previousValue: oldEmail, nextValue: emailB, reservationId: reservationB }],
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const user = await getUserById(db, userId);
    expect(user?.authRevision).toBe(1);
    expect([emailA, emailB]).toContain(user?.email);
    await expect(lookupEmail(db, String(user?.email))).resolves.toEqual({ userId, shardId: 0 });
    await expect(lookupEmail(db, oldEmail)).resolves.toBeNull();
  });

  it('consumes a passkey assertion challenge and counter exactly once', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-passkey-auth-${suffix}`;
    const credentialId = `d1-passkey-auth-credential-${suffix}`;
    const challenge = `d1_passkey_auth_challenge_${suffix}`;
    await createUser(db, { userId, email: null, passwordHash: '' });
    await createPasskeyIdentity(db, {
      id: `d1-passkey-auth-row-${suffix}`,
      userId,
      credentialId,
      credentialPublicKey: 'public-key',
      counter: 0,
    });
    await storeWebAuthnChallenge(db, {
      challenge,
      kind: 'authentication',
      userId,
    });

    const attempts = await Promise.allSettled([
      completePasskeyAuthentication(db, { challenge, credentialId, userId, expectedCounter: 0, newCounter: 1 }),
      completePasskeyAuthentication(db, { challenge, credentialId, userId, expectedCounter: 0, newCounter: 1 }),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(db.first<{ counter: number }>(
      `SELECT counter FROM _webauthn_credentials WHERE credentialId = ?`,
      [credentialId],
    )).resolves.toEqual({ counter: 1 });
    await expect(db.first(
      `SELECT challenge FROM _webauthn_challenges WHERE challenge = ?`,
      [challenge],
    )).resolves.toBeNull();
  });

  it('binds WebAuthn challenges to owners and caps live challenges per owner', async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `d1-passkey-cap-owner-${suffix}`;
    const otherId = `d1-passkey-cap-other-${suffix}`;
    const otherCredential = `d1-passkey-cap-credential-${suffix}`;
    await createUser(db, { userId: ownerId, email: null, passwordHash: '' });
    await createUser(db, { userId: otherId, email: null, passwordHash: '' });
    await createPasskeyIdentity(db, {
      id: `d1-passkey-cap-row-${suffix}`,
      userId: otherId,
      credentialId: otherCredential,
      credentialPublicKey: 'public-key',
      counter: 0,
    });
    const ownerChallenge = `d1_owner_bound_challenge_${suffix}`;
    await storeWebAuthnChallenge(db, {
      challenge: ownerChallenge,
      kind: 'authentication',
      userId: ownerId,
    });
    await expect(completePasskeyAuthentication(db, {
      challenge: ownerChallenge,
      credentialId: otherCredential,
      userId: otherId,
      expectedCounter: 0,
      newCounter: 1,
    })).rejects.toThrow('PASSKEY_AUTH_STATE_CONFLICT');
    await expect(getWebAuthnChallenge(db, ownerChallenge, 'authentication')).resolves.toMatchObject({
      userId: ownerId,
    });
    await expect(db.first(
      `SELECT challenge FROM _webauthn_challenges WHERE challenge = ?`,
      [ownerChallenge],
    )).resolves.toBeTruthy();

    for (let index = 1; index < 10; index += 1) {
      await storeWebAuthnChallenge(db, {
        challenge: `d1_owner_cap_${index}_${suffix}`,
        kind: 'authentication',
        userId: ownerId,
      });
    }
    await expect(storeWebAuthnChallenge(db, {
      challenge: `d1_owner_cap_overflow_${suffix}`,
      kind: 'authentication',
      userId: ownerId,
    })).rejects.toThrow('WEBAUTHN_CHALLENGE_CAPACITY');
  });

  it('atomically replaces, counts failures, and consumes OTP challenges', async () => {
    const suffix = crypto.randomUUID();
    const lookupKey = `otp-${suffix}`;
    await issueAuthChallenge(db, {
      kind: 'email-otp',
      lookupKey,
      userId: `otp-user-${suffix}`,
      secretHash: 'secret-hash',
      maxAttempts: 5,
    });
    const failures = await Promise.all(
      Array.from({ length: 6 }, () => recordAuthChallengeFailure(db, 'email-otp', lookupKey)),
    );
    expect(failures.filter(Boolean)).toHaveLength(5);
    await expect(getAuthChallenge(db, 'email-otp', lookupKey)).resolves.toMatchObject({
      attempts: 5,
      maxAttempts: 5,
    });
    await expect(consumeAuthChallenge(db, 'email-otp', lookupKey)).resolves.toBeNull();

    await issueAuthChallenge(db, {
      kind: 'email-otp',
      lookupKey,
      userId: `otp-user-${suffix}`,
      secretHash: 'replacement-hash',
      maxAttempts: 5,
    });
    const consumes = await Promise.all([
      consumeAuthChallenge(db, 'email-otp', lookupKey),
      consumeAuthChallenge(db, 'email-otp', lookupKey),
    ]);
    expect(consumes.filter(Boolean)).toHaveLength(1);
    expect(consumes.find(Boolean)?.secretHash).toBe('replacement-hash');

    const expiringKey = `expired-${suffix}`;
    await issueAuthChallenge(db, {
      kind: 'email-otp',
      lookupKey: expiringKey,
      userId: `otp-user-${suffix}`,
      secretHash: 'expired-hash',
    });
    await db.run(
      `UPDATE _auth_challenges SET expiresAt = ?
       WHERE kind = 'email-otp' AND secretHash = 'expired-hash'`,
      [new Date(Date.now() - 1_000).toISOString()],
    );
    await expect(getAuthChallenge(db, 'email-otp', expiringKey)).resolves.toBeNull();
    await expect(consumeAuthChallenge(db, 'email-otp', expiringKey)).resolves.toBeNull();
  });

  it('consumes MFA tickets with TOTP/recovery state exactly once', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-mfa-user-${suffix}`;
    const otherUserId = `d1-mfa-other-${suffix}`;
    await createUser(db, { userId, email: null, passwordHash: '' });
    await createUser(db, { userId: otherUserId, email: null, passwordHash: '' });
    const ticket = `mfa-ticket-${suffix}`;
    await issueAuthChallenge(db, { kind: 'mfa-ticket', lookupKey: ticket, userId, maxAttempts: 5 });
    await expect(completeMfaTotpChallenge(db, {
      ticket,
      userId: otherUserId,
      replayScope: `login:${otherUserId}:factor`,
      counter: 1234,
    })).rejects.toThrow('MFA_TOTP_CHALLENGE_CONFLICT');
    await expect(getAuthChallenge(db, 'mfa-ticket', ticket)).resolves.toMatchObject({ userId });
    const totpAttempts = await Promise.allSettled([
      completeMfaTotpChallenge(db, { ticket, userId, replayScope: `login:${userId}:factor`, counter: 1234 }),
      completeMfaTotpChallenge(db, { ticket, userId, replayScope: `login:${userId}:factor`, counter: 1234 }),
    ]);
    expect(totpAttempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const recoveryTicket = `mfa-recovery-ticket-${suffix}`;
    const recoveryId = `mfa-recovery-code-${suffix}`;
    await db.run(
      `INSERT INTO _mfa_recovery_codes (id, userId, codeHash, used, createdAt)
       VALUES (?, ?, ?, 0, ?)`,
      [recoveryId, userId, 'recovery-hash', new Date().toISOString()],
    );
    await issueAuthChallenge(db, { kind: 'mfa-ticket', lookupKey: recoveryTicket, userId, maxAttempts: 5 });
    const recoveryAttempts = await Promise.allSettled([
      completeMfaRecoveryChallenge(db, { ticket: recoveryTicket, userId, recoveryCodeId: recoveryId }),
      completeMfaRecoveryChallenge(db, { ticket: recoveryTicket, userId, recoveryCodeId: recoveryId }),
    ]);
    expect(recoveryAttempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(db.first<{ used: number }>(
      `SELECT used FROM _mfa_recovery_codes WHERE id = ?`,
      [recoveryId],
    )).resolves.toEqual({ used: 1 });
  });

  it('consumes email tokens once and rejects a stale last-method snapshot', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-token-user-${suffix}`;
    const token = `email-token-${suffix}`;
    await createUser(db, { userId, email: `token-${suffix}@example.com`, passwordHash: 'password' });
    await createEmailToken(db, {
      token,
      userId,
      type: 'password-reset',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const consumes = await Promise.all([
      consumeEmailToken(db, token, 'password-reset'),
      consumeEmailToken(db, token, 'password-reset'),
    ]);
    expect(consumes.filter(Boolean)).toHaveLength(1);

    const providerUserId = `d1-stale-method-${suffix}`;
    const accountId = `d1-stale-account-${suffix}`;
    await createOAuthAccount(db, { id: accountId, userId, provider: 'github', providerUserId });
    await db.run(
      `INSERT INTO _oauth_index
       (provider, providerUserId, userId, shardId, status, reservationId, createdAt)
       VALUES ('github', ?, ?, 0, 'confirmed', NULL, ?)`,
      [providerUserId, userId, new Date().toISOString()],
    );
    await updateUser(db, userId, { passwordHash: '' });
    await expect(deleteOAuthIdentity(db, {
      accountId,
      userId,
      provider: 'github',
      providerUserId,
      remainingMethodGuard: {
        independentMethodCount: 1,
        includePasskeys: true,
        expectedAuthRevision: 0,
      },
    })).rejects.toThrow('LAST_SIGN_IN_METHOD');
    await expect(db.first(`SELECT id FROM _oauth_accounts WHERE id = ?`, [accountId])).resolves.toBeTruthy();
  });

  it('rejects a signed access token as soon as its session is revoked', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-session-auth-${suffix}`;
    const sessionId = `d1-session-auth-row-${suffix}`;
    const secret = 'session-validation-secret-at-least-32-chars';
    await createUser(db, { userId, email: null, passwordHash: '' });
    await db.run(
      `INSERT INTO _sessions (id, userId, refreshToken, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [
        sessionId,
        userId,
        `refresh-${suffix}`,
        new Date(Date.now() + 60_000).toISOString(),
        new Date().toISOString(),
      ],
    );
    const token = await signAccessToken({ sub: userId, sid: sessionId, isAnonymous: true }, secret);
    const env = { ...(globalThis as any).env, JWT_USER_SECRET: secret };
    await expect(resolveAuthContextFromToken(
      env,
      token,
      new Request('https://example.com/api/db/table'),
    )).resolves.toMatchObject({ id: userId, sessionId });

    await deleteAllUserSessions(db, userId);
    await expect(resolveAuthContextFromToken(
      env,
      token,
      new Request('https://example.com/api/db/table'),
    )).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('commits one anonymous phone upgrade session and encrypted retry checkpoint under concurrency', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-phone-upgrade-${suffix}`;
    const phone = `+1555${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
    const reservationId = `d1-phone-upgrade-reservation-${suffix}`;
    const sessionId = `d1-phone-upgrade-session-${suffix}`;
    const secretHash = `hmac-sha256:${'a'.repeat(64)}`;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const completionExpiresAt = new Date(Date.now() + 300_000).toISOString();

    await createUser(db, { userId, email: null, passwordHash: '' });
    await updateUser(db, userId, { isAnonymous: true });
    await registerAnonPending(db, userId);
    await confirmAnon(db, userId);
    await db.run(
      `INSERT INTO _sessions (id, userId, refreshToken, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [`old-a-${suffix}`, userId, `old-refresh-a-${suffix}`, expiresAt, new Date().toISOString()],
    );
    await db.run(
      `INSERT INTO _sessions (id, userId, refreshToken, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [`old-b-${suffix}`, userId, `old-refresh-b-${suffix}`, expiresAt, new Date().toISOString()],
    );
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
      { refreshToken: `replacement-refresh-a-${suffix}`, encryptedCompletion: `ciphertext-a-${suffix}` },
      { refreshToken: `replacement-refresh-b-${suffix}`, encryptedCompletion: `ciphertext-b-${suffix}` },
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
          metadata: JSON.stringify({ source: 'd1-response-loss-test' }),
        },
      }),
    ));

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const replacement = await db.first<{ id: string; refreshToken: string }>(
      `SELECT id, refreshToken FROM _sessions WHERE userId = ?`,
      [userId],
    );
    expect(replacement?.id).toBe(sessionId);
    const winner = candidates.find((candidate) => candidate.refreshToken === replacement?.refreshToken);
    expect(winner).toBeTruthy();
    await expect(db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM _sessions WHERE userId = ?`,
      [userId],
    )).resolves.toEqual({ count: 1 });
    await expect(getUserById(db, userId)).resolves.toMatchObject({
      phone,
      phoneVerified: 1,
      isAnonymous: 0,
      authRevision: 2,
    });
    await expect(db.first(
      `SELECT userId FROM _anon_index WHERE userId = ?`,
      [userId],
    )).resolves.toBeNull();
    await expect(getPhoneLinkUpgradeCompletion(db, phone)).resolves.toMatchObject({
      userId,
      subject: phone,
      secretHash,
      payload: winner!.encryptedCompletion,
    });
    await issueAuthChallenge(db, {
      kind: 'email-otp',
      lookupKey: `unrelated-${suffix}@example.com`,
      userId,
      secretHash: 'unrelated-hash',
    });
    await expect(getPhoneLinkUpgradeCompletion(db, phone)).resolves.toMatchObject({
      payload: winner!.encryptedCompletion,
    });
  });

  it('commits one anonymous email upgrade session and bounded password-authorized checkpoint under concurrency', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-email-upgrade-${suffix}`;
    const email = `d1-email-upgrade-${suffix}@example.com`;
    const reservationId = `d1-email-upgrade-reservation-${suffix}`;
    const sessionId = `d1-email-upgrade-session-${suffix}`;
    const initiatingSessionId = `old-email-a-${suffix}`;
    const passwordHash = `pbkdf2:sha256:100000:${'a'.repeat(24)}:${'b'.repeat(44)}`;
    const passwordProof = `hmac-sha256:${'c'.repeat(64)}`;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const completionExpiresAt = new Date(Date.now() + 300_000).toISOString();

    await createUser(db, { userId, email: null, passwordHash: '' });
    await updateUser(db, userId, { isAnonymous: true });
    await registerAnonPending(db, userId);
    await confirmAnon(db, userId);
    await db.run(
      `INSERT INTO _sessions (id, userId, refreshToken, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [initiatingSessionId, userId, `old-email-refresh-a-${suffix}`, expiresAt, new Date().toISOString()],
    );
    await db.run(
      `INSERT INTO _sessions (id, userId, refreshToken, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [`old-email-b-${suffix}`, userId, `old-email-refresh-b-${suffix}`, expiresAt, new Date().toISOString()],
    );
    await registerEmailPending(db, email, userId, reservationId);

    const candidates = [
      { refreshToken: `email-replacement-refresh-a-${suffix}`, encryptedCompletion: `email-ciphertext-a-${suffix}` },
      { refreshToken: `email-replacement-refresh-b-${suffix}`, encryptedCompletion: `email-ciphertext-b-${suffix}` },
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
          metadata: JSON.stringify({ source: 'd1-email-response-loss-test' }),
        },
      }),
    ));

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const replacement = await db.first<{ id: string; refreshToken: string }>(
      `SELECT id, refreshToken FROM _sessions WHERE userId = ?`,
      [userId],
    );
    expect(replacement?.id).toBe(sessionId);
    const winner = candidates.find((candidate) => candidate.refreshToken === replacement?.refreshToken);
    expect(winner).toBeTruthy();
    await expect(db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM _sessions WHERE userId = ?`,
      [userId],
    )).resolves.toEqual({ count: 1 });
    await expect(getUserById(db, userId)).resolves.toMatchObject({
      email,
      passwordHash,
      isAnonymous: 0,
      authRevision: 2,
    });
    await expect(lookupEmail(db, email)).resolves.toEqual({ userId, shardId: 0 });
    await expect(db.first(
      `SELECT userId FROM _anon_index WHERE userId = ?`,
      [userId],
    )).resolves.toBeNull();
    await expect(getEmailLinkUpgradeCompletion(db, userId, email)).resolves.toMatchObject({
      kind: 'email-link-completion',
      userId,
      subject: email,
      secretHash: passwordProof,
      payload: winner!.encryptedCompletion,
    });
    await issueAuthChallenge(db, {
      kind: 'email-otp',
      lookupKey: `email-upgrade-unrelated-${suffix}@example.com`,
      userId,
      secretHash: 'unrelated-email-hash',
    });
    await expect(getEmailLinkUpgradeCompletion(db, userId, email)).resolves.toMatchObject({
      payload: winner!.encryptedCompletion,
    });
  });

  it('rejects an unbounded email-upgrade completion checkpoint before touching the database', async () => {
    await expect(finalizeAnonymousEmailUpgrade(db, {
      userId: 'oversized-email-checkpoint-user',
      initiatingSessionId: 'oversized-email-checkpoint-initiating-session',
      expectedAuthRevision: 0,
      email: 'oversized-email-checkpoint@example.com',
      passwordHash: 'oversized-password-hash',
      reservationId: 'oversized-email-checkpoint-reservation',
      passwordProof: `hmac-sha256:${'d'.repeat(64)}`,
      encryptedCompletion: 'x'.repeat(16_385),
      completionExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      replacementSession: {
        id: 'oversized-email-checkpoint-session',
        userId: 'oversized-email-checkpoint-user',
        refreshToken: 'oversized-email-checkpoint-refresh',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    })).rejects.toThrow('EMAIL_UPGRADE_COMPLETION_INVALID');

    await expect(finalizeAnonymousEmailUpgrade(db, {
      userId: 'bounded-email-checkpoint-user',
      initiatingSessionId: 'bounded-email-checkpoint-initiating-session',
      expectedAuthRevision: 0,
      email: 'bounded-email@example.com',
      passwordHash: 'bounded-password-hash',
      reservationId: 'bounded-email-checkpoint-reservation',
      passwordProof: `hmac-sha256:${'d'.repeat(64)}`,
      encryptedCompletion: 'bounded-encrypted-checkpoint',
      completionExpiresAt: new Date(Date.now() + 11 * 60 * 1000).toISOString(),
      replacementSession: {
        id: 'bounded-email-checkpoint-session',
        userId: 'bounded-email-checkpoint-user',
        refreshToken: 'bounded-email-checkpoint-refresh',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    })).rejects.toThrow('EMAIL_UPGRADE_COMPLETION_EXPIRY_INVALID');
  });

  it('rolls back every anonymous email-upgrade side effect when replacement session insertion fails', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-email-upgrade-rollback-${suffix}`;
    const email = `d1-email-upgrade-rollback-${suffix}@example.com`;
    const reservationId = `d1-email-upgrade-rollback-reservation-${suffix}`;
    const sessionId = `d1-email-upgrade-rollback-session-${suffix}`;
    const oldSessionId = `d1-email-upgrade-rollback-old-session-${suffix}`;
    const oldRefreshToken = `d1-email-upgrade-rollback-old-refresh-${suffix}`;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const triggerName = `fail_email_upgrade_session_${suffix.replaceAll('-', '_')}`;

    await createUser(db, { userId, email: null, passwordHash: '' });
    await updateUser(db, userId, { isAnonymous: true });
    await registerAnonPending(db, userId);
    await confirmAnon(db, userId);
    await db.run(
      `INSERT INTO _sessions (id, userId, refreshToken, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [oldSessionId, userId, oldRefreshToken, expiresAt, new Date().toISOString()],
    );
    await registerEmailPending(db, email, userId, reservationId);
    await db.run(
      `CREATE TRIGGER ${triggerName}
       BEFORE INSERT ON _sessions
       WHEN NEW.id = '${sessionId}'
       BEGIN
         SELECT RAISE(FAIL, 'synthetic email replacement session failure');
       END`,
    );

    try {
      await expect(finalizeAnonymousEmailUpgrade(db, {
        userId,
        initiatingSessionId: oldSessionId,
        expectedAuthRevision: 1,
        email,
        passwordHash: 'rollback-password-hash',
        reservationId,
        passwordProof: `hmac-sha256:${'e'.repeat(64)}`,
        encryptedCompletion: `rollback-email-ciphertext-${suffix}`,
        completionExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        replacementSession: {
          id: sessionId,
          userId,
          refreshToken: `rollback-email-replacement-refresh-${suffix}`,
          expiresAt,
        },
      })).rejects.toThrow('synthetic email replacement session failure');
    } finally {
      await db.run(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }

    await expect(getUserById(db, userId)).resolves.toMatchObject({
      email: null,
      passwordHash: '',
      isAnonymous: 1,
      authRevision: 1,
    });
    await expect(db.first<{ status: string; reservationId: string }>(
      `SELECT status, reservationId FROM _email_index WHERE email = ?`,
      [email],
    )).resolves.toEqual({ status: 'pending', reservationId });
    await expect(db.query<{ id: string; refreshToken: string }>(
      `SELECT id, refreshToken FROM _sessions WHERE userId = ?`,
      [userId],
    )).resolves.toEqual([{ id: oldSessionId, refreshToken: oldRefreshToken }]);
    await expect(getEmailLinkUpgradeCompletion(db, userId, email)).resolves.toBeNull();
    await expect(db.first(
      `SELECT userId FROM _anon_index WHERE userId = ?`,
      [userId],
    )).resolves.toEqual({ userId });
  });

  it('refuses an anonymous email upgrade when its initiating session disappeared before commit', async () => {
    const suffix = crypto.randomUUID();
    const userId = `d1-email-upgrade-revoked-${suffix}`;
    const email = `d1-email-upgrade-revoked-${suffix}@example.com`;
    const reservationId = `d1-email-upgrade-revoked-reservation-${suffix}`;
    const initiatingSessionId = `d1-email-upgrade-revoked-session-${suffix}`;

    await createUser(db, { userId, email: null, passwordHash: '' });
    await updateUser(db, userId, { isAnonymous: true });
    await registerAnonPending(db, userId);
    await confirmAnon(db, userId);
    await registerEmailPending(db, email, userId, reservationId);

    await expect(finalizeAnonymousEmailUpgrade(db, {
      userId,
      initiatingSessionId,
      expectedAuthRevision: 1,
      email,
      passwordHash: 'revoked-initiator-password-hash',
      reservationId,
      passwordProof: `hmac-sha256:${'f'.repeat(64)}`,
      encryptedCompletion: `revoked-initiator-ciphertext-${suffix}`,
      completionExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      replacementSession: {
        id: `d1-email-upgrade-revoked-replacement-${suffix}`,
        userId,
        refreshToken: `d1-email-upgrade-revoked-refresh-${suffix}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    })).rejects.toThrow('EMAIL_UPGRADE_COMPLETION_CONFLICT');

    await expect(getUserById(db, userId)).resolves.toMatchObject({
      email: null,
      isAnonymous: 1,
      authRevision: 1,
    });
    await expect(db.first<{ status: string; reservationId: string }>(
      `SELECT status, reservationId FROM _email_index WHERE email = ?`,
      [email],
    )).resolves.toEqual({ status: 'pending', reservationId });
    await expect(getEmailLinkUpgradeCompletion(db, userId, email)).resolves.toBeNull();
    await expect(db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM _sessions WHERE userId = ?`,
      [userId],
    )).resolves.toEqual({ count: 0 });
  });

  it('rejects an unbounded phone-upgrade completion checkpoint before touching the database', async () => {
    await expect(finalizeAnonymousPhoneUpgrade(db, {
      userId: 'bounded-checkpoint-user',
      expectedAuthRevision: 0,
      phone: '+15550000000',
      reservationId: 'bounded-checkpoint-reservation',
      challengeKey: 'bounded-checkpoint-challenge',
      challengeSecretHash: `hmac-sha256:${'c'.repeat(64)}`,
      encryptedCompletion: 'encrypted-checkpoint',
      completionExpiresAt: new Date(Date.now() + 11 * 60 * 1000).toISOString(),
      replacementSession: {
        id: 'bounded-checkpoint-session',
        userId: 'bounded-checkpoint-user',
        refreshToken: 'bounded-checkpoint-refresh',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    })).rejects.toThrow('PHONE_UPGRADE_COMPLETION_EXPIRY_INVALID');
  });
});
