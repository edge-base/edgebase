/**
 * AuthForm — full authentication flow orchestrator.
 *
 * Manages view state and renders the appropriate sub-component.
 * Combines SignIn, SignUp, SocialButtons, MFAChallenge, ForgotPassword,
 * MagicLink, EmailOTP, and PhoneOTP into a single cohesive flow.
 *
 * Usage:
 * ```tsx
 * <AuthProvider client={client} config={{ providers: ['google', 'github'] }}>
 *   <AuthForm onSuccess={() => navigate('/dashboard')} />
 * </AuthProvider>
 * ```
 */
import React, { useState, useCallback } from 'react';
import { useAuthContext } from '../context.js';
import type { AuthView } from '../context.js';
import { useAuth } from '../hooks/useAuth.js';
import { SignIn } from './SignIn.js';
import { SignUp } from './SignUp.js';
import { SocialButtons } from './SocialButtons.js';
import { MFAChallenge } from './MFAChallenge.js';
import { ForgotPassword } from './ForgotPassword.js';
import { MagicLink } from './MagicLink.js';
import { EmailOTP } from './EmailOTP.js';
import { PhoneOTP } from './PhoneOTP.js';

export interface AuthFormProps {
  /** Called after successful authentication */
  onSuccess?: () => void;
  /** Override initial view (default uses config.defaultView or 'sign_in') */
  defaultView?: AuthView;
  /** Additional CSS class */
  className?: string;
}

export function AuthForm({ onSuccess, defaultView, className }: AuthFormProps) {
  const { config } = useAuthContext();
  const { user, loading } = useAuth();
  const cx = config.classPrefix;

  const [view, setView] = useState<AuthView>(defaultView || config.defaultView || 'sign_in');
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [mfaFactors, setMfaFactors] = useState<Array<{ id: string; type: string }>>([]);

  const handleViewChange = useCallback((newView: AuthView) => {
    setView(newView);
  }, []);

  const handleSuccess = useCallback(() => {
    onSuccess?.();
  }, [onSuccess]);

  const handleMfaRequired = useCallback((ticket: string, factors: Array<{ id: string; type: string }>) => {
    setMfaTicket(ticket);
    setMfaFactors(factors);
    setView('mfa_challenge');
  }, []);

  const handleMfaCancel = useCallback(() => {
    setMfaTicket(null);
    setMfaFactors([]);
    setView('sign_in');
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className={`${cx}-container ${cx}-loading ${className || ''}`.trim()}>
        <p>{config.localization?.loading || 'Loading...'}</p>
      </div>
    );
  }

  // Already authenticated
  if (user) {
    return null;
  }

  // Build alternative sign-in methods links
  const altMethods: Array<{ view: AuthView; label: string }> = [];
  if (config.magicLinkEnabled && view !== 'magic_link') {
    altMethods.push({ view: 'magic_link', label: 'Sign in with Magic Link' });
  }
  if (config.emailOtpEnabled && view !== 'email_otp') {
    altMethods.push({ view: 'email_otp', label: 'Sign in with Email Code' });
  }
  if (config.phoneOtpEnabled && view !== 'phone_otp') {
    altMethods.push({ view: 'phone_otp', label: 'Sign in with Phone' });
  }

  return (
    <div className={`${cx}-container ${className || ''}`.trim()}>
      {/* Main view */}
      {view === 'sign_in' && (
        <SignIn
          onSuccess={handleSuccess}
          onMfaRequired={handleMfaRequired}
          onViewChange={handleViewChange}
        />
      )}

      {view === 'sign_up' && (
        <SignUp
          onSuccess={handleSuccess}
          onViewChange={handleViewChange}
        />
      )}

      {view === 'forgot_password' && (
        <ForgotPassword onViewChange={handleViewChange} />
      )}

      {view === 'magic_link' && (
        <MagicLink onViewChange={handleViewChange} />
      )}

      {view === 'email_otp' && (
        <EmailOTP
          onSuccess={handleSuccess}
          onViewChange={handleViewChange}
        />
      )}

      {view === 'phone_otp' && (
        <PhoneOTP
          onSuccess={handleSuccess}
          onViewChange={handleViewChange}
        />
      )}

      {view === 'mfa_challenge' && mfaTicket && (
        <MFAChallenge
          mfaTicket={mfaTicket}
          factors={mfaFactors}
          onSuccess={handleSuccess}
          onCancel={handleMfaCancel}
        />
      )}

      {/* Social buttons (shown on sign_in and sign_up views) */}
      {(view === 'sign_in' || view === 'sign_up') && (
        <SocialButtons />
      )}

      {/* Alternative sign-in methods */}
      {(view === 'sign_in' || view === 'sign_up') && altMethods.length > 0 && (
        <div className={`${cx}-alt-methods`}>
          {altMethods.map(({ view: altView, label }) => (
            <button
              key={altView}
              type="button"
              className={`${cx}-link ${cx}-alt-method`}
              onClick={() => handleViewChange(altView)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
