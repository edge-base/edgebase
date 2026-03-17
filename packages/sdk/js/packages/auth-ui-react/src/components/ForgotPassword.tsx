/**
 * ForgotPassword — password reset request form.
 *
 * Sends a reset email to the user.
 */
import React, { useState, useCallback, type FormEvent } from 'react';
import { useAuthContext } from '../context.js';
import type { AuthView } from '../context.js';

export interface ForgotPasswordProps {
  /** Called to switch to another view */
  onViewChange?: (view: AuthView) => void;
  /** Additional CSS class */
  className?: string;
}

export function ForgotPassword({ onViewChange, className }: ForgotPasswordProps) {
  const { client, config, labels } = useAuthContext();
  const cx = config.classPrefix;

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await client.auth.requestPasswordReset(email);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  }, [client, email]);

  if (success) {
    return (
      <div className={`${cx}-form ${cx}-forgot-password ${cx}-success ${className || ''}`.trim()}>
        <h2 className={`${cx}-title`}>{labels.resetPassword}</h2>
        <p className={`${cx}-description`}>
          Check your email for a password reset link.
        </p>
        <button
          type="button"
          className={`${cx}-link`}
          onClick={() => onViewChange?.('sign_in')}
        >
          {labels.backToSignIn}
        </button>
      </div>
    );
  }

  return (
    <form
      className={`${cx}-form ${cx}-forgot-password ${className || ''}`.trim()}
      onSubmit={handleSubmit}
    >
      <h2 className={`${cx}-title`}>{labels.resetPassword}</h2>

      <p className={`${cx}-description`}>
        Enter your email address and we'll send you a link to reset your password.
      </p>

      {error && <div className={`${cx}-error`}>{error}</div>}

      <div className={`${cx}-field`}>
        <label className={`${cx}-label`} htmlFor={`${cx}-reset-email`}>
          {labels.email}
        </label>
        <input
          id={`${cx}-reset-email`}
          className={`${cx}-input`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          disabled={loading}
        />
      </div>

      <button
        type="submit"
        className={`${cx}-button ${cx}-button-primary`}
        disabled={loading}
      >
        {loading ? labels.loading : labels.sendResetLink}
      </button>

      <button
        type="button"
        className={`${cx}-link`}
        onClick={() => onViewChange?.('sign_in')}
      >
        {labels.backToSignIn}
      </button>
    </form>
  );
}
