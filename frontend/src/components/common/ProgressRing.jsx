import styles from './ProgressRing.module.css';

const SIZE = 72;
const STROKE = 6;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Small SVG ring (e.g. available/total riders) — track + animated progress arc, color via data-color.
export default function ProgressRing({ percent = 0, label, sublabel, color = 'link' }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className={styles.wrap}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className={styles.svg}>
        <circle className={styles.track} cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} fill="none" />
        <circle
          className={styles.progress}
          data-color={color}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className={styles.center}>
        <span className={styles.label}>{label}</span>
        {sublabel && <span className={styles.sublabel}>{sublabel}</span>}
      </div>
    </div>
  );
}
