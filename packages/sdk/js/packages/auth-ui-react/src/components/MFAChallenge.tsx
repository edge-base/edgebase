/**
 * MFAChallenge — TOTP verification form shown when MFA is required during sign-in.
 *
 * Supports TOTP code entry and recovery code fallback.
 */
import React, { useState, useCallback, type FormEvent } from 'react';
import { useAuthContext } from '../context.js';

export interface MFAChallengeProps {
  /** MFA ticket from sign-in result */
  mfaTicket: string;
  /** Available MFA factors */
  factors: Array<{ id: string; type: string }>;
  /** Called after successful MFA verification */
  onSuccess?: () => void;
  /** Called when user wants to go back */
  onCancel?: () => void;
  /** Additional CSS class */
  className?: string;
}

export function MFAChallenge({
  mfaTicket,
  factors,
  onSuccess,
  onCancel,
  className,
}: MFAChallengeProps) {
  const { client, config, labels } = useAuthContext();
  const cx = config.classPrefix;

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (useRecovery) {
        await client.auth.mfa.useRecoveryCode(mfaTicket, code);
      } else {
        await client.auth.mfa.verifyTotp(mfaTicket, code);
      }
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  }, [client, mfaTicket, code, useRecovery, onSuccess]);

  return (
    <form
      className={`${cx}-form ${cx}-mfa-challenge ${className || ''}`.trim()}
      onSubmit={handleSubmit}
    >
      <h2 className={`${cx}-title`}>
        {useRecovery ? 'Recovery Code' : 'Two-Factor Authentication'}
      </h2>

      <p className={`${cx}-description`}>
        {useRecovery
          ? 'Enter one of your recovery codes to sign in.'
          : 'Enter the 6-digit code from your authenticator app.'}
      </p>

      {error && <div className={`${cx}-error`}>{error}</div>}

      <div className={`${cx}-field`}>
        <label className={`${cx}-label`} htmlFor={`${cx}-mfa-code`}>
          {useRecovery ? 'Recovery Code' : labels.code}
        </label>
        <input
          id={`${cx}-mfa-code`}
          className={`${cx}-input ${cx}-input-code`}
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          autoComplete="one-time-code"
          placeholder={useRecovery ? 'XXXXX-XXXXX' : '000000'}
          disabled={loading}
          autoFocus
        />
      </div>

      <button
        type="submit"
        className={`${cx}-button ${cx}-button-primary`}
        disabled={loading}
      >
        {loading ? labels.loading : labels.verifyCode}
      </button>

      <div className={`${cx}-mfa-actions`}>
        <button
          type="button"
          className={`${cx}-link`}
          onClick={() => {
            setUseRecovery(!useRecovery);
            setCode('');
            setError(null);
          }}
        >
          {useRecovery ? 'Use authenticator code' : 'Use recovery code'}
        </button>

        {onCancel && (
          <button
            type="button"
            className={`${cx}-link`}
            onClick={onCancel}
          >
            {labels.backToSignIn}
          </button>
        )}
      </div>
    </form>
  );
}
