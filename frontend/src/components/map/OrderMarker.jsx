import { memo, useCallback } from 'react';
import { Package } from 'lucide-react';
import styles from './OrderMarker.module.css';

const STATUS_LABELS = {
  pending:   'Pending',
  assigned:  'Assigned',
  pickedup:  'Picked Up',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

function normalizeStatus(status) {
  return (status ?? 'pending').toLowerCase().replace(/_/g, '');
}

function shortId(id) {
  return (id?.toString() ?? '').slice(-6).toUpperCase() || '??????';
}

const OrderMarker = memo(function OrderMarker({ order, onClick }) {
  const status  = normalizeStatus(order?.status);
  const orderId = `#${shortId(order?._id)}`;

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
        <span className={styles.orderId}>{orderId}</span>
        <div className={styles.statusRow}>
          <span className={styles.dot} />
          <span className={styles.statusText}>{STATUS_LABELS[status] ?? order?.status}</span>
        </div>
      </div>

      <div className={styles.pin}>
        <Package size={12} strokeWidth={2.5} />
      </div>
    </div>
  );
});

export default OrderMarker;
