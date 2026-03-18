/**
 * @edgebase-fun/auth-ui-react — Headless React authentication UI components.
 *
 * Usage:
 * ```tsx
 * import { createClient } from '@edgebase-fun/web';
 * import { AuthProvider, AuthForm } from '@edgebase-fun/auth-ui-react';
 * import '@edgebase-fun/auth-ui-react/styles.css'; // optional default theme
 *
 * const client = createClient('https://my-app.edgebase.fun');
 *
 * function App() {
 *   return (
 *     <AuthProvider
 *       client={client}
 *       config={{
 *         providers: ['google', 'github'],
 *         magicLinkEnabled: true,
 *       }}
 *     >
 *       <AuthForm onSuccess={() => navigate('/dashboard')} />
 *     </AuthProvider>
 *   );
 * }
 * ```
 */

// Context & Provider
export { AuthProvider, useAuthContext } from './context.js';
export type { AuthProviderProps, AuthUIConfig, AuthUILabels, AuthView, AuthContextValue } from './context.js';

// Hooks
export { useAuth } from './hooks/useAuth.js';
export type { UseAuthReturn } from './hooks/useAuth.js';

// Components
export { AuthForm } from './components/AuthForm.js';
export type { AuthFormProps } from './components/AuthForm.js';

export { SignIn } from './components/SignIn.js';
export type { SignInProps } from './components/SignIn.js';

export { SignUp } from './components/SignUp.js';
export type { SignUpProps } from './components/SignUp.js';

export { SocialButtons } from './components/SocialButtons.js';
export type { SocialButtonsProps } from './components/SocialButtons.js';

export { MFAChallenge } from './components/MFAChallenge.js';
export type { MFAChallengeProps } from './components/MFAChallenge.js';

export { ForgotPassword } from './components/ForgotPassword.js';
export type { ForgotPasswordProps } from './components/ForgotPassword.js';

export { MagicLink } from './components/MagicLink.js';
export type { MagicLinkProps } from './components/MagicLink.js';

export { EmailOTP } from './components/EmailOTP.js';
export type { EmailOTPProps } from './components/EmailOTP.js';

export { PhoneOTP } from './components/PhoneOTP.js';
export type { PhoneOTPProps } from './components/PhoneOTP.js';
