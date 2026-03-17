/**
 * SignUp — email/password registration form component.
 *
 * Headless-first: renders with CSS class hooks, no inline styles.
 */
import React, { useState, useCallback, type FormEvent } from 'react';
import { useAuthContext } from '../context.js';
import type { AuthView } from '../context.js';

export interface SignUpProps {
  /** Called after successful sign-up */
  onSuccess?: () => void;
  /** Called to switch to another view */
  onViewChange?: (view: AuthView) => void;
  /** Additional CSS class */
  className?: string;
}

export function SignUp({ onSuccess, onViewChange, className }: SignUpProps) {
  const { client, config, labels } = useAuthContext();
  const cx = config.classPrefix;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await client.auth.signUp({
        email,
        password,
        data: displayName ? { displayName } : undefined,
      });
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  }, [client, email, password, confirmPassword, displayName, onSuccess]);

  return (
    <form
      className={`${cx}-form ${cx}-sign-up ${className || ''}`.trim()}
      onSubmit={handleSubmit}
    >
      <h2 className={`${cx}-title`}>{labels.signUp}</h2>

      {error && <div className={`${cx}-error`}>{error}</div>}

      <div className={`${cx}-field`}>
        <label className={`${cx}-label`} htmlFor={`${cx}-signup-name`}>
          {labels.displayName}
        </label>
        <input
          id={`${cx}-signup-name`}
          className={`${cx}-input`}
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="name"
          disabled={loading}
        />
      </div>

      <div className={`${cx}-field`}>
        <label className={`${cx}-label`} htmlFor={`${cx}-signup-email`}>
          {labels.email}
        </label>
        <input
          id={`${cx}-signup-email`}
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
        <label className={`${cx}-label`} htmlFor={`${cx}-signup-password`}>
          {labels.password}
        </label>
        <input
          id={`${cx}-signup-password`}
          className={`${cx}-input`}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          disabled={loading}
        />
      </div>

      <div className={`${cx}-field`}>
        <label className={`${cx}-label`} htmlFor={`${cx}-signup-confirm`}>
          {labels.confirmPassword}
        </label>
        <input
          id={`${cx}-signup-confirm`}
          className={`${cx}-input`}
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
          disabled={loading}
        />
      </div>

      <button
        type="submit"
        className={`${cx}-button ${cx}-button-primary`}
        disabled={loading}
      >
        {loading ? labels.loading : labels.signUp}
      </button>

      {config.showToggle && (
        <p className={`${cx}-toggle`}>
          {labels.alreadyHaveAccount}{' '}
          <button
            type="button"
            className={`${cx}-link`}
            onClick={() => onViewChange?.('sign_in')}
          >
            {labels.signIn}
          </button>
        </p>
      )}
    </form>
  );
}
