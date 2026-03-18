/**
 * Auth client for React Native — API parity with @edgebase-fun/web AuthClient.
 *: onAuthStateChange
 *: signInAnonymously
 *: signUp with data
 *: React Native OAuth via Linking API + deep link callback
 *
 * Key differences from web AuthClient:
 * - signInWithOAuth uses Linking.openURL() instead of window.location.href
 * - Handles deep link OAuth callback via Linking.addEventListener
 * - TokenManager.getRefreshToken() is async (AsyncStorage)
 * - Captcha is handled via TurnstileWebView component (see turnstile.tsx)
 */

import type { HttpClient, GeneratedDbApi } from '@edgebase-fun/core';
import type { TokenManager, TokenUser, AuthStateChangeHandler } from './token-manager.js';

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

/** Minimal Linking interface — compatible with react-native Linking API */
export interface LinkingAdapter {
  openURL(url: string): Promise<void>;
  addEventListener(type: 'url', handler: (event: { url: string }) => void): { remove: () => void };
  getInitialURL(): Promise<string | null>;
}

type OAuthStartOptions = {
  provider: string;
  redirectUrl?: string;
  captchaToken?: string;
};

// ─── AuthClient ───

export class AuthClient {
  private baseUrl: string;

  constructor(
    private client: HttpClient,
    private tokenManager: TokenManager,
    private core: GeneratedDbApi,
    private corePublic: GeneratedDbApi,
    private linking?: LinkingAdapter,
  ) {
    this.baseUrl = client.getBaseUrl();
  }

  /** Register a new user. Optionally include user metadata. */
  async signUp(options: SignUpOptions): Promise<AuthResult> {
    const body: Record<string, unknown> = {
      email: options.email,
      password: options.password,
    };
    if (options.data) body.data = options.data;
    if (options.captchaToken) body.captchaToken = options.captchaToken;

    const result = await this.corePublic.authSignup(body) as AuthResult;
    this.tokenManager.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return result;
  }

  /** Sign in with email and password. Returns MfaRequiredResult if MFA is enabled. */
  async signIn(options: SignInOptions): Promise<SignInResult> {
    const body: Record<string, unknown> = {
      email: options.email,
      password: options.password,
    };
    if (options.captchaToken) body.captchaToken = options.captchaToken;

    const result = await this.corePublic.authSignin(body) as SignInResult;
    if ('mfaRequired' in result && result.mfaRequired) {
      return result;
    }
    const authResult = result as AuthResult;
    this.tokenManager.setTokens({
      accessToken: authResult.accessToken,
      refreshToken: authResult.refreshToken,
    });
    return authResult;
  }

  /** Sign out — revokes current session on server and clears local tokens. */
  async signOut(): Promise<void> {
    try {
      const refreshToken = await this.tokenManager.getRefreshToken();
      if (refreshToken) {
        await this.core.authSignout({ refreshToken });
      }
    } catch {
      // Continue even if server call fails
    }
    this.tokenManager.clearTokens();
  }

