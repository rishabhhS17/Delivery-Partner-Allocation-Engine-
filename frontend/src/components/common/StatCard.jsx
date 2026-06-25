import { Card, Typography } from '@mui/material';
import styles from './StatCard.module.css';

export default function StatCard({ label, value }) {
  return (
    <Card elevation={0} className={styles.card}>
      <Typography className={styles.label}>{label}</Typography>
      <Typography className={styles.value}>{value ?? '—'}</Typography>
    </Card>
  );
}
