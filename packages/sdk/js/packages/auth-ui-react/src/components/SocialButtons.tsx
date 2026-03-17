/**
 * SocialButtons — OAuth provider buttons.
 *
 * Renders a button for each configured provider.
 * Uses signInWithOAuth which redirects the browser.
 */
import React, { useCallback } from 'react';
import { useAuthContext } from '../context.js';

/** Display labels for well-known OAuth providers */
const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  apple: 'Apple',
  discord: 'Discord',
  twitter: 'Twitter',
  facebook: 'Facebook',
  microsoft: 'Microsoft',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  linkedin: 'LinkedIn',
  slack: 'Slack',
  spotify: 'Spotify',
  twitch: 'Twitch',
};

export interface SocialButtonsProps {
  /** Additional CSS class */
  className?: string;
}

export function SocialButtons({ className }: SocialButtonsProps) {
  const { client, config, labels } = useAuthContext();
  const cx = config.classPrefix;
  const providers = config.providers;

  const handleOAuth = useCallback((provider: string) => {
    client.auth.signInWithOAuth(provider, {
      redirectUrl: config.oauthRedirectUrl,
    });
  }, [client, config.oauthRedirectUrl]);

  if (!providers || providers.length === 0) return null;

  return (
    <div className={`${cx}-social ${className || ''}`.trim()}>
      <div className={`${cx}-divider`}>
        <span>{labels.orContinueWith}</span>
      </div>

      <div className={`${cx}-social-buttons`}>
        {providers.map((provider) => (
          <button
            key={provider}
            type="button"
            className={`${cx}-button ${cx}-button-social ${cx}-button-${provider}`}
            onClick={() => handleOAuth(provider)}
          >
            {PROVIDER_LABELS[provider] || provider}
          </button>
        ))}
      </div>
    </div>
  );
}
