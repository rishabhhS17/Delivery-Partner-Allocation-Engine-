import { Box, Typography } from '@mui/material';
import styles from './EmptyState.module.css';

export default function EmptyState({ title, description }) {
  return (
    <Box className={styles.wrap}>
      <Typography className={styles.title}>{title}</Typography>
      {description && <Typography className={styles.description}>{description}</Typography>}
    </Box>
  );
}
