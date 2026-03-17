/**
 * SignIn — email/password sign-in form component.
 *
 * Headless-first: renders with CSS class hooks, no inline styles.
 * Uses `classPrefix` from AuthProvider context (default: 'eb-auth').
 */
import React, { useState, useCallback, type FormEvent } from 'react';
import { useAuthContext } from '../context.js';
import type { AuthView } from '../context.js';

export interface SignInProps {
  /** Called after successful sign-in */
  onSuccess?: () => void;
  /** Called when MFA challenge is required */
  onMfaRequired?: (mfaTicket: string, factors: Array<{ id: string; type: string }>) => void;
  /** Called to switch to another view */
  onViewChange?: (view: AuthView) => void;
  /** Additional CSS class */
  className?: string;
}

export function SignIn({ onSuccess, onMfaRequired, onViewChange, className }: SignInProps) {
  const { client, config, labels } = useAuthContext();
  const cx = config.classPrefix;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await client.auth.signIn({ email, password });
      if ('mfaRequired' in result && result.mfaRequired) {
        onMfaRequired?.(result.mfaTicket, result.factors);
      } else {
        onSuccess?.();
      }
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }, [client, email, password, onSuccess, onMfaRequired]);

  return (
    <form
      className={`${cx}-form ${cx}-sign-in ${className || ''}`.trim()}
      onSubmit={handleSubmit}
    >
      <h2 className={`${cx}-title`}>{labels.signIn}</h2>

      {error && <div className={`${cx}-error`}>{error}</div>}

      <div className={`${cx}-field`}>
        <label className={`${cx}-label`} htmlFor={`${cx}-email`}>
          {labels.email}
        </label>
        <input
          id={`${cx}-email`}
          className={`${cx}-input`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          disabled={loading}
        />
      </div>

      <div className={`${cx}-field`}>
        <label className={`${cx}-label`} htmlFor={`${cx}-password`}>
          {labels.password}
        </label>
        <input
          id={`${cx}-password`}
          className={`${cx}-input`}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          disabled={loading}
        />
      </div>

      {config.showForgotPassword && (
        <button
          type="button"
          className={`${cx}-link ${cx}-forgot-link`}
          onClick={() => onViewChange?.('forgot_password')}
        >
          {labels.forgotPassword}
        </button>
      )}

      <button
        type="submit"
        className={`${cx}-button ${cx}-button-primary`}
        disabled={loading}
      >
        {loading ? labels.loading : labels.signIn}
      </button>

      {config.showToggle && (
        <p className={`${cx}-toggle`}>
          {labels.dontHaveAccount}{' '}
          <button
            type="button"
            className={`${cx}-link`}
            onClick={() => onViewChange?.('sign_up')}
          >
            {labels.signUp}
          </button>
        </p>
      )}
    </form>
  );
}
