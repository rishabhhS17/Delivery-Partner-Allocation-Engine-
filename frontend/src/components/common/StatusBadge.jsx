import { Box, Typography } from '@mui/material';
import { CircleOff, Circle, Navigation, Package, Clock, CheckCircle2, XCircle } from 'lucide-react';
import styles from './StatusBadge.module.css';

// Colors come only from the design token palette (link/warning/violet/success/error/faint).
const STATUS_MAP = {
  rider: {
    OFFLINE: { color: 'faint', label: 'Offline', icon: CircleOff },
    IDLE: { color: 'link', label: 'Idle', icon: Circle },
    ACCEPTED: { color: 'warning', label: 'Accepted', icon: Navigation },
    PICKED_UP: { color: 'violet', label: 'Picked up', icon: Package },
  },
  order: {
    PENDING: { color: 'faint', label: 'Pending', icon: Clock },
    ASSIGNED: { color: 'warning', label: 'Assigned', icon: Navigation },
    PICKED_UP: { color: 'violet', label: 'Picked up', icon: Package },
    DELIVERED: { color: 'success', label: 'Delivered', icon: CheckCircle2 },
    CANCELLED: { color: 'error', label: 'Cancelled', icon: XCircle },
  },
};

const CANCEL_REASON_LABELS = {
  no_rider:     'no rider',
  engine_error: 'engine error',
  restaurant_rejected: 'restaurant rejected',
};

export default function StatusBadge({ kind, status, cancelReason }) {
  const entry = STATUS_MAP[kind]?.[status];
  const color = entry?.color ?? 'faint';
  const reason = status === 'CANCELLED' ? CANCEL_REASON_LABELS[cancelReason] : null;
  const label = `${entry?.label ?? status ?? 'Unknown'}${reason ? ` · ${reason}` : ''}`;
  const Icon = entry?.icon;

  return (
    <Box className={styles.badge} data-color={color}>
      {Icon ? <Icon size={12} className={styles.icon} /> : <span className={styles.dot} />}
      <Typography component="span" className={styles.label}>{label}</Typography>
    </Box>
  );
}
