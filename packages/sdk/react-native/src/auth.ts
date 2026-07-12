/**
 * Auth client for React Native — API parity with @edge-base/web AuthClient.
 *: onAuthStateChange
 *: signInAnonymously
 *: signUp with data
 *: React Native OAuth via Linking API + deep link callback
 *
 * Key differences from web AuthClient:
 * - signInWithOAuth uses Linking.openURL() instead of window.location.href
 * - Handles deep link OAuth callback via Linking.addEventListener
 * - TokenManager restores AsyncStorage asynchronously, then serves its cached
 *   refresh token synchronously
 * - Captcha is handled via TurnstileWebView component (see turnstile.tsx)
 */

import { EdgeBaseError, type HttpClient, type GeneratedDbApi } from '@edge-base/core';
import type {
  TokenManager,
  TokenUser,
  AuthStateChangeHandler,
  PendingOAuthCompletion,
  PendingSessionRevocation,
} from './token-manager.js';
import { invalidateSiteKeyCache } from './turnstile.js';

// ─── Types ───

export interface SignUpOptions {
  email: string;
  password: string;
  data?: {
    displayName?: string;
    avatarUrl?: string;
    [key: string]: unknown;
  };
  /** Captcha token from TurnstileWebView */
  captchaToken?: string;
}

export interface SignInOptions {
  email: string;
  password: string;
  /** Captcha token from TurnstileWebView */
  captchaToken?: string;
}

export interface AuthResult {
  user: TokenUser;
  accessToken: string;
  refreshToken: string;
}

function isAuthResult(value: unknown): value is AuthResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthResult>;
  return typeof candidate.accessToken === 'string'
    && candidate.accessToken.length > 0
    && typeof candidate.refreshToken === 'string'
    && Boolean(candidate.user && typeof candidate.user === 'object');
}

/** Returned when MFA is required during sign-in */
export interface MfaRequiredResult {
  mfaRequired: true;
  mfaTicket: string;
  factors: MfaFactor[];
}

export interface MfaFactor {
  id: string;
  type: string;
}

export type SignInResult = AuthResult | MfaRequiredResult;

export interface TotpEnrollResult {
  factorId: string;
  secret: string;
  qrCodeUri: string;
  recoveryCodes: string[];
}

export interface DisableTotpOptions {
  password?: string;
  code?: string;
}

export interface Session {
  id: string;
  createdAt: string;
  userAgent?: string;
  ip?: string;
}

export interface UpdateProfileOptions {
  displayName?: string;
  avatarUrl?: string;
  emailVisibility?: string;
}

export interface PasskeysAuthOptions {
  email?: string;
}

export interface LinkedIdentity {
  id: string;
  kind: 'oauth';
  provider: string;
  providerUserId: string;
  createdAt: string;
  canUnlink: boolean;
}

export interface IdentityMethods {
  total: number;
  hasPassword: boolean;
  hasMagicLink: boolean;
  hasEmailOtp: boolean;
  hasPhone: boolean;
  passkeyCount: number;
  oauthCount: number;
  email?: string | null;
  phone?: string | null;
}

export interface IdentitiesResult {
  ok?: boolean;
  identities: LinkedIdentity[];
  methods: IdentityMethods;
}

interface PushSignOutAdapter {
  getCachedRegistrationDeviceId(): Promise<string | null>;
  completeSignOutCleanup(deviceId: string): Promise<void>;
}

/** Minimal Linking interface — compatible with react-native Linking API */
export interface LinkingAdapter {
  openURL(url: string): Promise<void>;
  addEventListener(type: 'url', handler: (event: { url: string }) => void): { remove: () => void };
  getInitialURL(): Promise<string | null>;
}

type OAuthStartOptions = {
  provider: string;
  redirectUrl: string;
  captchaToken?: string;
};

const OAUTH_RECOVERY_NONCE_PARAM = 'oauth_recovery_nonce';

function requireClaimedHttpsOAuthRedirect(value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new EdgeBaseError(
      400,
      'React Native OAuth requires a claimed HTTPS Universal Link or Android App Link redirectUrl.',
      undefined,
      'validation-failed',
    );
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('unsafe');
    parsed.hash = '';
    return parsed.toString();
  } catch {
    throw new EdgeBaseError(
      400,
      'OAuth redirectUrl must be an absolute claimed HTTPS Universal Link or Android App Link.',
      undefined,
      'validation-failed',
    );
  }
}

