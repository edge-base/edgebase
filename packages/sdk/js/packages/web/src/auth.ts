/**
 * Auth client for user authentication
 *: onAuthStateChange
 *: signInAnonymously
 *: signUp with data
 */

import { EdgeBaseError } from '@edge-base/core';
import type { HttpClient, GeneratedDbApi } from '@edge-base/core';
import type {
  TokenManager,
  TokenUser,
  AuthStateChangeHandler,
  PendingOAuthCompletion,
} from './token-manager.js';
import { invalidateSiteKeyCache, resolveCaptchaToken } from './turnstile.js';

export interface SignUpOptions {
  email: string;
  password: string;
  data?: {
    displayName?: string;
    avatarUrl?: string;
    [key: string]: unknown;
  };
  /** Preferred locale for this user (e.g. 'ko', 'ja'). Stored in user profile. */
  locale?: string;
  /** Captcha token. If provided, SDK built-in widget is skipped. */
  captchaToken?: string;
}

export interface SignInOptions {
  email: string;
  password: string;
  /** Captcha token. If provided, SDK built-in widget is skipped. */
  captchaToken?: string;
}

export interface AuthResult {
  user: TokenUser;
  accessToken: string;
  /** Rotating credential in body mode; the compatibility-safe empty string in cookie mode. */
  refreshToken: string;
  /** Identifies a response backed by the server-managed HttpOnly refresh cookie. */
  sessionTransport?: 'cookie';
  /** Stable server session identifier (also carried as the access-token `sid`). */
  sessionId?: string;
}