  /** Refresh the current session using the stored refresh token. */
  async refreshSession(): Promise<AuthResult> {
    const refreshToken = await this.tokenManager.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available.');
    }
    const result = await this.corePublic.authRefresh({ refreshToken }) as AuthResult;
    this.tokenManager.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return result;
  }

  /**
   * Start OAuth sign-in flow.
   * Opens the OAuth URL via Linking.openURL() and listens for the deep link callback.
   * The app must be configured with a deep link scheme (e.g. myapp://auth/callback).
   *
   * @param provider - OAuth provider name (e.g. 'google', 'github')
   * @param options.redirectUrl - Deep link URL to redirect back to after OAuth (required for RN)
   * @param options.captchaToken - Optional captcha token
   * @returns Promise that resolves with AuthResult when OAuth completes
   *
   * NOTE: Not delegated to Generated Core — this is URL construction + redirect, not a standard HTTP call.
   */
  signInWithOAuth(
    providerOrOptions: string | OAuthStartOptions,
    options?: { redirectUrl?: string; captchaToken?: string },
  ): { url: string } {
    const provider = typeof providerOrOptions === 'string'
      ? providerOrOptions
      : providerOrOptions.provider;
    const resolvedOptions = typeof providerOrOptions === 'string'
      ? options
      : providerOrOptions;
    let url = `${this.baseUrl}/api/auth/oauth/${encodeURIComponent(provider)}`;
    if (resolvedOptions?.captchaToken) {
      url += `?captcha_token=${encodeURIComponent(resolvedOptions.captchaToken)}`;
    }
    if (resolvedOptions?.redirectUrl) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}redirect_url=${encodeURIComponent(resolvedOptions.redirectUrl)}`;
    }

    // Open in system browser via Linking API
    if (this.linking) {
      void this.linking.openURL(url);
    }

    return { url };
  }

  /**
   * Handle OAuth deep link callback.
   * Call this when your app receives a deep link URL with auth tokens.
   * Extract tokens from query params and store them.
   *
   * @example
   * // In your navigation/linking config:
   * Linking.addEventListener('url', ({ url }) => client.auth.handleOAuthCallback(url));
   */
  async handleOAuthCallback(url: string): Promise<AuthResult | null> {
    try {
      const parsed = new URL(url);
      const accessToken = parsed.searchParams.get('access_token');
      const refreshToken = parsed.searchParams.get('refresh_token');
      if (!accessToken || !refreshToken) return null;

      this.tokenManager.setTokens({ accessToken, refreshToken });

      return {
        user: this.tokenManager.getCurrentUser()!,
        accessToken,
        refreshToken,
      };
    } catch {
      return null;
    }
  }

  /** Sign in anonymously. */
  async signInAnonymously(options?: { captchaToken?: string }): Promise<AuthResult> {
    const body: Record<string, unknown> | undefined = options?.captchaToken
      ? { captchaToken: options.captchaToken }
      : undefined;
    const result = await this.corePublic.authSigninAnonymous(body) as AuthResult;
    this.tokenManager.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return result;
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
    await this.corePublic.authSigninMagicLink(body);
  }

  /**
   * Verify a magic link token and sign in.
   * Called after user clicks the link from their email.
   */
  async verifyMagicLink(token: string): Promise<AuthResult> {
    const result = await this.corePublic.authVerifyMagicLink({ token }) as AuthResult;
    this.tokenManager.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return result;
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
    await this.corePublic.authSigninPhone(body);
  }

  /**
   * Verify the SMS code and sign in.
   * Called after user receives the code from signInWithPhone.
   */
  async verifyPhone(options: { phone: string; code: string }): Promise<AuthResult> {
    const result = await this.corePublic.authVerifyPhone({
      phone: options.phone,
      code: options.code,
    }) as AuthResult;
    this.tokenManager.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return result;
  }

  /** Link current account with a phone number. Sends an SMS code. */
  async linkWithPhone(options: { phone: string }): Promise<void> {
    await this.core.authLinkPhone({ phone: options.phone });
  }

  /** Verify phone link code. Completes phone linking for the current account. */
  async verifyLinkPhone(options: { phone: string; code: string }): Promise<void> {
    await this.core.authVerifyLinkPhone({
      phone: options.phone,
      code: options.code,
    });
  }

  /** Link anonymous account to email/password. */
  async linkWithEmail(options: { email: string; password: string }): Promise<AuthResult> {
    const result = await this.core.authLinkEmail({
      email: options.email,
      password: options.password,
    }) as AuthResult;
    this.tokenManager.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return result;
  }

  /**
   * Link anonymous account to OAuth provider. Returns URL to open in browser.
   *
   * NOTE: Not delegated — Generated Core's oauthLinkStart(provider) takes no body,
   * but we need to pass { redirectUrl }.
   */
  async linkWithOAuth(
    providerOrOptions: string | { provider: string; redirectUrl?: string },
    options?: { redirectUrl?: string },
  ): Promise<{ redirectUrl: string }> {
    const provider = typeof providerOrOptions === 'string'
      ? providerOrOptions
      : providerOrOptions.provider;
    const resolvedOptions = typeof providerOrOptions === 'string'
      ? options
      : providerOrOptions;
    const redirectUrl = resolvedOptions?.redirectUrl ?? '';
    const result = await this.client.post<{ redirectUrl: string }>(
      `/api/auth/oauth/link/${encodeURIComponent(provider)}`,
      { redirectUrl },
    );
    if (this.linking) {
      void this.linking.openURL(result.redirectUrl);
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
    const result = await this.core.authUpdateProfile(data) as AuthResult;
    if (result.accessToken && result.refreshToken) {
      this.tokenManager.setTokens({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    }
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
    await this.corePublic.authRequestPasswordReset(body);
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
    const result = await this.core.authChangePassword({
      currentPassword: options.currentPassword,
      newPassword: options.newPassword,
    }) as AuthResult;
    this.tokenManager.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return result;
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
    const result = await this.corePublic.authVerifyEmailOtp({
      email: options.email,
      code: options.code,
    }) as AuthResult;
    this.tokenManager.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return result;
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
    const result = await this.corePublic.authPasskeysAuthenticate({ response }) as AuthResult;
    this.tokenManager.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
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
    const tokenManager = this.tokenManager;
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
        const result = await corePublic.authMfaVerify({
          mfaTicket,
          code,
        }) as AuthResult;
        tokenManager.setTokens({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        });
        return result;
      },

      /** Use a recovery code during MFA challenge. */
      async useRecoveryCode(mfaTicket: string, recoveryCode: string): Promise<AuthResult> {
        const result = await corePublic.authMfaRecovery({
          mfaTicket,
          recoveryCode,
        }) as AuthResult;
        tokenManager.setTokens({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        });
        return result;
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