// ─── AuthClient ───

export class AuthClient {
  private baseUrl: string;
  private authTransition = 0;
  private pendingRevocationRetry: Promise<void> | null = null;
  private readonly pendingOAuthCompletionRetries = new Map<string, Promise<AuthResult | null>>();

  constructor(
    private client: HttpClient,
    private tokenManager: TokenManager,
    private core: GeneratedDbApi,
    private corePublic: GeneratedDbApi,
    private linking?: LinkingAdapter,
    private pushSignOut?: PushSignOutAdapter,
  ) {
    this.baseUrl = client.getBaseUrl();
    // Retry crash/offline-safe revocations once on cold start. Failures stay
    // queued in secure storage and are retried before the next auth mutation.
    void this.tokenManager.ready()
      .then(() => this.retryPendingSessionRevocations())
      .then(() => this.retryNewestPendingOAuthTicket())
      .catch(() => undefined);
  }

  private async invalidateCaptchaConfigOnFailure<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const data = error instanceof EdgeBaseError ? error.data as unknown : null;
      if (
        error instanceof EdgeBaseError
        && error.code === 403
        && data
        && typeof data === 'object'
        && (data as Record<string, unknown>).captcha_required === true
      ) {
        // React Native tokens are caller/UI-owned. Never replay one here; only
        // make the next documented WebView reset fetch the current site key.
        invalidateSiteKeyCache(this.baseUrl);
      }
      throw error;
    }
  }

  private beginAuthTransition(): number {
    this.authTransition += 1;
    return this.authTransition;
  }

  private assertAuthTransition(transition: number): void {
    if (transition !== this.authTransition) {
      throw new EdgeBaseError(
        401,
        'A newer authentication transition superseded this response.',
        undefined,
        'auth-state-changed',
      );
    }
  }

  private async runAuthoritativeAuthOperation<T>(
    operation: () => Promise<T>,
    authResult: (value: T) => AuthResult | null,
    preserveOAuthCompletionTicket?: string,
  ): Promise<T> {
    const transition = this.beginAuthTransition();
    return this.tokenManager.runAuthMutation(async () => {
      try {
        await this.retryPendingSessionRevocations();
      } catch {
        throw new EdgeBaseError(
          503,
          'A previous session still requires server revocation. Retry after connectivity recovers.',
          undefined,
          'signout-pending',
        );
      }
      // Last-started explicit identity transition wins before any queued
      // request can reach the server.
      this.assertAuthTransition(transition);
      const authEpoch = await this.tokenManager.beginAuthoritativeAuthTransition(
        preserveOAuthCompletionTicket,
      );
      const value = await operation();
      const result = authResult(value);
      try {
        this.assertAuthTransition(transition);
        if (result) {
          await this.tokenManager.setTokensPersisted({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
          }, authEpoch);
        }
      } catch (error) {
        // The server may already have created a session even though a newer
        // sign-in/sign-out won locally. Persist cleanup authority before any
        // best-effort network call so the session cannot become a ghost after
        // a crash or offline transition.
        const supersededOAuthCompletion = preserveOAuthCompletionTicket
          && error instanceof EdgeBaseError
          && error.slug === 'auth-state-changed';
        if (result?.refreshToken && (!preserveOAuthCompletionTicket || supersededOAuthCompletion)) {
          await this.revokeUnadoptedSession(result.refreshToken);
        }
        throw error;
      }
      return value;
    });
  }

  private async revokeRefreshToken(pending: Pick<PendingSessionRevocation, 'refreshToken' | 'pushDeviceId'>): Promise<void> {
    try {
      await this.client.postPublic('/api/auth/signout', {
        refreshToken: pending.refreshToken,
        ...(pending.pushDeviceId ? { pushDeviceId: pending.pushDeviceId } : {}),
      });
    } catch (error) {
      if (error instanceof EdgeBaseError && error.code === 401) return;
      throw error;
    }
  }

  private async revokeUnadoptedSession(refreshToken: string): Promise<void> {
    await this.tokenManager.addPendingSessionRevocation(refreshToken);
    // Do not make rejection of the superseded local operation depend on an
    // unbounded network call. Cleanup authority is already durable; start a
    // best-effort revoke and retain the queue on any failure/hang.
    void (async () => {
      try {
        await this.revokeRefreshToken({ refreshToken });
        await this.tokenManager.completePendingSessionRevocation(refreshToken);
        await this.tokenManager.completePendingSignOutIfRevoked();
      } catch {
        // A queued auth operation, cold start, or later sign-out retries it.
      }
    })();
  }

  private retryPendingSessionRevocations(): Promise<void> {
    if (this.pendingRevocationRetry) return this.pendingRevocationRetry;
    const retry = (async () => {
      const pending = await this.tokenManager.getPendingSessionRevocations();
      for (const storedRevocation of pending) {
        let revocation = storedRevocation;
        try {
          if (revocation.pushCleanupPending) {
            const pushDeviceId = await this.pushSignOut?.getCachedRegistrationDeviceId() ?? null;
            await this.tokenManager.resolvePendingPushCleanup(revocation.refreshToken, pushDeviceId);
            revocation = { ...revocation, pushDeviceId: pushDeviceId ?? undefined, pushCleanupPending: false };
          }
          await this.revokeRefreshToken(revocation);
          if (revocation.pushDeviceId) {
            await this.pushSignOut?.completeSignOutCleanup(revocation.pushDeviceId);
          }
          await this.tokenManager.completePendingSessionRevocation(revocation.refreshToken);
        } catch (error) {
          throw error;
        }
      }
      await this.tokenManager.completePendingSignOutIfRevoked();
    })().finally(() => {
      if (this.pendingRevocationRetry === retry) this.pendingRevocationRetry = null;
    });
    this.pendingRevocationRetry = retry;
    return retry;
  }

  private async ensureAuthenticatedRequestReady(): Promise<void> {
    const candidate = this.client as HttpClient & { getAuthHeaders?: () => Promise<Record<string, string>> };
    if (typeof candidate.getAuthHeaders === 'function') await candidate.getAuthHeaders();
  }

  private completePendingOAuthTicket(
    supplied?: PendingOAuthCompletion,
  ): Promise<AuthResult | null> {
    return (async () => {
      const pending = supplied ?? await this.tokenManager.getPendingOAuthCompletion();
      if (!pending) return null;
      const existing = this.pendingOAuthCompletionRetries.get(pending.ticket);
      if (existing) return existing;
      const retry = this.performPendingOAuthTicket(pending).finally(() => {
        if (this.pendingOAuthCompletionRetries.get(pending.ticket) === retry) {
          this.pendingOAuthCompletionRetries.delete(pending.ticket);
        }
      });
      this.pendingOAuthCompletionRetries.set(pending.ticket, retry);
      return retry;
    })().then((result) => result);
  }

  private async retryNewestPendingOAuthTicket(): Promise<void> {
    const pending = await this.tokenManager.getPendingOAuthCompletion();
    if (pending) await this.completePendingOAuthTicket(pending).catch(() => null);
  }

  private async performPendingOAuthTicket(
    supplied?: PendingOAuthCompletion,
  ): Promise<AuthResult | null> {
    const pending = supplied ?? await this.tokenManager.getPendingOAuthCompletion();
    if (!pending) return null;
    try {
      await this.tokenManager.storePendingOAuthCompletion(pending);
    } catch {
      throw new EdgeBaseError(
        0,
        'OAuth completion ticket could not be persisted. Free secure storage and retry.',
        undefined,
        'oauth-completion-persist-failed',
      );
    }
    if (pending.authTransport !== 'body') {
      await this.tokenManager.clearPendingOAuthCompletions();
      return null;
    }
    try {
      if (pending.kind === 'link') await this.ensureAuthenticatedRequestReady();
      const result = await this.runAuthoritativeAuthOperation(
        () => pending.kind === 'link'
          ? this.client.post<AuthResult>('/api/auth/oauth/complete/link', {
              ticket: pending.ticket,
              oauthRecoveryNonce: pending.recoveryNonce ?? undefined,
            })
          : this.client.postPublic<AuthResult>('/api/auth/oauth/exchange', {
              ticket: pending.ticket,
              oauthRecoveryNonce: pending.recoveryNonce ?? undefined,
            }),
        (value) => value,
        pending.ticket,
      );
      // The durable auth result is the sole winner. Remove every sibling
      // callback nonce/ticket so a terminated app cannot later adopt an older
      // account after relaunch.
      await this.tokenManager.clearPendingOAuthRecovery();
      await this.tokenManager.clearPendingOAuthCompletions();
      const user = this.tokenManager.getCurrentUser();
      if (!user || !result.accessToken || !result.refreshToken) return null;
      return { ...result, user };
    } catch (error) {
      if (
        error instanceof EdgeBaseError
        && error.code >= 400
        && error.code < 500
        && error.code !== 408
        && error.code !== 429
        && error.slug !== 'auth-state-changed'
      ) {
        await this.tokenManager.clearPendingOAuthCompletion(pending.ticket);
      }
      throw error;
    }
  }

  /** Register a new user. Optionally include user metadata. */
  async signUp(options: SignUpOptions): Promise<AuthResult> {
    const body: Record<string, unknown> = {
      email: options.email,
      password: options.password,
    };
    if (options.data) body.data = options.data;
    if (options.captchaToken) body.captchaToken = options.captchaToken;

    return this.runAuthoritativeAuthOperation(
      () => this.invalidateCaptchaConfigOnFailure(
        () => this.corePublic.authSignup(body) as Promise<AuthResult>,
      ),
      (result) => result,
    );
  }

  /** Sign in with email and password. Returns MfaRequiredResult if MFA is enabled. */
  async signIn(options: SignInOptions): Promise<SignInResult> {
    const body: Record<string, unknown> = {
      email: options.email,
      password: options.password,
    };
    if (options.captchaToken) body.captchaToken = options.captchaToken;

    return this.runAuthoritativeAuthOperation(
      () => this.invalidateCaptchaConfigOnFailure(
        () => this.corePublic.authSignin(body) as Promise<SignInResult>,
      ),
      (result) => 'mfaRequired' in result && result.mfaRequired
        ? null
        : result as AuthResult,
    );
  }

  /** Sign out — revokes current session on server and clears local tokens. */
  async signOut(options?: { pushDeviceId?: string }): Promise<void> {
    this.beginAuthTransition();
    await this.tokenManager.ready();
    const refreshToken = this.tokenManager.getRefreshToken();
    // Local invalidation and epoch advancement happen before any network wait,
    // so a late OAuth/refresh response can never resurrect the session.
    let persistenceError: unknown;
    try {
      await this.tokenManager.beginPendingSignOut(
        refreshToken,
        options?.pushDeviceId,
        Boolean(!options?.pushDeviceId && this.pushSignOut),
      );
    } catch (error) {
      persistenceError = error;
      // In-memory auth is already cleared; still attempt server revocation.
    }
    // Revocation is serialized after any in-flight token-producing operation,
    // but signOut itself never waits on an offline/hung request. The durable
    // queue is cleared only after the server confirms every revoke.
    void this.tokenManager.runAuthMutation(
      () => this.retryPendingSessionRevocations(),
    ).catch(() => undefined);
    if (persistenceError) {
      throw new EdgeBaseError(
        0,
        'Sign-out cleared memory and attempted server revocation, but durable local sign-out failed. Retry sign-out before closing the app.',
        undefined,
        'signout-persistence-failed',
      );
    }
  }

  /** Refresh the current session using the stored refresh token. */
  async refreshSession(): Promise<AuthResult> {
    const refreshEpoch = await this.tokenManager.captureAuthEpoch();
    const refreshToken = await this.tokenManager.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available.');
    }
    return this.tokenManager.runAuthMutation(async () => {
      await this.tokenManager.assertRefreshSource(refreshToken, refreshEpoch);
      const result = await this.corePublic.authRefresh({ refreshToken }) as AuthResult;
      await this.tokenManager.setTokensPersisted({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      }, refreshEpoch);
      return result;
    });
  }

  /**
   * Start OAuth sign-in flow.
   * Opens the OAuth URL via Linking.openURL() and listens for the deep link callback.
   * The app must own a claimed HTTPS Universal Link / Android App Link.
   *
   * @param provider - OAuth provider name (e.g. 'google', 'github')
   * @param options.redirectUrl - Deep link URL to redirect back to after OAuth (required for RN)
   * @param options.captchaToken - Optional captcha token
   * @returns Promise resolving to the provider start URL after the one-shot
   * callback nonce has been persisted (and opened when Linking is configured)
   *
   * NOTE: Not delegated to Generated Core — this is URL construction + redirect, not a standard HTTP call.
   */
  async signInWithOAuth(options: OAuthStartOptions): Promise<{ url: string }>;
  async signInWithOAuth(
    provider: string,
    options: { redirectUrl: string; captchaToken?: string },
  ): Promise<{ url: string }>;
  async signInWithOAuth(
    providerOrOptions: string | OAuthStartOptions,
    options?: { redirectUrl: string; captchaToken?: string },
  ): Promise<{ url: string }> {
    const provider = typeof providerOrOptions === 'string'
      ? providerOrOptions
      : providerOrOptions.provider;
    const resolvedOptions = typeof providerOrOptions === 'string'
      ? options
      : providerOrOptions;
    const redirectUrl = requireClaimedHttpsOAuthRedirect(resolvedOptions?.redirectUrl);
    let url = `${this.baseUrl}/api/auth/oauth/${encodeURIComponent(provider)}`;
    if (resolvedOptions?.captchaToken) {
      url += `?captcha_token=${encodeURIComponent(resolvedOptions.captchaToken)}`;
    }
    const redirectSeparator = url.includes('?') ? '&' : '?';
    url += `${redirectSeparator}redirect_url=${encodeURIComponent(redirectUrl)}`;

    const recoveryNonce = await this.tokenManager.markPendingOAuthRecovery(redirectUrl);
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}${OAUTH_RECOVERY_NONCE_PARAM}=${encodeURIComponent(recoveryNonce)}`;

    // Open in system browser via Linking API
    if (this.linking) {
      try {
        await this.linking.openURL(url);
      } catch (error) {
        await this.tokenManager.clearPendingOAuthRecovery(recoveryNonce);
        throw error;
      }
    }

    return { url };
  }

  /**
   * Handle OAuth deep link callback.
   * Call this when your app receives a deep link URL with auth tokens.
   * Accept the server's fragment (with query fallback for custom deep-link
   * bridges), consume its one-shot nonce, and rotate the refresh token with the
   * server before adopting any credential.
   *
   * @example
   * // In your navigation/linking config:
   * Linking.addEventListener('url', ({ url }) => client.auth.handleOAuthCallback(url));
   */
  async handleOAuthCallback(url?: string): Promise<AuthResult | null> {
    if (!url) {
      try {
        return await this.completePendingOAuthTicket();
      } catch {
        return null;
      }
    }
    const observedTransition = this.authTransition;
    try {
      const parsed = new URL(url);
      const fragment = new URLSearchParams(
        parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash,
      );
      const getParam = (key: string): string | null =>
        fragment.get(key) ?? parsed.searchParams.get(key);
      const callbackEpoch = await this.tokenManager.captureAuthEpoch();
      const recoveryNonce = getParam(OAUTH_RECOVERY_NONCE_PARAM);
      const callbackBound = await this.tokenManager.consumePendingOAuthRecovery(
        recoveryNonce,
        callbackEpoch,
        url,
      );
      if (!callbackBound || getParam('error')) return null;
      const exchangeTicket = getParam('oauth_exchange_ticket');
      const linkTicket = getParam('oauth_link_ticket');
      if ((!exchangeTicket && !linkTicket) || (exchangeTicket && linkTicket)) return null;
      this.assertAuthTransition(observedTransition);
      const ticket = linkTicket ?? exchangeTicket!;
      const pending: PendingOAuthCompletion = {
        ticket,
        recoveryNonce,
        kind: linkTicket ? 'link' : 'signin',
        authTransport: 'body',
        createdAt: Date.now(),
        authEpoch: callbackEpoch,
      };
      try {
        await this.tokenManager.storePendingOAuthCompletion(pending);
      } catch {
        throw new EdgeBaseError(
          0,
          'OAuth completion ticket could not be persisted. Free secure storage and retry.',
          undefined,
          'oauth-completion-persist-failed',
        );
      }
      return await this.completePendingOAuthTicket(pending);
    } catch (error) {
      if (
        error instanceof EdgeBaseError
        && [
          'auth-token-persistence-failed',
          'auth-state-changed',
          'oauth-completion-persist-failed',
        ].includes(error.slug ?? '')
      ) throw error;
      return null;
    }
  }

  /** Complete a callback that launched a previously terminated app. */
  async handleInitialOAuthCallback(): Promise<AuthResult | null> {
    if (!this.linking) return null;
    const initialUrl = await this.linking.getInitialURL();
    return this.handleOAuthCallback(initialUrl ?? undefined);
  }

  /** Sign in anonymously. */
  async signInAnonymously(options?: { captchaToken?: string }): Promise<AuthResult> {
    const body: Record<string, unknown> | undefined = options?.captchaToken
      ? { captchaToken: options.captchaToken }
      : undefined;
    return this.runAuthoritativeAuthOperation(
      () => this.invalidateCaptchaConfigOnFailure(
        () => this.corePublic.authSigninAnonymous(body) as Promise<AuthResult>,
      ),
      (result) => result,
    );
  }

  /**
   * Send a magic link (passwordless login) email.
   * If the email is not registered and autoCreate is enabled (server config), a new account is created.
   */
  async signInWithMagicLink(options: { email: string; captchaToken?: string }): Promise<void> {
    const body: Record<string, unknown> = { email: options.email };
    if (options.captchaToken) {
      body.captchaToken = options.captchaToken;
    }
    await this.invalidateCaptchaConfigOnFailure(
      () => this.corePublic.authSigninMagicLink(body),
    );
  }

  /**
   * Verify a magic link token and sign in.
   * Called after user clicks the link from their email.
   */
  async verifyMagicLink(token: string): Promise<AuthResult> {
    return this.runAuthoritativeAuthOperation(
      () => this.corePublic.authVerifyMagicLink({ token }) as Promise<AuthResult>,
      (result) => result,
    );
  }

  // ─── Phone / SMS Auth ───

  /**
   * Send an SMS verification code to the given phone number.
   * If the phone is not registered and autoCreate is enabled (server config), a new account is created on verify.
   */
  async signInWithPhone(options: { phone: string; captchaToken?: string }): Promise<void> {
    const body: Record<string, unknown> = { phone: options.phone };
    if (options.captchaToken) {
      body.captchaToken = options.captchaToken;
    }
    await this.invalidateCaptchaConfigOnFailure(
      () => this.corePublic.authSigninPhone(body),
    );
  }

  /**
   * Verify the SMS code and sign in.
   * Called after user receives the code from signInWithPhone.
   */
  async verifyPhone(options: { phone: string; code: string }): Promise<AuthResult> {
    return this.runAuthoritativeAuthOperation(
      () => this.corePublic.authVerifyPhone({
        phone: options.phone,
        code: options.code,
      }) as Promise<AuthResult>,
      (result) => result,
    );
  }

  /** Link current account with a phone number. Sends an SMS code. */
  async linkWithPhone(options: { phone: string }): Promise<void> {
    await this.core.authLinkPhone({ phone: options.phone });
  }

  /** Verify phone link code. Anonymous upgrades return and adopt a replacement session. */
  async verifyLinkPhone(options: { phone: string; code: string }): Promise<AuthResult | void> {
    const result = await this.runAuthoritativeAuthOperation(
      () => this.core.authVerifyLinkPhone({
        phone: options.phone,
        code: options.code,
      }) as Promise<AuthResult | { ok: true }>,
      (value) => isAuthResult(value) ? value : null,
    );
    return isAuthResult(result) ? result : undefined;
  }

  /** Link anonymous account to email/password. */
  async linkWithEmail(options: { email: string; password: string }): Promise<AuthResult> {
    await this.ensureAuthenticatedRequestReady();
    return this.runAuthoritativeAuthOperation(
      () => this.core.authLinkEmail({
        email: options.email,
        password: options.password,
      }) as Promise<AuthResult>,
      (result) => result,
    );
  }

  /**
   * Link anonymous account to OAuth provider. Returns URL to open in browser.
   */
  async linkWithOAuth(options: { provider: string; redirectUrl: string }): Promise<{ redirectUrl: string }>;
  async linkWithOAuth(
    provider: string,
    options: { redirectUrl: string },
  ): Promise<{ redirectUrl: string }>;
  async linkWithOAuth(
    providerOrOptions: string | { provider: string; redirectUrl: string },
    options?: { redirectUrl: string },
  ): Promise<{ redirectUrl: string }> {
    const provider = typeof providerOrOptions === 'string'
      ? providerOrOptions
      : providerOrOptions.provider;
    const resolvedOptions = typeof providerOrOptions === 'string'
      ? options
      : providerOrOptions;
    const redirectUrl = requireClaimedHttpsOAuthRedirect(resolvedOptions?.redirectUrl);
    const recoveryNonce = await this.tokenManager.markPendingOAuthRecovery(redirectUrl);
    let result: { redirectUrl: string };
    try {
      result = await this.core.oauthLinkStart(provider, {
        redirectUrl,
        oauthRecoveryNonce: recoveryNonce,
      }) as { redirectUrl: string };
    } catch (error) {
      await this.tokenManager.clearPendingOAuthRecovery(recoveryNonce);
      throw error;
    }
    if (this.linking) {
      try {
        await this.linking.openURL(result.redirectUrl);
      } catch (error) {
        await this.tokenManager.clearPendingOAuthRecovery(recoveryNonce);
        throw error;
      }
    }
    return result;
  }

  /** Subscribe to authentication state changes. */
  onAuthStateChange(callback: AuthStateChangeHandler): () => void {
    return this.tokenManager.onAuthStateChange(callback);
  }

  /** Get current authenticated user (from cached JWT). */
  get currentUser(): TokenUser | null {
    return this.tokenManager.getCurrentUser();
  }

  /** List active sessions. */
  async listSessions(): Promise<Session[]> {
    const result = await this.core.authGetSessions() as { sessions: Session[] };
    return result.sessions;
  }

  /** Revoke a specific session. */
  async revokeSession(sessionId: string): Promise<void> {
    await this.core.authDeleteSession(sessionId);
  }

  /** Update current user's profile. */
  async updateProfile(data: UpdateProfileOptions): Promise<TokenUser> {
    await this.ensureAuthenticatedRequestReady();
    await this.runAuthoritativeAuthOperation(
      () => this.core.authUpdateProfile(data) as Promise<AuthResult>,
      (result) => result.accessToken && result.refreshToken ? result : null,
    );
    return this.tokenManager.getCurrentUser()!;
  }

  /** Verify email address with token. */
  async verifyEmail(token: string): Promise<void> {
    await this.corePublic.authVerifyEmail({ token });
  }

  /** Request a verification email for the current user. */
  async requestEmailVerification(options?: { redirectUrl?: string }): Promise<void> {
    const body: Record<string, unknown> = {};
    if (options?.redirectUrl) body.redirectUrl = options.redirectUrl;
    await this.core.authRequestEmailVerification(body);
  }

  /** Verify a pending email change using the emailed token. */
  async verifyEmailChange(token: string): Promise<void> {
    await this.corePublic.authVerifyEmailChange({ token });
  }

  /** Request password reset email. */
  async requestPasswordReset(
    email: string,
    options?: { captchaToken?: string },
  ): Promise<void> {
    const body: Record<string, unknown> = { email };
    if (options?.captchaToken) body.captchaToken = options.captchaToken;
    await this.invalidateCaptchaConfigOnFailure(
      () => this.corePublic.authRequestPasswordReset(body),
    );
  }

  /** Reset password with token. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.corePublic.authResetPassword({ token, newPassword });
  }

  /** Change password for authenticated user. */
  async changePassword(options: {
    currentPassword: string;
    newPassword: string;
  }): Promise<AuthResult> {
    await this.ensureAuthenticatedRequestReady();
    return this.runAuthoritativeAuthOperation(
      () => this.core.authChangePassword({
        currentPassword: options.currentPassword,
        newPassword: options.newPassword,
      }) as Promise<AuthResult>,
      (result) => result,
    );
  }

  /** Request an email change for the authenticated user. */
  async changeEmail(options: { newEmail: string; password: string; redirectUrl?: string }): Promise<void> {
    const body: Record<string, unknown> = {
      newEmail: options.newEmail,
      password: options.password,
    };
    if (options.redirectUrl) body.redirectUrl = options.redirectUrl;
    await this.client.post('/api/auth/change-email', body);
  }

  /** List linked sign-in identities for the current user. */
  async listIdentities(): Promise<IdentitiesResult> {
    return this.client.get('/api/auth/identities') as Promise<IdentitiesResult>;
  }

  /** Unlink a linked OAuth identity by its identity ID. */
  async unlinkIdentity(identityId: string): Promise<IdentitiesResult> {
    return this.client.delete(`/api/auth/identities/${encodeURIComponent(identityId)}`) as Promise<IdentitiesResult>;
  }

  /** Send an email OTP code for sign-in. */
  async signInWithEmailOtp(options: { email: string }): Promise<void> {
    await this.corePublic.authSigninEmailOtp({ email: options.email });
  }

  /** Verify an email OTP code and sign in. */
  async verifyEmailOtp(options: { email: string; code: string }): Promise<AuthResult> {
    return this.runAuthoritativeAuthOperation(
      () => this.corePublic.authVerifyEmailOtp({
        email: options.email,
        code: options.code,
      }) as Promise<AuthResult>,
      (result) => result,
    );
  }

  // ─── Passkeys / WebAuthn REST layer ───

  /** Generate WebAuthn registration options for the current authenticated user. */
  async passkeysRegisterOptions(): Promise<unknown> {
    return this.core.authPasskeysRegisterOptions();
  }

  /** Verify and store a passkey registration response from the platform credential API. */
  async passkeysRegister(response: unknown): Promise<unknown> {
    return this.core.authPasskeysRegister({ response });
  }

  /** Generate WebAuthn authentication options. */
  async passkeysAuthOptions(options?: PasskeysAuthOptions): Promise<unknown> {
    return this.corePublic.authPasskeysAuthOptions(options ?? {});
  }

  /** Verify a WebAuthn assertion and establish a session. */
  async passkeysAuthenticate(response: unknown): Promise<AuthResult> {
    return this.runAuthoritativeAuthOperation(
      () => this.corePublic.authPasskeysAuthenticate({ response }) as Promise<AuthResult>,
      (result) => result,
    );
  }

  /** List registered passkeys for the current authenticated user. */
  async passkeysList(): Promise<unknown> {
    return this.core.authPasskeysList();
  }

  /** Delete a registered passkey by credential ID. */
  async passkeysDelete(credentialId: string): Promise<unknown> {
    return this.core.authPasskeysDelete(credentialId);
  }

  // ─── MFA / TOTP ───

  /** MFA sub-namespace for TOTP enrollment, verification, and management. */
  get mfa() {
    const client = this.client;
    const core = this.core;
    const corePublic = this.corePublic;
    const tokenManager = this.tokenManager;
    const authClient = this;
    return {
      /** Enroll TOTP — returns secret, QR code URI, and recovery codes. */
      async enrollTotp(): Promise<TotpEnrollResult> {
        return core.authMfaTotpEnroll() as Promise<TotpEnrollResult>;
      },

      /** Verify TOTP enrollment with factorId and a TOTP code. */
      async verifyTotpEnrollment(factorId: string, code: string): Promise<{ ok: true }> {
        return core.authMfaTotpVerify({ factorId, code }) as Promise<{ ok: true }>;
      },

      /** Verify TOTP code during MFA challenge (after signIn returns mfaRequired). */
      async verifyTotp(mfaTicket: string, code: string): Promise<AuthResult> {
        return authClient.runAuthoritativeAuthOperation(
          () => corePublic.authMfaVerify({ mfaTicket, code }) as Promise<AuthResult>,
          (result) => result,
        );
      },

      /** Use a recovery code during MFA challenge. */
      async useRecoveryCode(mfaTicket: string, recoveryCode: string): Promise<AuthResult> {
        return authClient.runAuthoritativeAuthOperation(
          () => corePublic.authMfaRecovery({ mfaTicket, recoveryCode }) as Promise<AuthResult>,
          (result) => result,
        );
      },

      /**
       * Disable TOTP for the current user. Requires password or TOTP code.
       */
      async disableTotp(options?: DisableTotpOptions): Promise<{ ok: true }> {
        return core.authMfaTotpDelete(options ?? {}) as Promise<{ ok: true }>;
      },

      /** List enrolled MFA factors for the current user. */
      async listFactors(): Promise<{ factors: MfaFactor[] }> {
        return core.authMfaFactors() as Promise<{ factors: MfaFactor[] }>;
      },
    };
  }

}
