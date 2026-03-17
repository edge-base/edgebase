/**
 * PhoneOTP — phone number OTP sign-in form.
 *
 * Two-step flow: 1) Enter phone → send SMS code, 2) Enter code → verify.
 */
import React, { useState, useCallback, type FormEvent } from 'react';
import { useAuthContext } from '../context.js';
import type { AuthView } from '../context.js';

export interface PhoneOTPProps {
  /** Called after successful sign-in */
  onSuccess?: () => void;
  /** Called to switch to another view */
  onViewChange?: (view: AuthView) => void;
  /** Additional CSS class */
  className?: string;
}

export function PhoneOTP({ onSuccess, onViewChange, className }: PhoneOTPProps) {
  const { client, config, labels } = useAuthContext();
  const cx = config.classPrefix;

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSendCode = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await client.auth.signInWithPhone({ phone });
      setStep('code');
    } catch (err: any) {
      setError(err.message || 'Failed to send SMS code');
    } finally {
      setLoading(false);
    }
  }, [client, phone]);

  const handleVerify = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await client.auth.verifyPhone({ phone, code });
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  }, [client, phone, code, onSuccess]);

  if (step === 'code') {
    return (
      <form
        className={`${cx}-form ${cx}-phone-otp ${className || ''}`.trim()}
        onSubmit={handleVerify}
      >
        <h2 className={`${cx}-title`}>{labels.verifyCode}</h2>

        <p className={`${cx}-description`}>
          Enter the code sent to {phone}
        </p>

        {error && <div className={`${cx}-error`}>{error}</div>}

        <div className={`${cx}-field`}>
          <label className={`${cx}-label`} htmlFor={`${cx}-phone-otp-code`}>
            {labels.code}
          </label>
          <input
            id={`${cx}-phone-otp-code`}
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
            setStep('phone');
            setCode('');
            setError(null);
          }}
        >
          Change phone number
        </button>
      </form>
    );
  }

  return (
    <form
      className={`${cx}-form ${cx}-phone-otp ${className || ''}`.trim()}
      onSubmit={handleSendCode}
    >
      <h2 className={`${cx}-title`}>{labels.sendOTP}</h2>

      <p className={`${cx}-description`}>
        Enter your phone number to receive a sign-in code via SMS.
      </p>

      {error && <div className={`${cx}-error`}>{error}</div>}

      <div className={`${cx}-field`}>
        <label className={`${cx}-label`} htmlFor={`${cx}-phone-otp-phone`}>
          {labels.phone}
        </label>
        <input
          id={`${cx}-phone-otp-phone`}
          className={`${cx}-input`}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          autoComplete="tel"
          placeholder="+1234567890"
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
