/**
 * AuthUI Context — provides EdgeBase client and configuration to all auth components.
 *
 * Usage:
 * ```tsx
 * import { createClient } from '@edgebase/web';
 * import { AuthProvider } from '@edgebase/auth-ui-react';
 *
 * const client = createClient('https://my-app.edgebase.fun');
 *
 * function App() {
 *   return (
 *     <AuthProvider client={client}>
 *       <AuthForm />
 *     </AuthProvider>
 *   );
 * }
 * ```
 */
import React, { createContext, useContext, useMemo } from 'react';
import type { ClientEdgeBase } from '@edgebase/web';

export interface AuthUIConfig {
  /** OAuth providers to show (e.g., ['google', 'github', 'apple']) */
  providers?: string[];
  /** Default view: 'sign_in' | 'sign_up' | 'magic_link' | 'email_otp' */
  defaultView?: AuthView;
  /** Show "Forgot Password?" link */
  showForgotPassword?: boolean;
  /** Show sign-up link on sign-in form and vice versa */
  showToggle?: boolean;
  /** Custom redirect URL for OAuth */
  oauthRedirectUrl?: string;
  /** Enable magic link option */
  magicLinkEnabled?: boolean;
  /** Enable email OTP option */
  emailOtpEnabled?: boolean;
  /** Enable phone OTP option */
  phoneOtpEnabled?: boolean;
  /** CSS class prefix for styling (default: 'eb-auth') */
  classPrefix?: string;
  /** Localization overrides */
  localization?: Partial<AuthUILabels>;
}

export type AuthView =
  | 'sign_in'
  | 'sign_up'
  | 'magic_link'
  | 'email_otp'
  | 'phone_otp'
  | 'forgot_password'
  | 'reset_password'
  | 'mfa_challenge'
  | 'verify_email';

export interface AuthUILabels {
  signIn: string;
  signUp: string;
  signOut: string;
  email: string;
  password: string;
  confirmPassword: string;
  forgotPassword: string;
  resetPassword: string;
  sendResetLink: string;
  sendMagicLink: string;
  sendOTP: string;
  verifyCode: string;
  orContinueWith: string;
  dontHaveAccount: string;
  alreadyHaveAccount: string;
  phone: string;
  code: string;
  submit: string;
  loading: string;
  displayName: string;
  backToSignIn: string;
}

const DEFAULT_LABELS: AuthUILabels = {
  signIn: 'Sign In',
  signUp: 'Sign Up',
  signOut: 'Sign Out',
  email: 'Email',
  password: 'Password',
  confirmPassword: 'Confirm Password',
  forgotPassword: 'Forgot Password?',
  resetPassword: 'Reset Password',
  sendResetLink: 'Send Reset Link',
  sendMagicLink: 'Send Magic Link',
  sendOTP: 'Send Code',
  verifyCode: 'Verify Code',
  orContinueWith: 'Or continue with',
  dontHaveAccount: "Don't have an account?",
  alreadyHaveAccount: 'Already have an account?',
  phone: 'Phone Number',
  code: 'Verification Code',
  submit: 'Submit',
  loading: 'Loading...',
  displayName: 'Display Name',
  backToSignIn: 'Back to Sign In',
};

export interface AuthContextValue {
  client: ClientEdgeBase;
  config: Required<Pick<AuthUIConfig, 'classPrefix' | 'showForgotPassword' | 'showToggle'>> & AuthUIConfig;
  labels: AuthUILabels;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  client: ClientEdgeBase;
  config?: AuthUIConfig;
  children: React.ReactNode;
}

export function AuthProvider({ client, config, children }: AuthProviderProps) {
  const value = useMemo<AuthContextValue>(() => ({
    client,
    config: {
      classPrefix: 'eb-auth',
      showForgotPassword: true,
      showToggle: true,
      ...config,
    },
    labels: {
      ...DEFAULT_LABELS,
      ...config?.localization,
    },
  }), [client, config]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within an <AuthProvider>');
  }
  return ctx;
}
