import React from 'react';
import styles from '../overview.module.css';
import { getPlatformToken } from '../../lib/platformTokens';

interface OverviewHeroProps {
  icon?: string;
  title: string;
  tagline: string;
  platforms?: string[];
}

export default function OverviewHero({ title, tagline, platforms }: OverviewHeroProps) {
  return (
    <div className={styles.overviewHero}>
      <div className={styles.overviewHeroHeader}>
        <h1 className={styles.overviewHeroTitle}>{title}</h1>
        {platforms && platforms.length > 0 && (
          <div className={styles.platformBadges}>
            {platforms.map((p) => {
              const token = getPlatformToken(p);
              return token ? (
                <span key={p} className={styles.platformBadge} data-tooltip={token.label}>
                  {token.logoSrc ? (
                    <img src={token.logoSrc} alt={token.label} className={styles.platformIcon} />
                  ) : (
                    <span className={styles.platformToken} style={token.style} aria-hidden="true">
                      {token.short}
                    </span>
                  )}
                </span>
              ) : null;
            })}
          </div>
        )}
      </div>
      <p className={styles.overviewHeroTagline}>{tagline}</p>
    </div>
  );
}
