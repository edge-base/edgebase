/**
 * MagicLink — passwordless sign-in via email link.
 *
 * Sends a magic link to the user's email.
 */
import React, { useState, useCallback, type FormEvent } from 'react';
import { useAuthContext } from '../context.js';
import type { AuthView } from '../context.js';

export interface MagicLinkProps {
  /** Called to switch to another view */
  onViewChange?: (view: AuthView) => void;
  /** Additional CSS class */
  className?: string;
}

export function MagicLink({ onViewChange, className }: MagicLinkProps) {
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
      await client.auth.signInWithMagicLink({ email });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send magic link');
    } finally {
      setLoading(false);
    }
  }, [client, email]);

  if (success) {
    return (
      <div className={`${cx}-form ${cx}-magic-link ${cx}-success ${className || ''}`.trim()}>
        <h2 className={`${cx}-title`}>{labels.sendMagicLink}</h2>
        <p className={`${cx}-description`}>
          Check your email for a sign-in link.
        </p>
        <button
          type="button"
          className={`${cx}-link`}
          onClick={() => {
            setSuccess(false);
            setEmail('');
          }}
        >
          Send another link
        </button>
      </div>
    );
  }

  return (
    <form
      className={`${cx}-form ${cx}-magic-link ${className || ''}`.trim()}
      onSubmit={handleSubmit}
    >
      <h2 className={`${cx}-title`}>{labels.sendMagicLink}</h2>

      <p className={`${cx}-description`}>
        Enter your email and we'll send you a link to sign in.
      </p>

      {error && <div className={`${cx}-error`}>{error}</div>}

      <div className={`${cx}-field`}>
        <label className={`${cx}-label`} htmlFor={`${cx}-magic-email`}>
          {labels.email}
        </label>
        <input
          id={`${cx}-magic-email`}
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
        {loading ? labels.loading : labels.sendMagicLink}
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
