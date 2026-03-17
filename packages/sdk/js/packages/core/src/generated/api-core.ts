/**
 * Auto-generated core API Core — DO NOT EDIT.
 * Regenerate: npx tsx tools/sdk-codegen/generate.ts
 * Source: openapi.json (0.1.0)
 */

// ─── Interface ─────────────────────────────────────────────────────────────

export interface GeneratedDbApi {
  /** Health check — GET /api/health */
  getHealth(): Promise<unknown>;
  /** Sign up with email and password — POST /api/auth/signup */
  authSignup(body: unknown): Promise<unknown>;
  /** Sign in with email and password — POST /api/auth/signin */
  authSignin(body: unknown): Promise<unknown>;
  /** Sign in anonymously — POST /api/auth/signin/anonymous */
  authSigninAnonymous(body: unknown): Promise<unknown>;
  /** Send magic link to email — POST /api/auth/signin/magic-link */
  authSigninMagicLink(body: unknown): Promise<unknown>;
  /** Verify magic link token — POST /api/auth/verify-magic-link */
  authVerifyMagicLink(body: unknown): Promise<unknown>;
  /** Send OTP SMS to phone number — POST /api/auth/signin/phone */
  authSigninPhone(body: unknown): Promise<unknown>;
  /** Verify phone OTP and create session — POST /api/auth/verify-phone */
  authVerifyPhone(body: unknown): Promise<unknown>;
  /** Link phone number to existing account — POST /api/auth/link/phone */
  authLinkPhone(body: unknown): Promise<unknown>;
  /** Verify OTP and link phone to account — POST /api/auth/verify-link-phone */
  authVerifyLinkPhone(body: unknown): Promise<unknown>;
  /** Send OTP code to email — POST /api/auth/signin/email-otp */
  authSigninEmailOtp(body: unknown): Promise<unknown>;
  /** Verify email OTP and create session — POST /api/auth/verify-email-otp */
  authVerifyEmailOtp(body: unknown): Promise<unknown>;
  /** Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll */
  authMfaTotpEnroll(): Promise<unknown>;
  /** Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify */
  authMfaTotpVerify(body: unknown): Promise<unknown>;
  /** Verify MFA code during signin — POST /api/auth/mfa/verify */
  authMfaVerify(body: unknown): Promise<unknown>;
  /** Use recovery code during MFA signin — POST /api/auth/mfa/recovery */
  authMfaRecovery(body: unknown): Promise<unknown>;
  /** Disable TOTP factor — DELETE /api/auth/mfa/totp */
  authMfaTotpDelete(body: unknown): Promise<unknown>;
  /** List MFA factors for authenticated user — GET /api/auth/mfa/factors */
  authMfaFactors(): Promise<unknown>;
  /** Refresh access token — POST /api/auth/refresh */
  authRefresh(body: unknown): Promise<unknown>;
  /** Sign out and revoke refresh token — POST /api/auth/signout */
  authSignout(body: unknown): Promise<unknown>;
  /** Change password for authenticated user — POST /api/auth/change-password */
  authChangePassword(body: unknown): Promise<unknown>;
  /** Request email change with password confirmation — POST /api/auth/change-email */
  authChangeEmail(body: unknown): Promise<unknown>;
  /** Verify email change token — POST /api/auth/verify-email-change */
  authVerifyEmailChange(body: unknown): Promise<unknown>;
  /** Generate passkey registration options — POST /api/auth/passkeys/register-options */
  authPasskeysRegisterOptions(): Promise<unknown>;
  /** Verify and store passkey registration — POST /api/auth/passkeys/register */
  authPasskeysRegister(body: unknown): Promise<unknown>;
  /** Generate passkey authentication options — POST /api/auth/passkeys/auth-options */
  authPasskeysAuthOptions(body: unknown): Promise<unknown>;
  /** Authenticate with passkey — POST /api/auth/passkeys/authenticate */
  authPasskeysAuthenticate(body: unknown): Promise<unknown>;
  /** List passkeys for authenticated user — GET /api/auth/passkeys */
  authPasskeysList(): Promise<unknown>;
  /** Delete a passkey — DELETE /api/auth/passkeys/{credentialId} */
  authPasskeysDelete(credentialId: string): Promise<unknown>;
  /** Get current authenticated user info — GET /api/auth/me */
  authGetMe(): Promise<unknown>;
  /** Update user profile — PATCH /api/auth/profile */
  authUpdateProfile(body: unknown): Promise<unknown>;
  /** List active sessions — GET /api/auth/sessions */
  authGetSessions(): Promise<unknown>;
  /** Delete a session — DELETE /api/auth/sessions/{id} */
  authDeleteSession(id: string): Promise<unknown>;
  /** List linked sign-in identities for the current user — GET /api/auth/identities */
  authGetIdentities(): Promise<unknown>;
  /** Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId} */
  authDeleteIdentity(identityId: string): Promise<unknown>;
  /** Link email and password to existing account — POST /api/auth/link/email */
  authLinkEmail(body: unknown): Promise<unknown>;
  /** Send a verification email to the current authenticated user — POST /api/auth/request-email-verification */
  authRequestEmailVerification(body: unknown): Promise<unknown>;
  /** Verify email address with token — POST /api/auth/verify-email */
  authVerifyEmail(body: unknown): Promise<unknown>;
  /** Request password reset email — POST /api/auth/request-password-reset */
  authRequestPasswordReset(body: unknown): Promise<unknown>;
  /** Reset password with token — POST /api/auth/reset-password */
  authResetPassword(body: unknown): Promise<unknown>;
  /** Start OAuth redirect — GET /api/auth/oauth/{provider} */
  oauthRedirect(provider: string): Promise<unknown>;
  /** OAuth callback — GET /api/auth/oauth/{provider}/callback */
  oauthCallback(provider: string): Promise<unknown>;
  /** Start OAuth account linking — POST /api/auth/oauth/link/{provider} */
  oauthLinkStart(provider: string): Promise<unknown>;
  /** OAuth link callback — GET /api/auth/oauth/link/{provider}/callback */
  oauthLinkCallback(provider: string): Promise<unknown>;
  /** Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count */
  dbCountRecords(namespace: string, instanceId: string, table: string, query: Record<string, string>): Promise<unknown>;
  /** Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search */
  dbSearchRecords(namespace: string, instanceId: string, table: string, query: Record<string, string>): Promise<unknown>;
  /** Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
  dbGetRecord(namespace: string, instanceId: string, table: string, id: string, query: Record<string, string>): Promise<unknown>;
  /** Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
  dbUpdateRecord(namespace: string, instanceId: string, table: string, id: string, body: unknown): Promise<unknown>;
  /** Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
  dbDeleteRecord(namespace: string, instanceId: string, table: string, id: string): Promise<unknown>;
  /** List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table} */
  dbListRecords(namespace: string, instanceId: string, table: string, query: Record<string, string>): Promise<unknown>;
  /** Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table} */
  dbInsertRecord(namespace: string, instanceId: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown>;
  /** Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch */
  dbBatchRecords(namespace: string, instanceId: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown>;
  /** Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter */
  dbBatchByFilter(namespace: string, instanceId: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown>;
  /** Check database live subscription WebSocket prerequisites — GET /api/db/connect-check */
  checkDatabaseSubscriptionConnection(query: Record<string, string>): Promise<unknown>;
  /** Connect to database live subscriptions WebSocket — GET /api/db/subscribe */
  connectDatabaseSubscription(query: Record<string, string>): Promise<unknown>;
  /** Get table schema — GET /api/schema */
  getSchema(): Promise<unknown>;
  /** Upload file — POST /api/storage/{bucket}/upload */
  uploadFile(bucket: string, body: unknown): Promise<unknown>;
  /** Get file metadata — GET /api/storage/{bucket}/{key}/metadata */
  getFileMetadata(bucket: string, key: string): Promise<unknown>;
  /** Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata */
  updateFileMetadata(bucket: string, key: string, body: unknown): Promise<unknown>;
  /** Check if file exists — HEAD /api/storage/{bucket}/{key} */
  checkFileExists(bucket: string, key: string): Promise<boolean>;
  /** Download file — GET /api/storage/{bucket}/{key} */
  downloadFile(bucket: string, key: string): Promise<unknown>;
  /** Delete file — DELETE /api/storage/{bucket}/{key} */
  deleteFile(bucket: string, key: string): Promise<unknown>;
  /** Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts */
  getUploadParts(bucket: string, uploadId: string, query: Record<string, string>): Promise<unknown>;
  /** List files in bucket — GET /api/storage/{bucket} */
  listFiles(bucket: string): Promise<unknown>;
  /** Batch delete files — POST /api/storage/{bucket}/delete-batch */
  deleteBatch(bucket: string, body: unknown): Promise<unknown>;
  /** Create signed download URL — POST /api/storage/{bucket}/signed-url */
  createSignedDownloadUrl(bucket: string, body: unknown): Promise<unknown>;
  /** Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls */
  createSignedDownloadUrls(bucket: string, body: unknown): Promise<unknown>;
  /** Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url */
  createSignedUploadUrl(bucket: string, body: unknown): Promise<unknown>;
  /** Start multipart upload — POST /api/storage/{bucket}/multipart/create */
  createMultipartUpload(bucket: string, body: unknown): Promise<unknown>;
  /** Upload a part — POST /api/storage/{bucket}/multipart/upload-part */
  uploadPart(bucket: string, body: unknown): Promise<unknown>;
  /** Complete multipart upload — POST /api/storage/{bucket}/multipart/complete */
  completeMultipartUpload(bucket: string, body: unknown): Promise<unknown>;
  /** Abort multipart upload — POST /api/storage/{bucket}/multipart/abort */
  abortMultipartUpload(bucket: string, body: unknown): Promise<unknown>;
  /** Get public configuration — GET /api/config */
  getConfig(): Promise<unknown>;
  /** Register push token — POST /api/push/register */
  pushRegister(body: unknown): Promise<unknown>;
  /** Unregister push token — POST /api/push/unregister */
  pushUnregister(body: unknown): Promise<unknown>;
  /** Subscribe token to topic — POST /api/push/topic/subscribe */
  pushTopicSubscribe(body: unknown): Promise<unknown>;
  /** Unsubscribe token from topic — POST /api/push/topic/unsubscribe */
  pushTopicUnsubscribe(body: unknown): Promise<unknown>;
  /** Check room WebSocket connection prerequisites — GET /api/room/connect-check */
  checkRoomConnection(query: Record<string, string>): Promise<unknown>;
  /** Connect to room WebSocket — GET /api/room */
  connectRoom(query: Record<string, string>): Promise<unknown>;
  /** Get room metadata — GET /api/room/metadata */
  getRoomMetadata(query: Record<string, string>): Promise<unknown>;
  /** Get the active room realtime media session — GET /api/room/media/realtime/session */
  getRoomRealtimeSession(query: Record<string, string>): Promise<unknown>;
  /** Create a room realtime media session — POST /api/room/media/realtime/session */
  createRoomRealtimeSession(body: unknown, query: Record<string, string>): Promise<unknown>;
  /** Generate TURN / ICE credentials for room realtime media — POST /api/room/media/realtime/turn */
  createRoomRealtimeIceServers(body: unknown, query: Record<string, string>): Promise<unknown>;
  /** Add realtime media tracks to a room session — POST /api/room/media/realtime/tracks/new */
  addRoomRealtimeTracks(body: unknown, query: Record<string, string>): Promise<unknown>;
  /** Renegotiate a room realtime media session — PUT /api/room/media/realtime/renegotiate */
  renegotiateRoomRealtimeSession(body: unknown, query: Record<string, string>): Promise<unknown>;
  /** Close room realtime media tracks — PUT /api/room/media/realtime/tracks/close */
  closeRoomRealtimeTracks(body: unknown, query: Record<string, string>): Promise<unknown>;
  /** Track custom events — POST /api/analytics/track */
  trackEvents(body: unknown): Promise<unknown>;
  /** Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count */
  dbSingleCountRecords(namespace: string, table: string, query: Record<string, string>): Promise<unknown>;
  /** Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search */
  dbSingleSearchRecords(namespace: string, table: string, query: Record<string, string>): Promise<unknown>;
  /** Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id} */
  dbSingleGetRecord(namespace: string, table: string, id: string, query: Record<string, string>): Promise<unknown>;
  /** Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id} */
  dbSingleUpdateRecord(namespace: string, table: string, id: string, body: unknown): Promise<unknown>;
  /** Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id} */
  dbSingleDeleteRecord(namespace: string, table: string, id: string): Promise<unknown>;
  /** List records from a single-instance table — GET /api/db/{namespace}/tables/{table} */
  dbSingleListRecords(namespace: string, table: string, query: Record<string, string>): Promise<unknown>;
  /** Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table} */
  dbSingleInsertRecord(namespace: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown>;
  /** Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch */
  dbSingleBatchRecords(namespace: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown>;
  /** Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter */
  dbSingleBatchByFilter(namespace: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown>;
}

// ─── Implementation ────────────────────────────────────────────────────────

export interface HttpTransport {
  request<T>(method: string, path: string, options?: {
    query?: Record<string, string>;
    body?: unknown;
  }): Promise<T>;
  /** HEAD request — returns true if 2xx, false otherwise (no body parsing) */
  head(path: string): Promise<boolean>;
}

export class DefaultDbApi implements GeneratedDbApi {
  constructor(private readonly transport: HttpTransport) {}

  async getHealth(): Promise<unknown> {
    return this.transport.request('GET', '/api/health');
  }

  async authSignup(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/signup', { body });
  }

  async authSignin(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/signin', { body });
  }

  async authSigninAnonymous(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/signin/anonymous', { body });
  }

  async authSigninMagicLink(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/signin/magic-link', { body });
  }

  async authVerifyMagicLink(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/verify-magic-link', { body });
  }

  async authSigninPhone(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/signin/phone', { body });
  }

  async authVerifyPhone(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/verify-phone', { body });
  }

  async authLinkPhone(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/link/phone', { body });
  }

  async authVerifyLinkPhone(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/verify-link-phone', { body });
  }

  async authSigninEmailOtp(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/signin/email-otp', { body });
  }

  async authVerifyEmailOtp(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/verify-email-otp', { body });
  }

  async authMfaTotpEnroll(): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/mfa/totp/enroll');
  }

  async authMfaTotpVerify(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/mfa/totp/verify', { body });
  }

  async authMfaVerify(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/mfa/verify', { body });
  }

  async authMfaRecovery(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/mfa/recovery', { body });
  }

  async authMfaTotpDelete(body: unknown): Promise<unknown> {
    return this.transport.request('DELETE', '/api/auth/mfa/totp', { body });
  }

  async authMfaFactors(): Promise<unknown> {
    return this.transport.request('GET', '/api/auth/mfa/factors');
  }

  async authRefresh(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/refresh', { body });
  }

  async authSignout(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/signout', { body });
  }

  async authChangePassword(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/change-password', { body });
  }

  async authChangeEmail(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/change-email', { body });
  }

  async authVerifyEmailChange(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/verify-email-change', { body });
  }

  async authPasskeysRegisterOptions(): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/passkeys/register-options');
  }

  async authPasskeysRegister(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/passkeys/register', { body });
  }

  async authPasskeysAuthOptions(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/passkeys/auth-options', { body });
  }

  async authPasskeysAuthenticate(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/passkeys/authenticate', { body });
  }

  async authPasskeysList(): Promise<unknown> {
    return this.transport.request('GET', '/api/auth/passkeys');
  }

  async authPasskeysDelete(credentialId: string): Promise<unknown> {
    return this.transport.request('DELETE', `/api/auth/passkeys/${credentialId}`);
  }

  async authGetMe(): Promise<unknown> {
    return this.transport.request('GET', '/api/auth/me');
  }

  async authUpdateProfile(body: unknown): Promise<unknown> {
    return this.transport.request('PATCH', '/api/auth/profile', { body });
  }

  async authGetSessions(): Promise<unknown> {
    return this.transport.request('GET', '/api/auth/sessions');
  }

  async authDeleteSession(id: string): Promise<unknown> {
    return this.transport.request('DELETE', `/api/auth/sessions/${id}`);
  }

  async authGetIdentities(): Promise<unknown> {
    return this.transport.request('GET', '/api/auth/identities');
  }

  async authDeleteIdentity(identityId: string): Promise<unknown> {
    return this.transport.request('DELETE', `/api/auth/identities/${identityId}`);
  }

  async authLinkEmail(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/link/email', { body });
  }

  async authRequestEmailVerification(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/request-email-verification', { body });
  }

  async authVerifyEmail(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/verify-email', { body });
  }

  async authRequestPasswordReset(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/request-password-reset', { body });
  }

  async authResetPassword(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/reset-password', { body });
  }

  async oauthRedirect(provider: string): Promise<unknown> {
    return this.transport.request('GET', `/api/auth/oauth/${provider}`);
  }

  async oauthCallback(provider: string): Promise<unknown> {
    return this.transport.request('GET', `/api/auth/oauth/${provider}/callback`);
  }

  async oauthLinkStart(provider: string): Promise<unknown> {
    return this.transport.request('POST', `/api/auth/oauth/link/${provider}`);
  }

  async oauthLinkCallback(provider: string): Promise<unknown> {
    return this.transport.request('GET', `/api/auth/oauth/link/${provider}/callback`);
  }

  async dbCountRecords(namespace: string, instanceId: string, table: string, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', `/api/db/${namespace}/${instanceId}/tables/${table}/count`, { query });
  }

  async dbSearchRecords(namespace: string, instanceId: string, table: string, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', `/api/db/${namespace}/${instanceId}/tables/${table}/search`, { query });
  }

  async dbGetRecord(namespace: string, instanceId: string, table: string, id: string, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', `/api/db/${namespace}/${instanceId}/tables/${table}/${id}`, { query });
  }

  async dbUpdateRecord(namespace: string, instanceId: string, table: string, id: string, body: unknown): Promise<unknown> {
    return this.transport.request('PATCH', `/api/db/${namespace}/${instanceId}/tables/${table}/${id}`, { body });
  }

  async dbDeleteRecord(namespace: string, instanceId: string, table: string, id: string): Promise<unknown> {
    return this.transport.request('DELETE', `/api/db/${namespace}/${instanceId}/tables/${table}/${id}`);
  }

  async dbListRecords(namespace: string, instanceId: string, table: string, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', `/api/db/${namespace}/${instanceId}/tables/${table}`, { query });
  }

  async dbInsertRecord(namespace: string, instanceId: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('POST', `/api/db/${namespace}/${instanceId}/tables/${table}`, { body, query });
  }

  async dbBatchRecords(namespace: string, instanceId: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('POST', `/api/db/${namespace}/${instanceId}/tables/${table}/batch`, { body, query });
  }

  async dbBatchByFilter(namespace: string, instanceId: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('POST', `/api/db/${namespace}/${instanceId}/tables/${table}/batch-by-filter`, { body, query });
  }

  async checkDatabaseSubscriptionConnection(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', '/api/db/connect-check', { query });
  }

  async connectDatabaseSubscription(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', '/api/db/subscribe', { query });
  }

  async getSchema(): Promise<unknown> {
    return this.transport.request('GET', '/api/schema');
  }

  async uploadFile(bucket: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/storage/${bucket}/upload`, { body });
  }

  async getFileMetadata(bucket: string, key: string): Promise<unknown> {
    return this.transport.request('GET', `/api/storage/${bucket}/${key}/metadata`);
  }

  async updateFileMetadata(bucket: string, key: string, body: unknown): Promise<unknown> {
    return this.transport.request('PATCH', `/api/storage/${bucket}/${key}/metadata`, { body });
  }

  async checkFileExists(bucket: string, key: string): Promise<boolean> {
    return this.transport.head(`/api/storage/${bucket}/${key}`);
  }

  async downloadFile(bucket: string, key: string): Promise<unknown> {
    return this.transport.request('GET', `/api/storage/${bucket}/${key}`);
  }

  async deleteFile(bucket: string, key: string): Promise<unknown> {
    return this.transport.request('DELETE', `/api/storage/${bucket}/${key}`);
  }

  async getUploadParts(bucket: string, uploadId: string, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', `/api/storage/${bucket}/uploads/${uploadId}/parts`, { query });
  }

  async listFiles(bucket: string): Promise<unknown> {
    return this.transport.request('GET', `/api/storage/${bucket}`);
  }

  async deleteBatch(bucket: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/storage/${bucket}/delete-batch`, { body });
  }

  async createSignedDownloadUrl(bucket: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/storage/${bucket}/signed-url`, { body });
  }

  async createSignedDownloadUrls(bucket: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/storage/${bucket}/signed-urls`, { body });
  }

  async createSignedUploadUrl(bucket: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/storage/${bucket}/signed-upload-url`, { body });
  }

  async createMultipartUpload(bucket: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/storage/${bucket}/multipart/create`, { body });
  }

  async uploadPart(bucket: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/storage/${bucket}/multipart/upload-part`, { body });
  }

  async completeMultipartUpload(bucket: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/storage/${bucket}/multipart/complete`, { body });
  }

