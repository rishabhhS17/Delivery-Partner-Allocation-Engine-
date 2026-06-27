import { TableRow, TableCell } from '@mui/material';
import styles from './Skeleton.module.css';

export function Skeleton({ shape = 'line', className = '' }) {
  return <span className={`${styles.shimmer} ${styles[shape]} ${className}`} />;
}

export function SkeletonRow({ columns }) {
  return (
    <TableRow>
      {Array.from({ length: columns }).map((_, i) => (
        <TableCell key={i}>
          <Skeleton />
        </TableCell>
      ))}
    </TableRow>
  );
}

export function SkeletonRows({ columns, rows = 5 }) {
  return Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} columns={columns} />);
}
