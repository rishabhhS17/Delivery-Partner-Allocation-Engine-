import { Box, Typography } from '@mui/material';
import styles from './StatusBadge.module.css';

// Colors come only from DESIGN-vercel.md's own palette (link/warning/violet/error/faint) —
// see imperative-forging-squirrel.md "Rider/order status colors" for the source mapping.
const STATUS_MAP = {
  rider: {
    OFFLINE: { color: 'faint', label: 'Offline' },
    IDLE: { color: 'link', label: 'Idle' },
    ACCEPTED: { color: 'warning', label: 'Accepted' },
    PICKED_UP: { color: 'violet', label: 'Picked up' },
  },
  order: {
    PENDING: { color: 'faint', label: 'Pending' },
    ASSIGNED: { color: 'warning', label: 'Assigned' },
    PICKED_UP: { color: 'violet', label: 'Picked up' },
    DELIVERED: { color: 'link', label: 'Delivered' },
    CANCELLED: { color: 'error', label: 'Cancelled' },
  },
};

export default function StatusBadge({ kind, status }) {
  const entry = STATUS_MAP[kind]?.[status];
  const color = entry?.color ?? 'faint';
  const label = entry?.label ?? status ?? 'Unknown';

  return (
    <Box className={styles.badge} data-color={color}>
      <span className={styles.dot} />
      <Typography component="span" className={styles.label}>{label}</Typography>
    </Box>
  );
}
