import styles from './Spinner.module.css';

export default function Spinner({ size = 'sm' }) {
  return (
    <span
      className={styles.spinner}
      data-size={size}
      role="status"
      aria-label="Loading"
    />
  );
}