  async abortMultipartUpload(bucket: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/storage/${bucket}/multipart/abort`, { body });
  }

  async getConfig(): Promise<unknown> {
    return this.transport.request('GET', '/api/config');
  }

  async pushRegister(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/push/register', { body });
  }

  async pushUnregister(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/push/unregister', { body });
  }

  async pushTopicSubscribe(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/push/topic/subscribe', { body });
  }

  async pushTopicUnsubscribe(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/push/topic/unsubscribe', { body });
  }

  async checkRoomConnection(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', '/api/room/connect-check', { query });
  }

  async connectRoom(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', '/api/room', { query });
  }

  async getRoomMetadata(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', '/api/room/metadata', { query });
  }

  async getRoomRealtimeSession(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', '/api/room/media/realtime/session', { query });
  }

  async createRoomRealtimeSession(body: unknown, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('POST', '/api/room/media/realtime/session', { body, query });
  }

  async createRoomRealtimeIceServers(body: unknown, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('POST', '/api/room/media/realtime/turn', { body, query });
  }

  async addRoomRealtimeTracks(body: unknown, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('POST', '/api/room/media/realtime/tracks/new', { body, query });
  }

  async renegotiateRoomRealtimeSession(body: unknown, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('PUT', '/api/room/media/realtime/renegotiate', { body, query });
  }

  async closeRoomRealtimeTracks(body: unknown, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('PUT', '/api/room/media/realtime/tracks/close', { body, query });
  }

  async trackEvents(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/analytics/track', { body });
  }

  async dbSingleCountRecords(namespace: string, table: string, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', `/api/db/${namespace}/tables/${table}/count`, { query });
  }

  async dbSingleSearchRecords(namespace: string, table: string, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', `/api/db/${namespace}/tables/${table}/search`, { query });
  }

  async dbSingleGetRecord(namespace: string, table: string, id: string, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', `/api/db/${namespace}/tables/${table}/${id}`, { query });
  }

  async dbSingleUpdateRecord(namespace: string, table: string, id: string, body: unknown): Promise<unknown> {
    return this.transport.request('PATCH', `/api/db/${namespace}/tables/${table}/${id}`, { body });
  }

  async dbSingleDeleteRecord(namespace: string, table: string, id: string): Promise<unknown> {
    return this.transport.request('DELETE', `/api/db/${namespace}/tables/${table}/${id}`);
  }

  async dbSingleListRecords(namespace: string, table: string, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', `/api/db/${namespace}/tables/${table}`, { query });
  }

  async dbSingleInsertRecord(namespace: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('POST', `/api/db/${namespace}/tables/${table}`, { body, query });
  }

  async dbSingleBatchRecords(namespace: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('POST', `/api/db/${namespace}/tables/${table}/batch`, { body, query });
  }

  async dbSingleBatchByFilter(namespace: string, table: string, body: unknown, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('POST', `/api/db/${namespace}/tables/${table}/batch-by-filter`, { body, query });
  }

}

// ─── Path Constants ────────────────────────────────────────────────────────

export class ApiPaths {
  static readonly ADMIN_LOGIN = '/admin/api/auth/login';
  static readonly ADMIN_REFRESH = '/admin/api/auth/refresh';
  static readonly BACKUP_CLEANUP_PLUGIN = '/admin/api/backup/cleanup-plugin';
  static readonly BACKUP_GET_CONFIG = '/admin/api/backup/config';
  static readonly BACKUP_DUMP_CONTROL_D1 = '/admin/api/backup/dump-control-d1';
  static readonly BACKUP_DUMP_D1 = '/admin/api/backup/dump-d1';
  static readonly BACKUP_DUMP_DATA = '/admin/api/backup/dump-data';
  static readonly BACKUP_DUMP_DO = '/admin/api/backup/dump-do';
  static readonly BACKUP_DUMP_STORAGE = '/admin/api/backup/dump-storage';
  static backupExportTable(name: string) { return `/admin/api/backup/export/${name}`; }
  static readonly BACKUP_LIST_DOS = '/admin/api/backup/list-dos';
  static readonly BACKUP_RESTORE_CONTROL_D1 = '/admin/api/backup/restore-control-d1';
  static readonly BACKUP_RESTORE_D1 = '/admin/api/backup/restore-d1';
  static readonly BACKUP_RESTORE_DATA = '/admin/api/backup/restore-data';
  static readonly BACKUP_RESTORE_DO = '/admin/api/backup/restore-do';
  static readonly BACKUP_RESTORE_STORAGE = '/admin/api/backup/restore-storage';
  static readonly BACKUP_RESYNC_USERS_PUBLIC = '/admin/api/backup/resync-users-public';
  static readonly BACKUP_WIPE_DO = '/admin/api/backup/wipe-do';
  static readonly ADMIN_LIST_ADMINS = '/admin/api/data/admins';
  static readonly ADMIN_CREATE_ADMIN = '/admin/api/data/admins';
  static adminDeleteAdmin(id: string) { return `/admin/api/data/admins/${id}`; }
  static adminChangePassword(id: string) { return `/admin/api/data/admins/${id}/password`; }
  static readonly ADMIN_GET_ANALYTICS = '/admin/api/data/analytics';
  static readonly ADMIN_GET_ANALYTICS_EVENTS = '/admin/api/data/analytics/events';
  static readonly ADMIN_GET_AUTH_SETTINGS = '/admin/api/data/auth/settings';
  static readonly ADMIN_BACKUP_GET_CONFIG = '/admin/api/data/backup/config';
  static readonly ADMIN_BACKUP_DUMP_D1 = '/admin/api/data/backup/dump-d1';
  static readonly ADMIN_BACKUP_DUMP_DO = '/admin/api/data/backup/dump-do';
  static readonly ADMIN_BACKUP_LIST_DOS = '/admin/api/data/backup/list-dos';
  static readonly ADMIN_BACKUP_RESTORE_D1 = '/admin/api/data/backup/restore-d1';
  static readonly ADMIN_BACKUP_RESTORE_DO = '/admin/api/data/backup/restore-do';
  static readonly ADMIN_CLEANUP_ANON = '/admin/api/data/cleanup-anon';
  static readonly ADMIN_GET_CONFIG_INFO = '/admin/api/data/config-info';
  static readonly ADMIN_GET_DEV_INFO = '/admin/api/data/dev-info';
  static readonly ADMIN_GET_EMAIL_TEMPLATES = '/admin/api/data/email/templates';
  static readonly ADMIN_LIST_FUNCTIONS = '/admin/api/data/functions';
  static readonly ADMIN_GET_LOGS = '/admin/api/data/logs';
  static readonly ADMIN_GET_RECENT_LOGS = '/admin/api/data/logs/recent';
  static readonly ADMIN_GET_MONITORING = '/admin/api/data/monitoring';
  static readonly ADMIN_GET_OVERVIEW = '/admin/api/data/overview';
  static readonly ADMIN_GET_PUSH_LOGS = '/admin/api/data/push/logs';
  static readonly ADMIN_TEST_PUSH_SEND = '/admin/api/data/push/test-send';
  static readonly ADMIN_GET_PUSH_TOKENS = '/admin/api/data/push/tokens';
  static readonly ADMIN_RULES_TEST = '/admin/api/data/rules-test';
  static readonly ADMIN_GET_SCHEMA = '/admin/api/data/schema';
  static readonly ADMIN_EXECUTE_SQL = '/admin/api/data/sql';
  static readonly ADMIN_LIST_BUCKETS = '/admin/api/data/storage/buckets';
  static adminListBucketObjects(name: string) { return `/admin/api/data/storage/buckets/${name}/objects`; }
  static adminGetBucketObject(name: string, key: string) { return `/admin/api/data/storage/buckets/${name}/objects/${key}`; }
  static adminDeleteBucketObject(name: string, key: string) { return `/admin/api/data/storage/buckets/${name}/objects/${key}`; }
  static adminCreateSignedUrl(name: string) { return `/admin/api/data/storage/buckets/${name}/signed-url`; }
  static adminGetBucketStats(name: string) { return `/admin/api/data/storage/buckets/${name}/stats`; }
  static adminUploadFile(name: string) { return `/admin/api/data/storage/buckets/${name}/upload`; }
  static readonly ADMIN_LIST_TABLES = '/admin/api/data/tables';
  static adminExportTable(name: string) { return `/admin/api/data/tables/${name}/export`; }
  static adminImportTable(name: string) { return `/admin/api/data/tables/${name}/import`; }
  static adminGetTableRecords(name: string) { return `/admin/api/data/tables/${name}/records`; }
  static adminCreateTableRecord(name: string) { return `/admin/api/data/tables/${name}/records`; }
  static adminUpdateTableRecord(name: string, id: string) { return `/admin/api/data/tables/${name}/records/${id}`; }
  static adminDeleteTableRecord(name: string, id: string) { return `/admin/api/data/tables/${name}/records/${id}`; }
  static readonly ADMIN_LIST_USERS = '/admin/api/data/users';
  static readonly ADMIN_CREATE_USER = '/admin/api/data/users';
  static adminGetUser(id: string) { return `/admin/api/data/users/${id}`; }
  static adminUpdateUser(id: string) { return `/admin/api/data/users/${id}`; }
  static adminDeleteUser(id: string) { return `/admin/api/data/users/${id}`; }
  static adminDeleteUserMfa(id: string) { return `/admin/api/data/users/${id}/mfa`; }
  static adminGetUserProfile(id: string) { return `/admin/api/data/users/${id}/profile`; }
  static adminSendPasswordReset(id: string) { return `/admin/api/data/users/${id}/send-password-reset`; }
  static adminDeleteUserSessions(id: string) { return `/admin/api/data/users/${id}/sessions`; }
  static readonly ADMIN_RESET_PASSWORD = '/admin/api/internal/reset-password';
  static readonly ADMIN_SETUP = '/admin/api/setup';
  static readonly ADMIN_SETUP_STATUS = '/admin/api/setup/status';
  static readonly QUERY_CUSTOM_EVENTS = '/api/analytics/events';
  static readonly QUERY_ANALYTICS = '/api/analytics/query';
  static readonly TRACK_EVENTS = '/api/analytics/track';
  static readonly ADMIN_AUTH_LIST_USERS = '/api/auth/admin/users';
  static readonly ADMIN_AUTH_CREATE_USER = '/api/auth/admin/users';
  static adminAuthGetUser(id: string) { return `/api/auth/admin/users/${id}`; }
  static adminAuthUpdateUser(id: string) { return `/api/auth/admin/users/${id}`; }
  static adminAuthDeleteUser(id: string) { return `/api/auth/admin/users/${id}`; }
  static adminAuthSetClaims(id: string) { return `/api/auth/admin/users/${id}/claims`; }
  static adminAuthDeleteUserMfa(id: string) { return `/api/auth/admin/users/${id}/mfa`; }
  static adminAuthRevokeUserSessions(id: string) { return `/api/auth/admin/users/${id}/revoke`; }
  static readonly ADMIN_AUTH_IMPORT_USERS = '/api/auth/admin/users/import';
  static readonly AUTH_CHANGE_EMAIL = '/api/auth/change-email';
  static readonly AUTH_CHANGE_PASSWORD = '/api/auth/change-password';
  static readonly AUTH_GET_IDENTITIES = '/api/auth/identities';
  static authDeleteIdentity(identityId: string) { return `/api/auth/identities/${identityId}`; }
  static readonly AUTH_LINK_EMAIL = '/api/auth/link/email';
  static readonly AUTH_LINK_PHONE = '/api/auth/link/phone';
  static readonly AUTH_GET_ME = '/api/auth/me';
  static readonly AUTH_MFA_FACTORS = '/api/auth/mfa/factors';
  static readonly AUTH_MFA_RECOVERY = '/api/auth/mfa/recovery';
  static readonly AUTH_MFA_TOTP_DELETE = '/api/auth/mfa/totp';
  static readonly AUTH_MFA_TOTP_ENROLL = '/api/auth/mfa/totp/enroll';
  static readonly AUTH_MFA_TOTP_VERIFY = '/api/auth/mfa/totp/verify';
  static readonly AUTH_MFA_VERIFY = '/api/auth/mfa/verify';
  static oauthRedirect(provider: string) { return `/api/auth/oauth/${provider}`; }
  static oauthCallback(provider: string) { return `/api/auth/oauth/${provider}/callback`; }
  static oauthLinkStart(provider: string) { return `/api/auth/oauth/link/${provider}`; }
  static oauthLinkCallback(provider: string) { return `/api/auth/oauth/link/${provider}/callback`; }
  static readonly AUTH_PASSKEYS_LIST = '/api/auth/passkeys';
  static authPasskeysDelete(credentialId: string) { return `/api/auth/passkeys/${credentialId}`; }
  static readonly AUTH_PASSKEYS_AUTH_OPTIONS = '/api/auth/passkeys/auth-options';
  static readonly AUTH_PASSKEYS_AUTHENTICATE = '/api/auth/passkeys/authenticate';
  static readonly AUTH_PASSKEYS_REGISTER = '/api/auth/passkeys/register';
  static readonly AUTH_PASSKEYS_REGISTER_OPTIONS = '/api/auth/passkeys/register-options';
  static readonly AUTH_UPDATE_PROFILE = '/api/auth/profile';
  static readonly AUTH_REFRESH = '/api/auth/refresh';
  static readonly AUTH_REQUEST_EMAIL_VERIFICATION = '/api/auth/request-email-verification';
  static readonly AUTH_REQUEST_PASSWORD_RESET = '/api/auth/request-password-reset';
  static readonly AUTH_RESET_PASSWORD = '/api/auth/reset-password';
  static readonly AUTH_GET_SESSIONS = '/api/auth/sessions';
  static authDeleteSession(id: string) { return `/api/auth/sessions/${id}`; }
  static readonly AUTH_SIGNIN = '/api/auth/signin';
  static readonly AUTH_SIGNIN_ANONYMOUS = '/api/auth/signin/anonymous';
  static readonly AUTH_SIGNIN_EMAIL_OTP = '/api/auth/signin/email-otp';
  static readonly AUTH_SIGNIN_MAGIC_LINK = '/api/auth/signin/magic-link';
  static readonly AUTH_SIGNIN_PHONE = '/api/auth/signin/phone';
  static readonly AUTH_SIGNOUT = '/api/auth/signout';
  static readonly AUTH_SIGNUP = '/api/auth/signup';
  static readonly AUTH_VERIFY_EMAIL = '/api/auth/verify-email';
  static readonly AUTH_VERIFY_EMAIL_CHANGE = '/api/auth/verify-email-change';
  static readonly AUTH_VERIFY_EMAIL_OTP = '/api/auth/verify-email-otp';
  static readonly AUTH_VERIFY_LINK_PHONE = '/api/auth/verify-link-phone';
  static readonly AUTH_VERIFY_MAGIC_LINK = '/api/auth/verify-magic-link';
  static readonly AUTH_VERIFY_PHONE = '/api/auth/verify-phone';
  static readonly GET_CONFIG = '/api/config';
  static executeD1Query(database: string) { return `/api/d1/${database}`; }
  static dbListRecords(namespace: string, instanceId: string, table: string) { return `/api/db/${namespace}/${instanceId}/tables/${table}`; }
  static dbInsertRecord(namespace: string, instanceId: string, table: string) { return `/api/db/${namespace}/${instanceId}/tables/${table}`; }
  static dbGetRecord(namespace: string, instanceId: string, table: string, id: string) { return `/api/db/${namespace}/${instanceId}/tables/${table}/${id}`; }
  static dbUpdateRecord(namespace: string, instanceId: string, table: string, id: string) { return `/api/db/${namespace}/${instanceId}/tables/${table}/${id}`; }
  static dbDeleteRecord(namespace: string, instanceId: string, table: string, id: string) { return `/api/db/${namespace}/${instanceId}/tables/${table}/${id}`; }
  static dbBatchRecords(namespace: string, instanceId: string, table: string) { return `/api/db/${namespace}/${instanceId}/tables/${table}/batch`; }
  static dbBatchByFilter(namespace: string, instanceId: string, table: string) { return `/api/db/${namespace}/${instanceId}/tables/${table}/batch-by-filter`; }
  static dbCountRecords(namespace: string, instanceId: string, table: string) { return `/api/db/${namespace}/${instanceId}/tables/${table}/count`; }
  static dbSearchRecords(namespace: string, instanceId: string, table: string) { return `/api/db/${namespace}/${instanceId}/tables/${table}/search`; }
  static dbSingleListRecords(namespace: string, table: string) { return `/api/db/${namespace}/tables/${table}`; }
  static dbSingleInsertRecord(namespace: string, table: string) { return `/api/db/${namespace}/tables/${table}`; }
  static dbSingleGetRecord(namespace: string, table: string, id: string) { return `/api/db/${namespace}/tables/${table}/${id}`; }
  static dbSingleUpdateRecord(namespace: string, table: string, id: string) { return `/api/db/${namespace}/tables/${table}/${id}`; }
  static dbSingleDeleteRecord(namespace: string, table: string, id: string) { return `/api/db/${namespace}/tables/${table}/${id}`; }
  static dbSingleBatchRecords(namespace: string, table: string) { return `/api/db/${namespace}/tables/${table}/batch`; }
  static dbSingleBatchByFilter(namespace: string, table: string) { return `/api/db/${namespace}/tables/${table}/batch-by-filter`; }
  static dbSingleCountRecords(namespace: string, table: string) { return `/api/db/${namespace}/tables/${table}/count`; }
  static dbSingleSearchRecords(namespace: string, table: string) { return `/api/db/${namespace}/tables/${table}/search`; }
  static readonly DATABASE_LIVE_BROADCAST = '/api/db/broadcast';
  static readonly CHECK_DATABASE_SUBSCRIPTION_CONNECTION = '/api/db/connect-check';
  static readonly CONNECT_DATABASE_SUBSCRIPTION = '/api/db/subscribe';
  static readonly GET_HEALTH = '/api/health';
  static kvOperation(namespace: string) { return `/api/kv/${namespace}`; }
  static readonly PUSH_BROADCAST = '/api/push/broadcast';
  static readonly GET_PUSH_LOGS = '/api/push/logs';
  static readonly PUSH_REGISTER = '/api/push/register';
  static readonly PUSH_SEND = '/api/push/send';
  static readonly PUSH_SEND_MANY = '/api/push/send-many';
  static readonly PUSH_SEND_TO_TOKEN = '/api/push/send-to-token';
  static readonly PUSH_SEND_TO_TOPIC = '/api/push/send-to-topic';
  static readonly GET_PUSH_TOKENS = '/api/push/tokens';
  static readonly PUT_PUSH_TOKENS = '/api/push/tokens';
  static readonly PATCH_PUSH_TOKENS = '/api/push/tokens';
  static readonly PUSH_TOPIC_SUBSCRIBE = '/api/push/topic/subscribe';
  static readonly PUSH_TOPIC_UNSUBSCRIBE = '/api/push/topic/unsubscribe';
  static readonly PUSH_UNREGISTER = '/api/push/unregister';
  static readonly CONNECT_ROOM = '/api/room';
  static readonly CHECK_ROOM_CONNECTION = '/api/room/connect-check';
  static readonly RENEGOTIATE_ROOM_REALTIME_SESSION = '/api/room/media/realtime/renegotiate';
  static readonly GET_ROOM_REALTIME_SESSION = '/api/room/media/realtime/session';
  static readonly CREATE_ROOM_REALTIME_SESSION = '/api/room/media/realtime/session';
  static readonly CLOSE_ROOM_REALTIME_TRACKS = '/api/room/media/realtime/tracks/close';
  static readonly ADD_ROOM_REALTIME_TRACKS = '/api/room/media/realtime/tracks/new';
  static readonly CREATE_ROOM_REALTIME_ICE_SERVERS = '/api/room/media/realtime/turn';
  static readonly GET_ROOM_METADATA = '/api/room/metadata';
  static readonly GET_SCHEMA = '/api/schema';
  static readonly EXECUTE_SQL = '/api/sql';
  static listFiles(bucket: string) { return `/api/storage/${bucket}`; }
  static checkFileExists(bucket: string, key: string) { return `/api/storage/${bucket}/${key}`; }
  static downloadFile(bucket: string, key: string) { return `/api/storage/${bucket}/${key}`; }
  static deleteFile(bucket: string, key: string) { return `/api/storage/${bucket}/${key}`; }
  static getFileMetadata(bucket: string, key: string) { return `/api/storage/${bucket}/${key}/metadata`; }
  static updateFileMetadata(bucket: string, key: string) { return `/api/storage/${bucket}/${key}/metadata`; }
  static deleteBatch(bucket: string) { return `/api/storage/${bucket}/delete-batch`; }
  static abortMultipartUpload(bucket: string) { return `/api/storage/${bucket}/multipart/abort`; }
  static completeMultipartUpload(bucket: string) { return `/api/storage/${bucket}/multipart/complete`; }
  static createMultipartUpload(bucket: string) { return `/api/storage/${bucket}/multipart/create`; }
  static uploadPart(bucket: string) { return `/api/storage/${bucket}/multipart/upload-part`; }
  static createSignedUploadUrl(bucket: string) { return `/api/storage/${bucket}/signed-upload-url`; }
  static createSignedDownloadUrl(bucket: string) { return `/api/storage/${bucket}/signed-url`; }
  static createSignedDownloadUrls(bucket: string) { return `/api/storage/${bucket}/signed-urls`; }
  static uploadFile(bucket: string) { return `/api/storage/${bucket}/upload`; }
  static getUploadParts(bucket: string, uploadId: string) { return `/api/storage/${bucket}/uploads/${uploadId}/parts`; }
  static vectorizeOperation(index: string) { return `/api/vectorize/${index}`; }
}
