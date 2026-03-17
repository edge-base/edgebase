import React from 'react';
import styles from '../overview.module.css';

interface NextStep {
  title: string;
  description: string;
  href: string;
  icon?: string;
}

interface NextStepCardsProps {
  steps: NextStep[];
}

export default function NextStepCards({ steps }: NextStepCardsProps) {
  return (
    <div className={styles.nextStepGrid}>
      {steps.map((s) => (
        <a key={s.title} className={styles.nextStepCard} href={s.href}>
          {s.icon && <span className={styles.nextStepIcon}>{s.icon}</span>}
          <div className={styles.nextStepBody}>
            <div className={styles.nextStepTitle}>{s.title}</div>
            <p className={styles.nextStepDesc}>{s.description}</p>
          </div>
          <span className={styles.nextStepArrow}>→</span>
        </a>
      ))}
    </div>
  );
}
