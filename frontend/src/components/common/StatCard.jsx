import { Card, Typography } from '@mui/material';
import { Skeleton } from './Skeleton';
import CountUp from './CountUp';
import styles from './StatCard.module.css';

export default function StatCard({ label, value }) {
  return (
    <Card elevation={0} className={styles.card}>
      <Typography className={styles.label}>{label}</Typography>
      {value === undefined ? (
        <Skeleton className={styles.valueSkeleton} />
      ) : (
        <Typography className={styles.value}>
          {typeof value === 'number' ? <CountUp value={value} /> : value ?? '—'}
        </Typography>
      )}
    </Card>
  );
}
