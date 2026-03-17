/**
 * EmailOTP — email one-time-password sign-in form.
 *
 * Two-step flow: 1) Enter email → send code, 2) Enter code → verify.
 */
import React, { useState, useCallback, type FormEvent } from 'react';
import { useAuthContext } from '../context.js';
import type { AuthView } from '../context.js';

export interface EmailOTPProps {
  /** Called after successful sign-in */
  onSuccess?: () => void;
  /** Called to switch to another view */
  onViewChange?: (view: AuthView) => void;
  /** Additional CSS class */
  className?: string;
}

export function EmailOTP({ onSuccess, onViewChange, className }: EmailOTPProps) {
  const { client, config, labels } = useAuthContext();
  const cx = config.classPrefix;

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSendCode = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await client.auth.signInWithEmailOtp({ email });
      setStep('code');
    } catch (err: any) {
      setError(err.message || 'Failed to send code');
    } finally {
      setLoading(false);
    }
  }, [client, email]);

  const handleVerify = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await client.auth.verifyEmailOtp({ email, code });
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  }, [client, email, code, onSuccess]);

  if (step === 'code') {
    return (
      <form
        className={`${cx}-form ${cx}-email-otp ${className || ''}`.trim()}
        onSubmit={handleVerify}
      >
        <h2 className={`${cx}-title`}>{labels.verifyCode}</h2>

        <p className={`${cx}-description`}>
          Enter the code sent to {email}
        </p>

        {error && <div className={`${cx}-error`}>{error}</div>}

        <div className={`${cx}-field`}>
          <label className={`${cx}-label`} htmlFor={`${cx}-email-otp-code`}>
            {labels.code}
          </label>
          <input
            id={`${cx}-email-otp-code`}
            className={`${cx}-input ${cx}-input-code`}
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoComplete="one-time-code"
            placeholder="000000"
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

        <button
          type="button"
          className={`${cx}-link`}
          onClick={() => {
            setStep('email');
            setCode('');
            setError(null);
          }}
        >
          Change email
        </button>
      </form>
    );
  }

  return (
    <form
      className={`${cx}-form ${cx}-email-otp ${className || ''}`.trim()}
      onSubmit={handleSendCode}
    >
      <h2 className={`${cx}-title`}>{labels.sendOTP}</h2>

      <p className={`${cx}-description`}>
        Enter your email to receive a one-time sign-in code.
      </p>

      {error && <div className={`${cx}-error`}>{error}</div>}

      <div className={`${cx}-field`}>
        <label className={`${cx}-label`} htmlFor={`${cx}-email-otp-email`}>
          {labels.email}
        </label>
        <input
          id={`${cx}-email-otp-email`}
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
        {loading ? labels.loading : labels.sendOTP}
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
