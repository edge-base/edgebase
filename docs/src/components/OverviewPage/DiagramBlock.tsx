import React from 'react';
import styles from '../overview.module.css';

interface DiagramBlockProps {
  title?: string;
  children: React.ReactNode;
}

export default function DiagramBlock({ title, children }: DiagramBlockProps) {
  return (
    <div className={styles.diagramBlock}>
      {title && <div className={styles.diagramTitle}>{title}</div>}
      <pre className={styles.diagramPre}>{children}</pre>
    </div>
  );
}
