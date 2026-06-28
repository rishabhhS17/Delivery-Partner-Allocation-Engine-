import styles from './Logo.module.css';

// The NexRoute mark — a comet stroke sweeping into a destination dot. Same geometry is
// mirrored (static) in public/favicon.svg and the OG/PWA icon renders.
function Mark({ animated }) {
  return (
    <svg
      className={styles.mark}
      data-animated={animated}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path className={styles.stroke} d="M 5 10 Q 14 8 19 16 T 25 20" strokeLinecap="round" strokeWidth="3.2" />
      <circle className={styles.dot} cx="25" cy="21" r="3.5" />
    </svg>
  );
}

export default function Logo({ variant = 'full', size = 'md', animated = true, className = '' }) {
  return (
    <span className={`${styles.lockup} ${className}`} data-size={size}>
      <Mark animated={animated} />
      {variant === 'full' && <span className={styles.wordmark}>NexRoute</span>}
    </span>
  );
}
