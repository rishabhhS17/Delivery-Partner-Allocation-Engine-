import styles from './illustrations.module.css';

const SHARED = { fill: 'none', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' };

export function NoRidersIllustration() {
  return (
    <svg className={styles.illustration} viewBox="0 0 64 64" aria-hidden="true">
      <circle {...SHARED} className={styles.muted} cx="18" cy="44" r="9" />
      <circle {...SHARED} className={styles.muted} cx="46" cy="44" r="9" />
      <path {...SHARED} className={styles.accent} d="M18 44 L28 24 H38 M28 24 L34 44 M34 44 H46 M34 44 L24 34 H16" />
      <circle className={styles.accentFill} cx="38" cy="24" r="3" />
    </svg>
  );
}

export function NoOrdersIllustration() {
  return (
    <svg className={styles.illustration} viewBox="0 0 64 64" aria-hidden="true">
      <path {...SHARED} className={styles.muted} d="M14 24 L32 14 L50 24 V44 L32 54 L14 44 Z" />
      <path {...SHARED} className={styles.accent} d="M14 24 L32 34 L50 24 M32 34 V54" />
    </svg>
  );
}

export function NoRestaurantsIllustration() {
  return (
    <svg className={styles.illustration} viewBox="0 0 64 64" aria-hidden="true">
      <path {...SHARED} className={styles.muted} d="M12 26 L18 12 H46 L52 26" />
      <path {...SHARED} className={styles.muted} d="M12 26 V48 H52 V26" />
      <path {...SHARED} className={styles.accent} d="M12 26 H52 M27 26 V12 M40 26 V12" />
      <circle className={styles.accentFill} cx="32" cy="40" r="3.5" />
    </svg>
  );
}

export function NoCustomersIllustration() {
  return (
    <svg className={styles.illustration} viewBox="0 0 64 64" aria-hidden="true">
      <circle {...SHARED} className={styles.accent} cx="24" cy="22" r="8" />
      <path {...SHARED} className={styles.muted} d="M10 50 C10 38 16 32 24 32 C32 32 38 38 38 50" />
      <circle {...SHARED} className={styles.muted} cx="44" cy="26" r="6.5" />
      <path {...SHARED} className={styles.muted} d="M34 50 C34 41 38 36 44 36 C50 36 54 41 54 50" />
    </svg>
  );
}
