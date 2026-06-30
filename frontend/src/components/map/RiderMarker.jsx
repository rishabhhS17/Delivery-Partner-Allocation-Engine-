import { memo, useCallback } from 'react';
import { Bike } from 'lucide-react';
import styles from './RiderMarker.module.css';

const MAX_NAME = 16;

const STATUS_LABELS = {
  available:  'Available',
  assigned:   'Assigned',
  delivering: 'Delivering',
  offline:    'Offline',
};

function effectiveStatus(rider) {
  if (rider.availabilityStatus === 'OFFLINE') return 'offline';
  if (rider.status === 'PICKED_UP')           return 'delivering';
  if (rider.status === 'ACCEPTED')            return 'assigned';
  return 'available';
}

function shortId(id) {
  return (id?.toString() ?? '').slice(-4).toUpperCase() || '—';
}

const RiderMarker = memo(function RiderMarker({ rider, onClick }) {
  const status   = effectiveStatus(rider);
  const isActive = status === 'assigned' || status === 'delivering';
  const name     = rider.name ?? 'Rider';
  const display  = name.length > MAX_NAME ? name.slice(0, MAX_NAME) + '…' : name;

  const handleClick = useCallback(() => onClick?.(rider), [onClick, rider]);
  const handleKey   = useCallback(
    (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(rider); } },
    [onClick, rider],
  );

  return (
    <div
      className={`${styles.root} ${isActive ? styles.isActive : ''}`}
      data-status={status}
      onClick={handleClick}
      onKeyDown={handleKey}
      role="button"
      tabIndex={0}
    >
      <div className={styles.label}>
        <span className={styles.name} title={name.length > MAX_NAME ? name : undefined}>
          {display}
        </span>
        <div className={styles.meta}>
          <span className={styles.rid}>R-{shortId(rider._id)}</span>
          <span className={styles.dot} />
          <span className={styles.statusText}>{STATUS_LABELS[status]}</span>
        </div>
      </div>

      {isActive && <div className={styles.pulseRing} />}

      <div className={styles.pin}>
        <Bike size={15} strokeWidth={2.5} />
      </div>
    </div>
  );
});

export default RiderMarker;
