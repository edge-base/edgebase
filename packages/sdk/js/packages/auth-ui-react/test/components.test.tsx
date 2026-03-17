/**
 * Auth UI React — Component tests
 *
 * Tests component rendering, form interactions, and view switching.
 * Uses a mock EdgeBase client to avoid real API calls.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  AuthProvider,
  AuthForm,
  SignIn,
  SignUp,
  SocialButtons,
  MFAChallenge,
  ForgotPassword,
  MagicLink,
  EmailOTP,
  PhoneOTP,
  useAuth,
} from '../src/index.js';
import type { AuthUIConfig } from '../src/index.js';

// ─── Mock Client ─────────────────────────────────────────────────────────────

function createMockClient(overrides?: Record<string, any>) {
  return {
    auth: {
      signIn: vi.fn().mockResolvedValue({
        user: { id: 'u1', email: 'test@test.com' },
        accessToken: 'at',
        refreshToken: 'rt',
      }),
      signUp: vi.fn().mockResolvedValue({
        user: { id: 'u1', email: 'test@test.com' },
        accessToken: 'at',
        refreshToken: 'rt',
      }),
      signOut: vi.fn().mockResolvedValue(undefined),
      signInWithOAuth: vi.fn().mockReturnValue({ url: 'https://oauth.example.com' }),
      signInWithMagicLink: vi.fn().mockResolvedValue(undefined),
      signInWithPhone: vi.fn().mockResolvedValue(undefined),
      signInWithEmailOtp: vi.fn().mockResolvedValue(undefined),
      verifyPhone: vi.fn().mockResolvedValue({
        user: { id: 'u1' }, accessToken: 'at', refreshToken: 'rt',
      }),
      verifyEmailOtp: vi.fn().mockResolvedValue({
        user: { id: 'u1' }, accessToken: 'at', refreshToken: 'rt',
      }),
      requestPasswordReset: vi.fn().mockResolvedValue(undefined),
      currentUser: null,
      onAuthStateChange: vi.fn().mockReturnValue(() => {}),
      mfa: {
        verifyTotp: vi.fn().mockResolvedValue({
          user: { id: 'u1' }, accessToken: 'at', refreshToken: 'rt',
        }),
        useRecoveryCode: vi.fn().mockResolvedValue({
          user: { id: 'u1' }, accessToken: 'at', refreshToken: 'rt',
        }),
      },
      ...overrides,
    },
  } as any;
}

function renderWithProvider(
  ui: React.ReactElement,
  config?: AuthUIConfig,
  clientOverrides?: Record<string, any>,
) {
  const client = createMockClient(clientOverrides);
  return {
    ...render(
      <AuthProvider client={client} config={config}>
        {ui}
      </AuthProvider>,
    ),
    client,
  };
}

// ─── 1. AuthProvider & Context ──────────────────────────────────────────────

describe('AuthProvider', () => {
  it('renders children', () => {
    renderWithProvider(<div data-testid="child">Hello</div>);
    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('throws when useAuthContext is used outside provider', () => {
    // Suppress console.error from React error boundary
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      render(<SignIn />);
    }).toThrow('useAuthContext must be used within an <AuthProvider>');
    spy.mockRestore();
  });
});

// ─── 2. useAuth Hook ────────────────────────────────────────────────────────

describe('useAuth', () => {
  it('returns user, loading, signOut', () => {
    function TestComponent() {
      const { user, loading, signOut } = useAuth();
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="user">{user ? user.id : 'null'}</span>
          <button onClick={signOut}>Sign Out</button>
        </div>
      );
    }

    const { client } = renderWithProvider(<TestComponent />);
    // Initially loading=false after effect runs (onAuthStateChange returns immediately)
    expect(screen.getByTestId('user')).toHaveTextContent('null');
  });

  it('calls signOut on the client', async () => {
    function TestComponent() {
      const { signOut } = useAuth();
      return <button onClick={signOut}>Sign Out</button>;
    }

    const { client } = renderWithProvider(<TestComponent />);
    fireEvent.click(screen.getByText('Sign Out'));
    await waitFor(() => {
      expect(client.auth.signOut).toHaveBeenCalled();
    });
  });
});

// ─── 3. SignIn Component ────────────────────────────────────────────────────

describe('SignIn', () => {
  it('renders email and password inputs', () => {
    renderWithProvider(<SignIn />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('renders sign-in button', () => {
    renderWithProvider(<SignIn />);
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('renders forgot password link', () => {
    renderWithProvider(<SignIn />);
    expect(screen.getByText('Forgot Password?')).toBeInTheDocument();
  });

  it('renders sign-up toggle', () => {
    renderWithProvider(<SignIn />);
    expect(screen.getByText("Don't have an account?")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Up' })).toBeInTheDocument();
  });

  it('hides forgot password link when config.showForgotPassword=false', () => {
    renderWithProvider(<SignIn />, { showForgotPassword: false });
    expect(screen.queryByText('Forgot Password?')).not.toBeInTheDocument();
  });

  it('hides toggle when config.showToggle=false', () => {
    renderWithProvider(<SignIn />, { showToggle: false });
    expect(screen.queryByText("Don't have an account?")).not.toBeInTheDocument();
  });

  it('calls client.auth.signIn on submit', async () => {
    const onSuccess = vi.fn();
    const { client } = renderWithProvider(<SignIn onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(client.auth.signIn).toHaveBeenCalledWith({
        email: 'test@test.com',
        password: 'password123',
      });
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('shows error on sign-in failure', async () => {
    const { client } = renderWithProvider(<SignIn />, undefined, {
      signIn: vi.fn().mockRejectedValue(new Error('Invalid credentials')),
    });

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('calls onMfaRequired when MFA is needed', async () => {
    const onMfaRequired = vi.fn();
    renderWithProvider(<SignIn onMfaRequired={onMfaRequired} />, undefined, {
      signIn: vi.fn().mockResolvedValue({
        mfaRequired: true,
        mfaTicket: 'ticket123',
        factors: [{ id: 'f1', type: 'totp' }],
      }),
    });

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(onMfaRequired).toHaveBeenCalledWith('ticket123', [{ id: 'f1', type: 'totp' }]);
    });
  });

  it('calls onViewChange when forgot password is clicked', () => {
    const onViewChange = vi.fn();
    renderWithProvider(<SignIn onViewChange={onViewChange} />);
    fireEvent.click(screen.getByText('Forgot Password?'));
    expect(onViewChange).toHaveBeenCalledWith('forgot_password');
  });

  it('calls onViewChange when sign-up toggle is clicked', () => {
    const onViewChange = vi.fn();
    renderWithProvider(<SignIn onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));
    expect(onViewChange).toHaveBeenCalledWith('sign_up');
  });
});

// ─── 4. SignUp Component ────────────────────────────────────────────────────

describe('SignUp', () => {
  it('renders all fields', () => {
    renderWithProvider(<SignUp />);
    expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
  });

  it('shows error when passwords do not match', async () => {
    renderWithProvider(<SignUp />);
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'different' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });
  });

  it('calls client.auth.signUp on valid submit', async () => {
    const onSuccess = vi.fn();
    const { client } = renderWithProvider(<SignUp onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText('Display Name'), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));

    await waitFor(() => {
      expect(client.auth.signUp).toHaveBeenCalledWith({
        email: 'test@test.com',
        password: 'password123',
        data: { displayName: 'Test User' },
      });
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('shows sign-in toggle', () => {
    renderWithProvider(<SignUp />);
    expect(screen.getByText('Already have an account?')).toBeInTheDocument();
  });
});

// ─── 5. SocialButtons Component ─────────────────────────────────────────────

describe('SocialButtons', () => {
  it('renders nothing when no providers configured', () => {
    const { container } = renderWithProvider(<SocialButtons />);
    expect(container.innerHTML).toBe('');
  });

  it('renders buttons for configured providers', () => {
    renderWithProvider(<SocialButtons />, { providers: ['google', 'github'] });
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('calls signInWithOAuth on click', () => {
    const { client } = renderWithProvider(<SocialButtons />, {
      providers: ['google'],
    });
    fireEvent.click(screen.getByText('Google'));
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith('google', {
      redirectUrl: undefined,
    });
  });

  it('uses custom oauthRedirectUrl', () => {
    const { client } = renderWithProvider(<SocialButtons />, {
      providers: ['github'],
      oauthRedirectUrl: 'https://app.com/callback',
    });
    fireEvent.click(screen.getByText('GitHub'));
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith('github', {
      redirectUrl: 'https://app.com/callback',
    });
  });

  it('shows "Or continue with" divider', () => {
    renderWithProvider(<SocialButtons />, { providers: ['google'] });
    expect(screen.getByText('Or continue with')).toBeInTheDocument();
  });
});

// ─── 6. MFAChallenge Component ──────────────────────────────────────────────

describe('MFAChallenge', () => {
  it('renders TOTP code input', () => {
    renderWithProvider(
      <MFAChallenge
        mfaTicket="ticket123"
        factors={[{ id: 'f1', type: 'totp' }]}
      />,
    );
    expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument();
    expect(screen.getByLabelText('Verification Code')).toBeInTheDocument();
  });

  it('calls mfa.verifyTotp on submit', async () => {
    const onSuccess = vi.fn();
    const { client } = renderWithProvider(
      <MFAChallenge
        mfaTicket="ticket123"
        factors={[{ id: 'f1', type: 'totp' }]}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText('Verification Code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));

    await waitFor(() => {
      expect(client.auth.mfa.verifyTotp).toHaveBeenCalledWith('ticket123', '123456');
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('switches to recovery code mode', () => {
    renderWithProvider(
      <MFAChallenge
        mfaTicket="ticket123"
        factors={[{ id: 'f1', type: 'totp' }]}
      />,
    );
    fireEvent.click(screen.getByText('Use recovery code'));
    // Title and label both say "Recovery Code" — check heading specifically
    expect(screen.getByRole('heading', { name: 'Recovery Code' })).toBeInTheDocument();
  });

  it('calls mfa.useRecoveryCode in recovery mode', async () => {
    const onSuccess = vi.fn();
    const { client } = renderWithProvider(
      <MFAChallenge
        mfaTicket="ticket123"
        factors={[{ id: 'f1', type: 'totp' }]}
        onSuccess={onSuccess}
      />,
    );

    // Switch to recovery mode
    fireEvent.click(screen.getByText('Use recovery code'));

    fireEvent.change(screen.getByLabelText('Recovery Code'), {
      target: { value: 'abcde-fghij' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));

    await waitFor(() => {
      expect(client.auth.mfa.useRecoveryCode).toHaveBeenCalledWith('ticket123', 'abcde-fghij');
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('calls onCancel when back button clicked', () => {
    const onCancel = vi.fn();
    renderWithProvider(
      <MFAChallenge
        mfaTicket="ticket123"
        factors={[{ id: 'f1', type: 'totp' }]}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('Back to Sign In'));
    expect(onCancel).toHaveBeenCalled();
  });
});

// ─── 7. ForgotPassword Component ────────────────────────────────────────────

describe('ForgotPassword', () => {
  it('renders email input and submit button', () => {
    renderWithProvider(<ForgotPassword />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeInTheDocument();
  });

  it('calls requestPasswordReset on submit', async () => {
    const { client } = renderWithProvider(<ForgotPassword />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    await waitFor(() => {
      expect(client.auth.requestPasswordReset).toHaveBeenCalledWith('test@test.com');
    });
  });

  it('shows success message after sending', async () => {
    renderWithProvider(<ForgotPassword />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    await waitFor(() => {
      expect(screen.getByText(/Check your email/)).toBeInTheDocument();
    });
  });

  it('has back to sign in link', () => {
    const onViewChange = vi.fn();
    renderWithProvider(<ForgotPassword onViewChange={onViewChange} />);
    fireEvent.click(screen.getByText('Back to Sign In'));
    expect(onViewChange).toHaveBeenCalledWith('sign_in');
  });
});

// ─── 8. MagicLink Component ────────────────────────────────────────────────

describe('MagicLink', () => {
  it('renders email input', () => {
    renderWithProvider(<MagicLink />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Magic Link' })).toBeInTheDocument();
  });

  it('calls signInWithMagicLink on submit', async () => {
    const { client } = renderWithProvider(<MagicLink />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Magic Link' }));

    await waitFor(() => {
      expect(client.auth.signInWithMagicLink).toHaveBeenCalledWith({
        email: 'test@test.com',
      });
    });
  });

  it('shows success message after sending', async () => {
    renderWithProvider(<MagicLink />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Magic Link' }));

    await waitFor(() => {
      expect(screen.getByText(/Check your email/)).toBeInTheDocument();
    });
  });
});

// ─── 9. EmailOTP Component ─────────────────────────────────────────────────

describe('EmailOTP', () => {
  it('renders email input in first step', () => {
    renderWithProvider(<EmailOTP />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Code' })).toBeInTheDocument();
  });

  it('calls signInWithEmailOtp and moves to code step', async () => {
    const { client } = renderWithProvider(<EmailOTP />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Code' }));

    await waitFor(() => {
      expect(client.auth.signInWithEmailOtp).toHaveBeenCalledWith({
        email: 'test@test.com',
      });
      expect(screen.getByLabelText('Verification Code')).toBeInTheDocument();
    });
  });

  it('calls verifyEmailOtp on code submit', async () => {
    const onSuccess = vi.fn();
    const { client } = renderWithProvider(<EmailOTP onSuccess={onSuccess} />);

    // Step 1: Enter email
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Code' }));

    // Step 2: Enter code
    await waitFor(() => {
      expect(screen.getByLabelText('Verification Code')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Verification Code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));

    await waitFor(() => {
      expect(client.auth.verifyEmailOtp).toHaveBeenCalledWith({
        email: 'test@test.com',
        code: '123456',
      });
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});

// ─── 10. PhoneOTP Component ────────────────────────────────────────────────

describe('PhoneOTP', () => {
  it('renders phone input in first step', () => {
    renderWithProvider(<PhoneOTP />);
    expect(screen.getByLabelText('Phone Number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Code' })).toBeInTheDocument();
  });

  it('calls signInWithPhone and moves to code step', async () => {
    const { client } = renderWithProvider(<PhoneOTP />);

    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '+1234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Code' }));

    await waitFor(() => {
      expect(client.auth.signInWithPhone).toHaveBeenCalledWith({
        phone: '+1234567890',
      });
      expect(screen.getByLabelText('Verification Code')).toBeInTheDocument();
    });
  });

  it('calls verifyPhone on code submit', async () => {
    const onSuccess = vi.fn();
    const { client } = renderWithProvider(<PhoneOTP onSuccess={onSuccess} />);

    // Step 1: Enter phone
    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '+1234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Code' }));

    // Step 2: Enter code
    await waitFor(() => {
      expect(screen.getByLabelText('Verification Code')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Verification Code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));

    await waitFor(() => {
      expect(client.auth.verifyPhone).toHaveBeenCalledWith({
        phone: '+1234567890',
        code: '123456',
      });
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});

// ─── 11. AuthForm Orchestrator ──────────────────────────────────────────────

describe('AuthForm', () => {
  it('renders sign-in view by default', () => {
    renderWithProvider(<AuthForm />);
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('renders sign-up view when defaultView is sign_up', () => {
    renderWithProvider(<AuthForm defaultView="sign_up" />);
    expect(screen.getByRole('button', { name: 'Sign Up' })).toBeInTheDocument();
  });

  it('switches from sign-in to sign-up', () => {
    renderWithProvider(<AuthForm />);
    // Click the "Sign Up" toggle link
    const signUpButton = screen.getAllByRole('button', { name: 'Sign Up' });
    // The first "Sign Up" button is the toggle link
    fireEvent.click(signUpButton[signUpButton.length - 1]);

    // Should now show sign-up form
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
  });

  it('switches to forgot password view', () => {
    renderWithProvider(<AuthForm />);
    fireEvent.click(screen.getByText('Forgot Password?'));
    expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeInTheDocument();
  });

  it('shows social buttons when providers configured', () => {
    renderWithProvider(<AuthForm />, { providers: ['google', 'github'] });
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('shows magic link option when enabled', () => {
    renderWithProvider(<AuthForm />, { magicLinkEnabled: true });
    expect(screen.getByText('Sign in with Magic Link')).toBeInTheDocument();
  });

  it('shows email OTP option when enabled', () => {
    renderWithProvider(<AuthForm />, { emailOtpEnabled: true });
    expect(screen.getByText('Sign in with Email Code')).toBeInTheDocument();
  });

  it('shows phone OTP option when enabled', () => {
    renderWithProvider(<AuthForm />, { phoneOtpEnabled: true });
    expect(screen.getByText('Sign in with Phone')).toBeInTheDocument();
  });

  it('returns null when user is authenticated', () => {
    const { container } = renderWithProvider(<AuthForm />, undefined, {
      currentUser: { id: 'u1', email: 'test@test.com' },
      onAuthStateChange: vi.fn((cb: any) => {
        // Fire immediately with authenticated user
        cb({ id: 'u1', email: 'test@test.com' });
        return () => {};
      }),
    });
    // AuthForm should render nothing when user is authenticated
    expect(container.querySelector('.eb-auth-form')).toBeNull();
  });

  it('handles MFA challenge flow', async () => {
    renderWithProvider(<AuthForm />, undefined, {
      signIn: vi.fn().mockResolvedValue({
        mfaRequired: true,
        mfaTicket: 'ticket123',
        factors: [{ id: 'f1', type: 'totp' }],
      }),
    });

    // Fill and submit sign-in
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@test.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    // Should transition to MFA challenge
    await waitFor(() => {
      expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument();
    });
  });
});

// ─── 12. Localization ──────────────────────────────────────────────────────

describe('Localization', () => {
  it('uses custom labels', () => {
    renderWithProvider(<SignIn />, {
      localization: {
        signIn: '로그인',
        email: '이메일',
        password: '비밀번호',
        forgotPassword: '비밀번호 찾기',
      },
    });

    // Title and button both say '로그인' — check heading specifically
    expect(screen.getByRole('heading', { name: '로그인' })).toBeInTheDocument();
    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument();
    expect(screen.getByText('비밀번호 찾기')).toBeInTheDocument();
  });
});

// ─── 13. CSS Class Prefix ──────────────────────────────────────────────────

describe('CSS Class Prefix', () => {
  it('uses default prefix eb-auth', () => {
    const { container } = renderWithProvider(<SignIn />);
    expect(container.querySelector('.eb-auth-form')).toBeInTheDocument();
    expect(container.querySelector('.eb-auth-sign-in')).toBeInTheDocument();
  });

  it('uses custom prefix', () => {
    const { container } = renderWithProvider(<SignIn />, { classPrefix: 'my-auth' });
    expect(container.querySelector('.my-auth-form')).toBeInTheDocument();
    expect(container.querySelector('.my-auth-sign-in')).toBeInTheDocument();
  });
});
