import { memo } from 'react';
import styles from './MarkerLabel.module.css';

const MAX_CHARS = 22;

/**
 * Floating pill label for react-map-gl <Marker> components.
 * Must be placed inside a container with `position: relative`.
 * The label is absolutely positioned above the sibling pin element.
 */
const MarkerLabel = memo(function MarkerLabel({ label }) {
  if (!label) return null;
  const truncated = label.length > MAX_CHARS;
  const display   = truncated ? label.slice(0, MAX_CHARS) + '…' : label;

  return (
    <div
      className={styles.label}
      title={truncated ? label : undefined}
    >
      {display}
    </div>
  );
});

export default MarkerLabel;
