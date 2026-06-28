import styles from './LiveDot.module.css';

// The dispatch console's signature motif — a pulsing dot anywhere data is socket-driven
// (Topbar connection state, map eyebrows, dashboard feed). Off when not connected.
export default function LiveDot({ active = true, color = 'link' }) {
  return (
    <span className={styles.wrap} data-active={active} data-color={color} aria-hidden="true">
      <span className={styles.ring} />
      <span className={styles.core} />
    </span>
  );
}
