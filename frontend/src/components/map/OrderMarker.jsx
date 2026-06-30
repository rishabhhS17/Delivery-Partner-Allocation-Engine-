import { memo, useCallback } from 'react';
import { Package } from 'lucide-react';
import styles from './OrderMarker.module.css';

function normalizeStatus(status) {
  return (status ?? 'pending').toLowerCase().replace(/_/g, '');
}

function shortId(id) {
  return (id?.toString() ?? '').slice(-6).toUpperCase() || '??????';
}

const OrderMarker = memo(function OrderMarker({ order, onClick, riderName }) {
  const status         = normalizeStatus(order?.status);
  const orderId        = `#${shortId(order?._id)}`;
  const restaurantName = order?.restaurantName ?? null;

  const handleClick = useCallback(() => onClick?.(order), [onClick, order]);
  const handleKey   = useCallback(
    (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(order); } },
    [onClick, order],
  );

  return (
    <div
      className={styles.root}
      data-status={status}
      data-clickable={onClick ? 'true' : 'false'}
      onClick={onClick ? handleClick : undefined}
      onKeyDown={onClick ? handleKey : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={styles.label}>
        <div className={styles.titleRow}>
          <span className={styles.orderId}>{orderId}</span>
          <span className={styles.dot} />
        </div>
        <div className={styles.infoRow}>
          <span className={styles.key}>Rider</span>
          <span className={styles.val}>{riderName ?? 'Unassigned'}</span>
        </div>
        {restaurantName && (
          <div className={styles.infoRow}>
            <span className={styles.key}>Restaurant</span>
            <span className={styles.val}>{restaurantName}</span>
          </div>
        )}
      </div>

      <div className={styles.pin}>
        <Package size={12} strokeWidth={2.5} />
      </div>
    </div>
  );
});

export default OrderMarker;