function isFullAuthResult(value: unknown): value is AuthResult {
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

/** Type guard to narrow SignInResult to AuthResult (i.e. MFA was not required). */
export function isAuthResult(result: SignInResult): result is AuthResult {
  return 'accessToken' in result;
}

/** Type guard to narrow SignInResult to MfaRequiredResult. */
export function isMfaRequired(result: SignInResult): result is MfaRequiredResult {
  return 'mfaRequired' in result && (result as MfaRequiredResult).mfaRequired === true;
}

export interface TotpEnrollResult {
  factorId: string;
  secret: string;
  qrCodeUri: string;
  recoveryCodes: string[];
}

export interface RecoveryCodesResult {
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
  current?: boolean;
}

export interface UpdateProfileOptions {
  displayName?: string;
  avatarUrl?: string;
  emailVisibility?: string;
  /** Preferred locale (e.g. 'ko', 'ja'). Future auth emails will use this language. */
  locale?: string;
}

export interface PasskeysAuthOptions {
  email?: string;
}

interface OAuthRedirectOptions {
  redirectUrl?: string;
  redirectTo?: string;
  navigate?: boolean;
}

type OAuthStartOptions = OAuthRedirectOptions & {
  provider: string;
  captchaToken?: string;
};

export interface EmailActionRedirectOptions {
  redirectUrl?: string;
  state?: string;
}

interface LinkOAuthOptions extends OAuthRedirectOptions {
  state?: string;
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

function getDefaultBrowserOAuthRedirectUrl(): string {
  if (typeof window === 'undefined') return '';
  const origin = window.location?.origin;
  if (!origin || origin === 'null') return '';
  return `${origin}/auth/callback`;
}

function resolveOAuthRedirectUrl(options?: OAuthRedirectOptions): string {
  return options?.redirectUrl ?? options?.redirectTo ?? getDefaultBrowserOAuthRedirectUrl();
}

const OAUTH_RECOVERY_NONCE_PARAM = 'oauth_recovery_nonce' as const;

function toTokenUser(user: unknown): TokenUser | null {
  if (!user || typeof user !== 'object') return null;
  const source = user as Record<string, unknown>;
  const id = source.id ?? source.sub;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const custom =
    source.custom && typeof source.custom === 'object'
      ? source.custom as Record<string, unknown>
      : source.customClaims && typeof source.customClaims === 'object'
        ? source.customClaims as Record<string, unknown>
        : undefined;

  return {
    id: String(id),
    email: typeof source.email === 'string' ? source.email : undefined,
    displayName: typeof source.displayName === 'string' ? source.displayName : undefined,
    avatarUrl: typeof source.avatarUrl === 'string' ? source.avatarUrl : undefined,
    role: typeof source.role === 'string' ? source.role : undefined,
    isAnonymous: typeof source.isAnonymous === 'boolean' ? source.isAnonymous : undefined,
    emailVisibility: typeof source.emailVisibility === 'string' ? source.emailVisibility : undefined,
    custom,
  };
}

const PENDING_SIGN_OUT_RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;

export class AuthClient {
  private baseUrl: string;
  private pendingSignOutRetry: Promise<void> | null = null;
  private pendingSignOutRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSignOutRetryAttempt = 0;
  private lastPendingSignOutError: unknown = null;
  private pendingLegacyRevocationToken: string | null = null;
  private readonly pendingOAuthCompletionRetries = new Map<string, Promise<AuthResult | null>>();
  private readonly onlineHandler = () => {
    this.cancelScheduledSignOutRetry();
    void this.retryPendingSignOut();
    this.retryNewestPendingOAuthTicket();
  };

  constructor(
    private client: HttpClient,
    private tokenManager: TokenManager,
    private core: GeneratedDbApi,
    private corePublic: GeneratedDbApi,
  ) {
    this.baseUrl = client.getBaseUrl();
    if (this.tokenManager.usesHttpOnlyCookie && typeof window !== 'undefined') {
      this.tokenManager.setCookieRevalidationHandler(async () => {
        const result = await this.corePublic.authRefresh({}) as AuthResult;
        if (!result.accessToken) {
          throw new EdgeBaseError(500, 'Cookie session refresh did not return an access token.');
        }
        return { accessToken: result.accessToken, refreshToken: '' };
      });
      if (this.tokenManager.hasPendingSignOut()) {
        void this.retryPendingSignOut();
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onlineHandler);
      this.retryNewestPendingOAuthTicket();
    }
  }

  private isCaptchaRequiredError(error: unknown): error is EdgeBaseError {
    if (!(error instanceof EdgeBaseError) || error.code !== 403) return false;
    const data = error.data as unknown;
    return Boolean(
      data
      && typeof data === 'object'
      && (data as Record<string, unknown>).captcha_required === true,
    );
  }

  /**
   * Recover once when an automatically acquired token came from a cached
   * pre-rotation site key. Explicit caller tokens are never replayed, and a
   * second CAPTCHA rejection is returned unchanged.
   */
  private async runCaptchaProtected<T>(
    action: string,
    explicitToken: string | undefined,
    operation: (captchaToken: string | undefined) => Promise<T>,
  ): Promise<T> {
    const firstToken = await resolveCaptchaToken(this.baseUrl, action, explicitToken);
    try {
      return await operation(firstToken);
    } catch (error) {
      if (explicitToken || !this.isCaptchaRequiredError(error)) throw error;
      invalidateSiteKeyCache(this.baseUrl);
      const replacementToken = await resolveCaptchaToken(this.baseUrl, action);
      if (!replacementToken) throw error;
      return operation(replacementToken);
    }
  }

  private syncAuthResult(
    result: Partial<AuthResult>,
    authoritativeIdentityTransition = false,
    preserveOAuthCompletionTicket?: string,
  ): TokenUser | null {
    if (authoritativeIdentityTransition) {
      this.tokenManager.commitAuthoritativeAuthTransition(preserveOAuthCompletionTicket);
    }
    if (this.tokenManager.usesHttpOnlyCookie && result.accessToken) {
      // Fail safe if an older/misconfigured server includes the credential:
      // cookie-mode callers receive the required compatibility property, but
      // never the credential. Keeping the field required avoids a patch-level
      // TypeScript API break for strict consumers.
      result.refreshToken = '';
      result.sessionTransport = 'cookie';
    }
    const normalizedUser = result.user ? toTokenUser(result.user) : null;
    const mergedUser = normalizedUser
      ? {
          ...(this.tokenManager.getCurrentUser() ?? {}),
          ...normalizedUser,
        }
      : undefined;

    if (result.accessToken && (result.refreshToken || this.tokenManager.usesHttpOnlyCookie)) {
      this.tokenManager.setTokens({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken ?? '',
      }, mergedUser);
      return this.tokenManager.getCurrentUser();
    }

    if (result.accessToken) {
      this.tokenManager.setAccessToken(result.accessToken, mergedUser);
      return this.tokenManager.getCurrentUser();
    }

    if (mergedUser) {
      this.tokenManager.setCurrentUser(mergedUser);
      return mergedUser;
    }

    return this.tokenManager.getCurrentUser();
  }

  private completePendingOAuthTicket(
    supplied?: PendingOAuthCompletion,
  ): Promise<AuthResult | null> {
    const pending = supplied ?? this.tokenManager.getPendingOAuthCompletion();
    if (!pending) return Promise.resolve(null);
    const existing = this.pendingOAuthCompletionRetries.get(pending.ticket);
    if (existing) return existing;
    const retry = this.performPendingOAuthTicket(pending).finally(() => {
      if (this.pendingOAuthCompletionRetries.get(pending.ticket) === retry) {
        this.pendingOAuthCompletionRetries.delete(pending.ticket);
      }
    });
    this.pendingOAuthCompletionRetries.set(pending.ticket, retry);
    return retry;
  }

  private retryNewestPendingOAuthTicket(): void {
    const pending = this.tokenManager.getPendingOAuthCompletion();
    if (pending) void this.completePendingOAuthTicket(pending).catch(() => undefined);
  }

  private async performPendingOAuthTicket(
    supplied?: PendingOAuthCompletion,
  ): Promise<AuthResult | null> {
    const pending = supplied ?? this.tokenManager.getPendingOAuthCompletion();
    if (!pending) return null;
    if (!this.tokenManager.storePendingOAuthCompletion(pending)) {
      throw new EdgeBaseError(
        0,
        'OAuth completion ticket could not be persisted. Free browser storage and retry.',
        undefined,
        'oauth-completion-persist-failed',
      );
    }
    const configuredTransport = this.tokenManager.usesHttpOnlyCookie ? 'cookie' : 'body';
    if (pending.authTransport !== configuredTransport) {
      this.tokenManager.clearPendingOAuthCompletion(pending.ticket);
      return null;
    }
    try {
      if (pending.kind === 'link') {
        await this.client.getAuthHeaders();
      }
      // Starting completion is itself an authoritative identity intent. Record
      // its epoch before the server call so a later callback can supersede a
      // slow earlier one deterministically (last-start wins), while retaining
      // every ticket until one response is durably committed.
      const completionEpoch = this.tokenManager.commitAuthoritativeAuthTransition(pending.ticket);
      const endpoint = pending.kind === 'link'
        ? '/api/auth/oauth/complete/link'
        : '/api/auth/oauth/exchange';
      const validated = await this.tokenManager.runAuthMutation(
        () => pending.kind === 'link'
          ? this.client.post<AuthResult>(endpoint, {
              ticket: pending.ticket,
              oauthRecoveryNonce: pending.recoveryNonce ?? undefined,
            })
          : this.client.postPublic<AuthResult>(endpoint, {
              ticket: pending.ticket,
              oauthRecoveryNonce: pending.recoveryNonce ?? undefined,
            }),
        (value) => { this.syncAuthResult(value); },
        completionEpoch,
      );
      // A successful authoritative completion is the explicit winner. Older
      // sibling callbacks must never adopt a different account on a later
      // reload merely because they were also pending locally.
      this.tokenManager.clearPendingOAuthRecovery();
      const user = this.tokenManager.getCurrentUser();
      if (!user || !validated.accessToken) return null;
      return {
        ...validated,
        user,
        accessToken: validated.accessToken,
        refreshToken: this.tokenManager.usesHttpOnlyCookie ? '' : validated.refreshToken,
      };
    } catch (error) {
      if (
        error instanceof EdgeBaseError
        && error.code >= 400
        && error.code < 500
        && error.code !== 408
        && error.code !== 429
        && error.slug !== 'auth-state-changed'
      ) {
        this.tokenManager.clearPendingOAuthCompletion(pending.ticket);
      }
      throw error;
    }
  }

  /**
   * Register a new user with email and password.
   * Optionally include user metadata (displayName, avatarUrl).
   *
   */
  async signUp(options: SignUpOptions): Promise<AuthResult> {
    await this.ensurePendingSignOutResolved();
    const body: Record<string, unknown> = {
      email: options.email,
      password: options.password,
    };
    if (options.data) {
      body.data = options.data;
    }
    if (options.locale) {
      body.locale = options.locale;
    }
    const result = await this.tokenManager.runAuthMutation(
      () => this.runCaptchaProtected(
        'signup',
        options.captchaToken,
        (captchaToken) => this.corePublic.authSignup({
          ...body,
          ...(captchaToken ? { captchaToken } : {}),
        }) as Promise<AuthResult>,
      ),
      (value) => { this.syncAuthResult(value, true); },
    );
    return result;
  }

  /** Sign in with email and password. Returns MfaRequiredResult if MFA is enabled. */
  async signIn(options: SignInOptions): Promise<SignInResult> {
    await this.ensurePendingSignOutResolved();
    const body: Record<string, unknown> = {
      email: options.email,
      password: options.password,
    };
    const result = await this.tokenManager.runAuthMutation(
      () => this.runCaptchaProtected(
        'signin',
        options.captchaToken,
        (captchaToken) => this.corePublic.authSignin({
          ...body,
          ...(captchaToken ? { captchaToken } : {}),
        }) as Promise<SignInResult>,
      ),
      (value) => {
        if (!('mfaRequired' in value && value.mfaRequired)) {
          this.syncAuthResult(value as AuthResult, true);
        }
      },
    );
    if ('mfaRequired' in result && result.mfaRequired) {
      return result;
    }
    return result as AuthResult;
  }

  /** Sign out (revokes current session) */
  async signOut(options?: { pushDeviceId?: string }): Promise<void> {
    if (this.tokenManager.usesHttpOnlyCookie) {
      const legacyRefreshToken = this.tokenManager.getRefreshToken();
      this.pendingLegacyRevocationToken = legacyRefreshToken
        ?? this.pendingLegacyRevocationToken;
      // Write the crash/offline-safe intent before the request and clear the
      // visible session and persistent JavaScript credentials immediately. A
      // pre-migration token is held only in this AuthClient instance long enough
      // to attempt server revocation; it is never retained in localStorage.
      this.tokenManager.markPendingSignOut(options?.pushDeviceId);
      this.tokenManager.clearSessionForPendingSignOut();
      const refreshSettled = await this.tokenManager.waitForRefreshIdle();
      // An in-flight pre-signout refresh may have updated local state while it
      // settled. Reassert the tombstone state before sending the final revoke.
      this.tokenManager.clearSessionForPendingSignOut(false);
      try {
        const revoke = async () => {
          this.tokenManager.clearSessionForPendingSignOut(false);
          await this.client.postPublic('/api/auth/signout', {
            ...(this.pendingLegacyRevocationToken
              ? { refreshToken: this.pendingLegacyRevocationToken }
              : {}),
            ...(this.tokenManager.getPendingSignOutPushDeviceId()
              ? { pushDeviceId: this.tokenManager.getPendingSignOutPushDeviceId() }
              : {}),
          });
        };
        // A well-behaved refresh settles under the shared mutation lock before
        // revocation. At the absolute deadline, revoke immediately and retain
        // the tombstone: a custom/hung fetch may later apply Set-Cookie, so the
        // scheduled retry revokes once more after that refresh finally settles.
        if (refreshSettled) {
          await this.tokenManager.runFinalSignOutMutation(revoke);
        } else {
          await revoke();
        }
        this.completeOrRetryPendingSignOut(refreshSettled);
      } catch (error) {
        if (error instanceof EdgeBaseError && error.code === 401) {
          // The old credential is already invalid, which is equivalent to a
          // completed server-side revoke for this browser.
          this.completeOrRetryPendingSignOut(refreshSettled);
          return;
        }
        this.lastPendingSignOutError = error;
        if (error instanceof EdgeBaseError && error.code === 403) {
          // A blocking access rule or beforeSignOut hook intentionally denied
          // revocation. Keep local UI signed out, retain the tombstone, and
          // surface the policy result instead of claiming a durable logout.
          throw error;
        }
        // A transport/5xx failure cannot prove the HttpOnly cookie was cleared.
        // Retry with bounded backoff even if the browser never transitions
        // through an `online` event.
        this.schedulePendingSignOutRetry();
        if (options?.pushDeviceId) {
          throw new EdgeBaseError(
            503,
            'Sign-out is local, but server session and push cleanup are pending retry.',
            undefined,
            'signout-pending',
          );
        }
      }
      return;
    }

    const refreshToken = this.tokenManager.getRefreshToken();
    // Body-mode sign-out is immediately authoritative locally. Advance the
    // persisted epoch and clear visible credentials before awaiting revocation
    // so an in-flight OAuth refresh cannot resurrect the session.
    let localClearError: unknown;
    try {
      this.tokenManager.clearTokens();
    } catch (error) {
      localClearError = error;
    }
    let serverError: unknown;
    try {
      await this.tokenManager.runFinalSignOutMutation(async () => {
        if (refreshToken) await this.core.authSignout({
          refreshToken,
          ...(options?.pushDeviceId ? { pushDeviceId: options.pushDeviceId } : {}),
        });
      });
    } catch (error) {
      serverError = error;
      // Continue even if server call fails
    }
    if (localClearError) {
      throw new EdgeBaseError(
        0,
        'Sign-out could not be persisted locally; retry before closing the browser.',
        undefined,
        'signout-persistence-failed',
      );
    }
    if (serverError && options?.pushDeviceId) {
      throw new EdgeBaseError(
        503,
        'Sign-out is local, but server session and push cleanup could not be confirmed.',
        undefined,
        'signout-pending',
      );
    }
  }

  /**
   * Refresh the current session using the stored refresh token.
   *
   * Routed through TokenManager's leader-elected/deduped refresh so it cannot
   * double-spend the rotating refresh token concurrently with a background
   * refresh (or another tab): concurrent callers join the single in-flight
   * refresh instead of each POSTing /auth/refresh with the same token.
   */
  async refreshSession(): Promise<AuthResult> {
    const refreshEpoch = this.tokenManager.captureAuthEpoch();
    const refreshToken = this.tokenManager.getRefreshToken();
    if (!refreshToken && !this.tokenManager.usesHttpOnlyCookie) {
      throw new Error('No refresh token available.');
    }
    let serverResult: AuthResult | null = null;
    const pair = await this.tokenManager.forceRefresh(async (token) => {
      serverResult = await this.corePublic.authRefresh(token ? { refreshToken: token } : {}) as AuthResult;
      if (!this.tokenManager.usesHttpOnlyCookie && !serverResult.refreshToken) {
        throw new EdgeBaseError(
          500,
          'Auth refresh succeeded but did not return a refreshToken for body transport.',
        );
      }
      return {
        accessToken: serverResult.accessToken,
        refreshToken: serverResult.refreshToken ?? '',
      };
    });
    if (!this.tokenManager.isAuthEpochCurrent(refreshEpoch)) {
      throw new EdgeBaseError(
        401,
        'Session refresh was superseded by a newer auth state.',
        undefined,
        'auth-state-changed',
      );
    }
    // If THIS call performed the refresh we have the full server payload (incl.
    // the user object); sync + return it. Otherwise a concurrent refresh
    // produced the tokens — return them with the cached user.
    if (serverResult) {
      // The assignment happens inside the forceRefresh callback; retain the
      // narrowed value explicitly because TypeScript does not model that
      // callback's synchronous completion through the awaited call.
      const refreshedResult = serverResult as AuthResult;
      const user = this.syncAuthResult(refreshedResult);
      if (!user) {
        throw new EdgeBaseError(
          401,
          this.tokenManager.hasPendingSignOut()
            ? 'Session refresh was superseded by sign-out.'
            : 'Not authenticated after refresh.',
        );
      }
      return this.tokenManager.usesHttpOnlyCookie
        ? {
            user,
            accessToken: pair.accessToken,
            refreshToken: '',
            sessionTransport: 'cookie',
            sessionId: refreshedResult.sessionId ?? this.tokenManager.getCurrentSessionId() ?? undefined,
          }
        : {
            user,
            accessToken: pair.accessToken,
            refreshToken: pair.refreshToken,
            sessionId: refreshedResult.sessionId,
          };
    }
    const user = this.tokenManager.getCurrentUser();
    if (!user) {
      throw new EdgeBaseError(401, 'Not authenticated after refresh.');
    }
    return this.tokenManager.usesHttpOnlyCookie
      ? {
          user,
          accessToken: pair.accessToken,
          refreshToken: '',
          sessionTransport: 'cookie',
          sessionId: this.tokenManager.getCurrentSessionId() ?? undefined,
        }
      : {
          user,
          accessToken: pair.accessToken,
          refreshToken: pair.refreshToken,
          sessionId: this.tokenManager.getCurrentSessionId() ?? undefined,
        };
  }

  /**
   * Start OAuth sign-in flow.
   * Constructs the OAuth redirect URL and navigates to it in browser.
   * Requires persistent browser storage so the callback can be bound across
   * navigation; use a native SDK for non-browser deep-link flows.
   *: captchaToken is passed as query parameter for GET requests.
   *
   * NOTE: Not delegated to Generated Core — this is URL construction + redirect, not a standard HTTP call.
   */
  async signInWithOAuth(
    providerOrOptions: string | OAuthStartOptions,
    options?: OAuthRedirectOptions & { captchaToken?: string },
  ): Promise<{ url: string }> {
    if (this.tokenManager.hasPendingSignOut()) {
      throw new EdgeBaseError(
        409,
        'A previous sign-out is still pending server revocation.',
        undefined,
        'signout-pending',
      );
    }
    const provider = typeof providerOrOptions === 'string'
      ? providerOrOptions
      : providerOrOptions.provider;
    const resolvedOptions = typeof providerOrOptions === 'string'
      ? options
      : providerOrOptions;
    let url = `${this.client.getBaseUrl()}/api/auth/oauth/${encodeURIComponent(provider)}`;
    const redirectUrl = resolveOAuthRedirectUrl(resolvedOptions);

    // OAuth initiation is CAPTCHA-protected under the same automatic browser
    // contract as the other auth actions. Acquire before navigation so release
    // fail-closed deployments do not land on a guaranteed 403 callback path.
    const captchaToken = await resolveCaptchaToken(
      this.baseUrl,
      'oauth',
      resolvedOptions?.captchaToken,
    );
    if (captchaToken) {
      url += `?captcha_token=${encodeURIComponent(captchaToken)}`;
    }
    if (this.tokenManager.usesHttpOnlyCookie) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}auth_transport=cookie`;
    }
    if (redirectUrl) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}redirect_url=${encodeURIComponent(redirectUrl)}`;
    }

    // The callback URL is attacker-navigable. Bind it to a one-shot, CSPRNG
    // browser nonce that the server carries inside its existing OAuth state and
    // returns only after completing that flow.
    const recoveryNonce = this.tokenManager.markPendingOAuthRecovery();
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}${OAUTH_RECOVERY_NONCE_PARAM}=${encodeURIComponent(recoveryNonce)}`;

    // Auto-redirect in browser
    if (typeof window !== 'undefined' && resolvedOptions?.navigate !== false) {
      try {
        window.location.href = url;
      } catch (error) {
        this.tokenManager.clearPendingOAuthRecovery(recoveryNonce);
        throw error;
      }
    }

    return { url };
  }

  /**
   * Handle an OAuth callback URL, persist tokens, and update auth state.
   * When called without arguments in the browser, it reads from window.location.href.
   */
  async handleOAuthCallback(url?: string): Promise<AuthResult | null> {
    const callbackUrl = url
      ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (!callbackUrl) return null;

    try {
      const parsed = new URL(
        callbackUrl,
        typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
      );
      const shouldScrubBrowserUrl = (() => {
        if (typeof window === 'undefined') return false;
        if (!url) return true;
        try {
          return new URL(window.location.href).href === parsed.href;
        } catch {
          return false;
        }
      })();
      const fragmentParams = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash);
      const authCallbackKeys = [
        'access_token',
        'refresh_token',
        'oauth_exchange_ticket',
        'oauth_link_ticket',
        'auth_transport',
        OAUTH_RECOVERY_NONCE_PARAM,
        'error',
        'error_description',
      ] as const;
      type AuthCallbackKey = typeof authCallbackKeys[number];
      const callbackValues = new Map<AuthCallbackKey, string>();
      const presentCallbackKeys = new Set<AuthCallbackKey>();
      for (const key of authCallbackKeys) {
        if (fragmentParams.has(key) || parsed.searchParams.has(key)) {
          presentCallbackKeys.add(key);
          const value = fragmentParams.get(key) ?? parsed.searchParams.get(key);
          if (value !== null) callbackValues.set(key, value);
        }
      }
      const getCallbackParam = (key: AuthCallbackKey): string | null =>
        callbackValues.get(key) ?? null;
      const hasCallbackParam = (key: AuthCallbackKey): boolean =>
        presentCallbackKeys.has(key);
      const hasAnyCallbackParam = presentCallbackKeys.size > 0;

      if (!hasAnyCallbackParam) {
        const pending = this.tokenManager.getPendingOAuthCompletion();
        if (pending) return await this.completePendingOAuthTicket(pending);
      }

      // Bearer tokens and OAuth authority leave the current browser URL before
      // any storage lookup/removal or network request. Preserve application
      // history state. If History API cleanup is unavailable, navigate to the
      // clean relative URL and stop this callback attempt immediately.
      if (shouldScrubBrowserUrl && hasAnyCallbackParam) {
        const fragmentHasAuthParams = authCallbackKeys.some((key) => fragmentParams.has(key));
        for (const key of authCallbackKeys) {
          parsed.searchParams.delete(key);
          fragmentParams.delete(key);
        }
        if (fragmentHasAuthParams) {
          const remainingFragment = fragmentParams.toString();
          parsed.hash = remainingFragment ? `#${remainingFragment}` : '';
        }
        const nextUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        try {
          if (typeof window.history?.replaceState !== 'function') throw new Error('History API unavailable');
          window.history.replaceState(window.history.state, document.title, nextUrl);
        } catch {
          try {
            if (typeof window.location?.replace !== 'function') throw new Error('Location replace unavailable');
            window.location.replace(nextUrl);
            return null;
          } catch {
            throw new EdgeBaseError(
              0,
              'OAuth callback credentials could not be removed from the browser URL.',
              undefined,
              'oauth-callback-scrub-failed',
            );
          }
        }
      }

      // Any local/cross-tab sign-out or explicit auth cancellation after this
      // point must supersede both the flow record and slow validation response.
      const callbackEpoch = this.tokenManager.captureAuthEpoch();

      if (hasCallbackParam('error')) {
        // Provider errors are callback attempts too: consume the flow nonce so
        // neither the error URL nor a later attacker URL can reuse it.
        await this.tokenManager.consumePendingOAuthRecovery(
          getCallbackParam(OAUTH_RECOVERY_NONCE_PARAM),
          callbackEpoch,
        );
        return null;
      }

      const exchangeTicket = getCallbackParam('oauth_exchange_ticket');
      const linkTicket = getCallbackParam('oauth_link_ticket');
      if (exchangeTicket || linkTicket) {
        if (exchangeTicket && linkTicket) return null;
        const recoveryNonce = getCallbackParam(OAUTH_RECOVERY_NONCE_PARAM);
        const callbackBound = await this.tokenManager.consumePendingOAuthRecovery(
          recoveryNonce,
          callbackEpoch,
        );
        if (!callbackBound) return null;
        const ticket = linkTicket ?? exchangeTicket!;
        const callbackTransport = getCallbackParam('auth_transport') === 'cookie'
          ? 'cookie'
          : 'body';
        const pending: PendingOAuthCompletion = {
          ticket,
          recoveryNonce,
          kind: linkTicket ? 'link' : 'signin',
          authTransport: callbackTransport,
          createdAt: Date.now(),
          authEpoch: callbackEpoch,
        };
        if (!this.tokenManager.storePendingOAuthCompletion(pending)) {
          throw new EdgeBaseError(
            0,
            'OAuth completion ticket could not be persisted. Free browser storage and retry.',
            undefined,
            'oauth-completion-persist-failed',
          );
        }
        return await this.completePendingOAuthTicket(pending);
      }

      if (this.tokenManager.usesHttpOnlyCookie) {
        const isCookieCallback = getCallbackParam('auth_transport') === 'cookie';
        const isTransientRecovery = !hasAnyCallbackParam
          && this.tokenManager.hasCookieOAuthRecovery();
        // The server marks only a successful cookie OAuth redirect this way.
        // Never turn an unrelated URL (or provider error callback) into a
        // successful login merely because an older refresh cookie exists.
        if (!isCookieCallback && !isTransientRecovery) {
          if (hasAnyCallbackParam) {
            await this.tokenManager.consumePendingOAuthRecovery(
              getCallbackParam(OAUTH_RECOVERY_NONCE_PARAM),
              callbackEpoch,
            );
          }
          return null;
        }
        if (isCookieCallback) {
          const callbackBound = await this.tokenManager.consumePendingOAuthRecovery(
            getCallbackParam(OAUTH_RECOVERY_NONCE_PARAM),
            callbackEpoch,
          );
          if (!callbackBound) return null;
          // The flow nonce is now consumed. Persist a separate non-authorizing
          // marker only so this verified cookie callback can survive a transient
          // refresh failure or reload after its URL fields are scrubbed.
          this.tokenManager.markCookieOAuthRecovery();
        }
        return await this.refreshSession();
      }

      // Body-token callback authority is one-shot. Remove it synchronously,
      // before parsing credentials or making the server refresh exchange, and
      // compare the returned nonce without a data-dependent early exit.
      const callbackBound = await this.tokenManager.consumePendingOAuthRecovery(
        getCallbackParam(OAUTH_RECOVERY_NONCE_PARAM),
        callbackEpoch,
      );
      if (!callbackBound) return null;
      const accessToken = getCallbackParam('access_token');
      const refreshToken = getCallbackParam('refresh_token');
      if (!accessToken || !refreshToken) return null;

      // Never trust bearer credentials merely because they appeared in a
      // browser URL. Exchange the returned refresh token with the auth server;
      // only the server-validated and rotated result enters local auth state.
      const validated = await this.tokenManager.runAuthMutation(
        () => this.corePublic.authRefresh({ refreshToken }) as Promise<AuthResult>,
        (value) => { this.syncAuthResult(value, true); },
      );
      if (!validated.accessToken || !validated.refreshToken) return null;
      const user = this.tokenManager.getCurrentUser();
      if (!user) return null;

      return {
        ...validated,
        user,
        accessToken: validated.accessToken,
        refreshToken: validated.refreshToken,
      };
    } catch (error) {
      if (
        error instanceof EdgeBaseError
        && (error.slug === 'oauth-callback-scrub-failed'
          || error.slug === 'oauth-completion-persist-failed'
          || error.slug === 'auth-session-persist-failed')
      ) {
        throw error;
      }
      // A parse/network failure cannot identify a flow and therefore must not
      // delete unrelated entries from the concurrent pending-flow registry.
      return null;
    }
  }

  /** Sign in anonymously */
  async signInAnonymously(options?: { captchaToken?: string }): Promise<AuthResult> {
    await this.ensurePendingSignOutResolved();
    const result = await this.tokenManager.runAuthMutation(
      () => this.runCaptchaProtected(
        'anonymous',
        options?.captchaToken,
        (captchaToken) => this.corePublic.authSigninAnonymous(
          captchaToken ? { captchaToken } : undefined,
        ) as Promise<AuthResult>,
      ),
      (value) => { this.syncAuthResult(value, true); },
    );
    return result;
  }

  /**
   * Send a magic link (passwordless login) email.
   * If the email is not registered and autoCreate is enabled (server config), a new account is created.
   */
  async signInWithMagicLink(options: {
    email: string;
    captchaToken?: string;
    redirectUrl?: string;
    state?: string;
  }): Promise<void> {
    const body: Record<string, unknown> = { email: options.email };
    if (options.redirectUrl) body.redirectUrl = options.redirectUrl;
    if (options.state) body.state = options.state;
    await this.runCaptchaProtected(
      'magic-link',
      options.captchaToken,
      (captchaToken) => this.client.postPublic('/api/auth/signin/magic-link', {
        ...body,
        ...(captchaToken ? { captchaToken } : {}),
      }),
    );
  }

  /**
   * Verify a magic link token and sign in.
   * Called after user clicks the link from their email.
   */
  async verifyMagicLink(token: string): Promise<AuthResult> {
    await this.ensurePendingSignOutResolved();
    const result = await this.tokenManager.runAuthMutation(
      () => this.corePublic.authVerifyMagicLink({ token }) as Promise<AuthResult>,
      (value) => { this.syncAuthResult(value, true); },
    );
    return result;
  }

  // ─── Phone / SMS Auth ───

  /**
   * Send an SMS verification code to the given phone number.
   * If the phone is not registered and autoCreate is enabled (server config), a new account is created on verify.
   */
  async signInWithPhone(options: { phone: string; captchaToken?: string }): Promise<void> {
    const body: Record<string, unknown> = { phone: options.phone };
    await this.runCaptchaProtected(
      'phone',
      options.captchaToken,
      (captchaToken) => this.corePublic.authSigninPhone({
        ...body,
        ...(captchaToken ? { captchaToken } : {}),
      }),
    );
  }

  /**
   * Verify the SMS code and sign in.
   * Called after user receives the code from signInWithPhone.
   */
  async verifyPhone(options: { phone: string; code: string }): Promise<AuthResult> {
    await this.ensurePendingSignOutResolved();
    const result = await this.tokenManager.runAuthMutation(
      () => this.corePublic.authVerifyPhone({
        phone: options.phone,
        code: options.code,
      }) as Promise<AuthResult>,
      (value) => { this.syncAuthResult(value, true); },
    );
    return result;
  }

  /** Link current account with a phone number. Sends an SMS code. */
  async linkWithPhone(options: { phone: string }): Promise<void> {
    await this.core.authLinkPhone({ phone: options.phone });
  }

  /** Verify phone link code. Anonymous upgrades return and adopt a replacement session. */
  async verifyLinkPhone(options: { phone: string; code: string }): Promise<AuthResult | void> {
    const isReplacementSession = (value: unknown): value is Partial<AuthResult> & {
      user: TokenUser;
      accessToken: string;
    } => {
      if (!value || typeof value !== 'object') return false;
      const candidate = value as Partial<AuthResult>;
      return typeof candidate.accessToken === 'string'
        && candidate.accessToken.length > 0
        && Boolean(candidate.user && typeof candidate.user === 'object')
        && (typeof candidate.refreshToken === 'string' || this.tokenManager.usesHttpOnlyCookie);
    };
    const result = await this.tokenManager.runAuthMutation(
      () => this.core.authVerifyLinkPhone({
        phone: options.phone,
        code: options.code,
      }) as Promise<AuthResult | { ok: true }>,
      (value) => {
        if (isReplacementSession(value)) this.syncAuthResult(value, true);
      },
    );
    if (!isReplacementSession(result)) return undefined;
    return this.tokenManager.usesHttpOnlyCookie
      ? { ...result, refreshToken: '', sessionTransport: 'cookie' }
      : result as AuthResult;
  }

  /** Link anonymous account to email/password */
  async linkWithEmail(options: { email: string; password: string }): Promise<AuthResult> {
    await this.client.getAuthHeaders();
    const result = await this.tokenManager.runAuthMutation(
      () => this.core.authLinkEmail({
        email: options.email,
        password: options.password,
      }) as Promise<AuthResult>,
      (value) => { this.syncAuthResult(value, true); },
    );
    return result;
  }

  /**
   * Link the current account to an OAuth provider.
   *
   * The wrapper keeps ownership of callback binding and browser navigation;
   * the generated Core now carries the documented link-start JSON body.
   */
  async linkWithOAuth(
    providerOrOptions: string | (LinkOAuthOptions & { provider: string }),
    options?: LinkOAuthOptions,
  ): Promise<{ redirectUrl: string }> {
    const provider = typeof providerOrOptions === 'string'
      ? providerOrOptions
      : providerOrOptions.provider;
    const resolvedOptions = typeof providerOrOptions === 'string'
      ? options
      : providerOrOptions;
    const redirectUrl = resolveOAuthRedirectUrl(resolvedOptions);
    const recoveryNonce = this.tokenManager.markPendingOAuthRecovery();
    const body: Record<string, unknown> = {
      redirectUrl,
      oauthRecoveryNonce: recoveryNonce,
    };
    if (resolvedOptions?.state) {
      body.state = resolvedOptions.state;
    }

    let result: { redirectUrl: string };
    try {
      result = await this.core.oauthLinkStart(provider, body) as { redirectUrl: string };
    } catch (error) {
      this.tokenManager.clearPendingOAuthRecovery(recoveryNonce);
      throw error;
    }

    if (typeof window !== 'undefined' && resolvedOptions?.navigate !== false) {
      try {
        window.location.href = result.redirectUrl;
      } catch (error) {
        this.tokenManager.clearPendingOAuthRecovery(recoveryNonce);
        throw error;
      }
    }

    return result;
  }

  /**
   * Subscribe to authentication state changes.
   * Callback fires immediately with current state, then on each change.
   *
   * @returns Unsubscribe function
   */
  onAuthStateChange(callback: AuthStateChangeHandler): () => void {
    return this.tokenManager.onAuthStateChange(callback);
  }

  /** List active sessions */
  async listSessions(): Promise<Session[]> {
    const result = await this.core.authGetSessions() as { sessions: Session[] };
    const currentSessionId = this.tokenManager.getCurrentSessionId();
    return (result.sessions ?? []).map((session) => ({
      ...session,
      current: session.current
        ?? Boolean(currentSessionId && session.id === currentSessionId),
    }));
  }

  /** Revoke a specific session */
  async revokeSession(sessionId: string): Promise<void> {
    if (
      this.tokenManager.usesHttpOnlyCookie
      && sessionId === this.tokenManager.getCurrentSessionId()
    ) {
      // Revoking the active cookie-backed session must also expire the HttpOnly
      // cookie and use the crash/offline-safe sign-out tombstone path. A bearer
      // DELETE can revoke the row but cannot clear that browser cookie.
      await this.signOut();
      return;
    }
    await this.core.authDeleteSession(sessionId);
  }

  /** List linked sign-in identities for the current user. */
  async listIdentities(): Promise<IdentitiesResult> {
    return this.client.get<IdentitiesResult>('/api/auth/identities');
  }

  /** Unlink a linked OAuth identity by its identity ID. */
  async unlinkIdentity(identityId: string): Promise<IdentitiesResult> {
    return this.client.delete<IdentitiesResult>(`/api/auth/identities/${encodeURIComponent(identityId)}`);
  }

  /** Get the current authenticated user (from cached JWT) */
  get currentUser(): TokenUser | null {
    return this.tokenManager.getCurrentUser();
  }

  /**
   * Non-secret local user-id hint for account-scoped cache selection.
   * This is not authenticated identity; revalidate the cookie session before
   * using the principal for authorization or server-backed decisions.
   */
  get sessionUserIdHint(): string | null {
    return this.tokenManager.getSessionUserIdHint();
  }

  /** Update current user's profile */
  async updateProfile(data: UpdateProfileOptions): Promise<TokenUser> {
    await this.client.getAuthHeaders();
    let user: TokenUser | null = null;
    await this.tokenManager.runAuthMutation(
      () => this.core.authUpdateProfile(data) as Promise<Partial<AuthResult>>,
      (value) => { user = this.syncAuthResult(value); },
    );
    if (!user) {
      throw new EdgeBaseError(500, 'Profile update succeeded but no user data was returned.');
    }
    return user;
  }

  /**
   * Update the user's preferred locale. Future auth emails will be sent in this language.
   *
   * @param locale - BCP 47 language tag (e.g. 'ko', 'ja', 'fr', 'en')
   * @returns Updated user object
   *
   * @example
   * await client.auth.updateLocale('ko'); // switch to Korean
   */
  async updateLocale(locale: string): Promise<TokenUser> {
    await this.client.getAuthHeaders();
    let user: TokenUser | null = null;
    await this.tokenManager.runAuthMutation(
      () => this.core.authUpdateProfile({ locale }) as Promise<Partial<AuthResult>>,
      (value) => { user = this.syncAuthResult(value); },
    );
    if (!user) {
      throw new EdgeBaseError(500, 'Locale update succeeded but no user data was returned.');
    }
    return user;
  }

  // ─── Email Verification & Password Reset (M14,) ───

  /** Verify email address with token */
  async verifyEmail(token: string): Promise<void> {
    await this.corePublic.authVerifyEmail({ token });
  }

  /** Request a verification email for the current user. */
  async requestEmailVerification(options?: EmailActionRedirectOptions): Promise<void> {
    const body: Record<string, unknown> = {};
    if (options?.redirectUrl) body.redirectUrl = options.redirectUrl;
    if (options?.state) body.state = options.state;
    await this.core.authRequestEmailVerification(body);
  }

  /** Request password reset email */
  async requestPasswordReset(
    email: string,
    options?: { captchaToken?: string } & EmailActionRedirectOptions,
  ): Promise<void> {
    const body: Record<string, unknown> = { email };
    if (options?.redirectUrl) body.redirectUrl = options.redirectUrl;
    if (options?.state) body.state = options.state;
    await this.runCaptchaProtected(
      'password-reset',
      options?.captchaToken,
      (captchaToken) => this.client.postPublic('/api/auth/request-password-reset', {
        ...body,
        ...(captchaToken ? { captchaToken } : {}),
      }),
    );
  }

  /** Reset password with token */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.corePublic.authResetPassword({ token, newPassword });
  }

  /** Change password for authenticated user */
  async changePassword(options: { currentPassword: string; newPassword: string }): Promise<AuthResult> {
    await this.client.getAuthHeaders();
    const result = await this.tokenManager.runAuthMutation(
      () => this.core.authChangePassword({
        currentPassword: options.currentPassword,
        newPassword: options.newPassword,
      }) as Promise<AuthResult>,
      (value) => { this.syncAuthResult(value, true); },
    );
    return result;
  }

  // ─── Email OTP Auth ───

  /**
   * Send an email OTP code for sign-in.
   * If the email is not registered and autoCreate is enabled (server config), a new account is created on verify.
   */
  async signInWithEmailOtp(options: { email: string }): Promise<void> {
    await this.corePublic.authSigninEmailOtp({ email: options.email });
  }

  /**
   * Verify the email OTP code and sign in.
   * Called after user receives the code from signInWithEmailOtp.
   */
  async verifyEmailOtp(options: { email: string; code: string }): Promise<AuthResult> {
    await this.ensurePendingSignOutResolved();
    const result = await this.tokenManager.runAuthMutation(
      () => this.corePublic.authVerifyEmailOtp({
        email: options.email,
        code: options.code,
      }) as Promise<AuthResult>,
      (value) => { this.syncAuthResult(value, true); },
    );
    return result;
  }

  // ─── Email Change ───

  /**
   * Request an email change. Sends a verification email to the new address.
   * Requires the user's current password for confirmation.
   */
  async changeEmail(
    options: { newEmail: string; password: string } & EmailActionRedirectOptions,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      newEmail: options.newEmail,
      password: options.password,
    };
    if (options.redirectUrl) body.redirectUrl = options.redirectUrl;
    if (options.state) body.state = options.state;
    await this.client.post('/api/auth/change-email', body);
  }

  /**
   * Verify email change with token from the verification email.
   */
  async verifyEmailChange(token: string): Promise<void> {
    await this.corePublic.authVerifyEmailChange({ token });
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
    await this.ensurePendingSignOutResolved();
    const result = await this.tokenManager.runAuthMutation(
      () => this.corePublic.authPasskeysAuthenticate({ response }) as Promise<AuthResult>,
      (value) => { this.syncAuthResult(value, true); },
    );
    return result;
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
    const syncAuthResult = this.syncAuthResult.bind(this);
    const tokenManager = this.tokenManager;
    const ensurePendingSignOutResolved = this.ensurePendingSignOutResolved.bind(this);
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
        await ensurePendingSignOutResolved();
        const result = await tokenManager.runAuthMutation(
          () => corePublic.authMfaVerify({ mfaTicket, code }) as Promise<AuthResult>,
          (value) => { syncAuthResult(value, true); },
        );
        return result;
      },

      /** Use a recovery code during MFA challenge. */
      async useRecoveryCode(mfaTicket: string, recoveryCode: string): Promise<AuthResult> {
        await ensurePendingSignOutResolved();
        const result = await tokenManager.runAuthMutation(
          () => corePublic.authMfaRecovery({ mfaTicket, recoveryCode }) as Promise<AuthResult>,
          (value) => { syncAuthResult(value, true); },
        );
        return result;
      },

      /** Regenerate recovery codes for the current user. Existing unused codes are invalidated. */
      async regenerateRecoveryCodes(options?: DisableTotpOptions): Promise<RecoveryCodesResult> {
        return core.authMfaRecoveryCodesRegenerate(options ?? {}) as Promise<RecoveryCodesResult>;
      },

      /** Disable TOTP for the current user. Requires password or TOTP code. */
      async disableTotp(options?: DisableTotpOptions): Promise<{ ok: true }> {
        return core.authMfaTotpDelete(options ?? {}) as Promise<{ ok: true }>;
      },

      /** List enrolled MFA factors for the current user. */
      async listFactors(): Promise<{ factors: MfaFactor[] }> {
        return core.authMfaFactors() as Promise<{ factors: MfaFactor[] }>;
      },
    };
  }

  private retryPendingSignOut(): Promise<void> {
    if (!this.tokenManager.usesHttpOnlyCookie || !this.tokenManager.hasPendingSignOut()) {
      return Promise.resolve();
    }
    if (this.pendingSignOutRetry) return this.pendingSignOutRetry;

    let refreshSettled = false;
    const retry = (async () => {
      refreshSettled = await this.tokenManager.waitForRefreshIdle();
      this.tokenManager.clearSessionForPendingSignOut(false);
      const revoke = async () => {
        this.tokenManager.clearSessionForPendingSignOut(false);
        const pushDeviceId = this.tokenManager.getPendingSignOutPushDeviceId();
        await this.client.postPublic('/api/auth/signout', {
          ...(this.pendingLegacyRevocationToken
            ? { refreshToken: this.pendingLegacyRevocationToken }
            : {}),
          ...(pushDeviceId ? { pushDeviceId } : {}),
        });
      };
      return refreshSettled
        ? this.tokenManager.runFinalSignOutMutation(revoke)
        : revoke();
    })()
      .then(() => {
        this.completeOrRetryPendingSignOut(refreshSettled);
      })
      .catch((error: unknown) => {
        if (error instanceof EdgeBaseError && error.code === 401) {
          this.completeOrRetryPendingSignOut(refreshSettled);
          return;
        }
        this.lastPendingSignOutError = error;
        if (!(error instanceof EdgeBaseError && error.code === 403)) {
          this.schedulePendingSignOutRetry();
        }
        // Policy, network, and server failures intentionally retain the
        // tombstone. Background retries never become unhandled rejections or
        // restore local authenticated state.
      })
      .finally(() => {
        if (this.pendingSignOutRetry === retry) {
          this.pendingSignOutRetry = null;
        }
      });
    this.pendingSignOutRetry = retry;
    this.tokenManager.setPendingSignOutRetry(retry);
    return retry;
  }

  private schedulePendingSignOutRetry(): void {
    if (
      !this.tokenManager.hasPendingSignOut()
      || this.pendingSignOutRetryTimer
      || this.pendingSignOutRetryAttempt >= PENDING_SIGN_OUT_RETRY_DELAYS_MS.length
    ) {
      return;
    }
    const delay = PENDING_SIGN_OUT_RETRY_DELAYS_MS[this.pendingSignOutRetryAttempt];
    this.pendingSignOutRetryAttempt += 1;
    this.pendingSignOutRetryTimer = setTimeout(() => {
      this.pendingSignOutRetryTimer = null;
      void this.retryPendingSignOut();
    }, delay);
  }

  private cancelScheduledSignOutRetry(): void {
    if (!this.pendingSignOutRetryTimer) return;
    clearTimeout(this.pendingSignOutRetryTimer);
    this.pendingSignOutRetryTimer = null;
  }

  private completePendingSignOut(): void {
    this.cancelScheduledSignOutRetry();
    this.pendingSignOutRetryAttempt = 0;
    this.lastPendingSignOutError = null;
    this.pendingLegacyRevocationToken = null;
    this.tokenManager.completePendingSignOut();
  }

  private completeOrRetryPendingSignOut(refreshSettled: boolean): void {
    if (refreshSettled) {
      this.completePendingSignOut();
      return;
    }
    this.lastPendingSignOutError = new EdgeBaseError(
      503,
      'A previous session refresh is still settling; sign-out will be confirmed again.',
      undefined,
      'signout-pending',
    );
    this.schedulePendingSignOutRetry();
  }

  private async ensurePendingSignOutResolved(): Promise<void> {
    if (!this.tokenManager.usesHttpOnlyCookie || !this.tokenManager.hasPendingSignOut()) {
      return;
    }
    this.cancelScheduledSignOutRetry();
    await this.retryPendingSignOut();
    if (!this.tokenManager.hasPendingSignOut()) return;

    if (this.lastPendingSignOutError instanceof EdgeBaseError) {
      throw this.lastPendingSignOutError;
    }
    throw new EdgeBaseError(
      503,
      'The previous session could not be revoked yet; retry sign-in after connectivity recovers.',
      undefined,
      'signout-pending',
    );
  }

  destroy(): void {
    this.cancelScheduledSignOutRetry();
    this.pendingLegacyRevocationToken = null;
    this.tokenManager.setCookieRevalidationHandler(null);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler);
    }
  }

}
