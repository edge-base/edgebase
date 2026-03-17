import React from 'react';
import styles from '../overview.module.css';

interface Feature {
  icon: string;
  title: string;
  description: string;
  link?: string;
}

interface FeatureGridProps {
  features: Feature[];
  columns?: 2 | 3;
}

export default function FeatureGrid({ features, columns = 3 }: FeatureGridProps) {
  return (
    <div className={styles.featureGrid} data-columns={columns}>
      {features.map((f) => {
        const content = (
          <>
            <span className={styles.featureGridIcon}>{f.icon}</span>
            <h3 className={styles.featureGridTitle}>{f.title}</h3>
            <p className={styles.featureGridDesc}>{f.description}</p>
          </>
        );

        return f.link ? (
          <a key={f.title} className={styles.featureGridCard} href={f.link}>
            {content}
          </a>
        ) : (
          <div key={f.title} className={styles.featureGridCard}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
