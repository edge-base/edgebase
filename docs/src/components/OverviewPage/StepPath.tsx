import React from 'react';
import styles from '../overview.module.css';

interface Step {
  title: string;
  description: string;
  code?: string;
}

interface StepPathProps {
  steps: Step[];
}

export default function StepPath({ steps }: StepPathProps) {
  return (
    <div className={styles.stepPath}>
      {steps.map((step, i) => (
        <div key={i} className={styles.stepItem}>
          <div className={styles.stepNumber}>{i + 1}</div>
          <div className={styles.stepContent}>
            <h4 className={styles.stepTitle}>{step.title}</h4>
            <p className={styles.stepDesc}>{step.description}</p>
            {step.code && (
              <code className={styles.stepCode}>{step.code}</code>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
