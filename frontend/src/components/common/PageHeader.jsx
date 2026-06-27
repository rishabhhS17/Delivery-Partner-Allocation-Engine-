import { Box, Typography } from '@mui/material';
import styles from './PageHeader.module.css';

export default function PageHeader({ title, description, action }) {
  return (
    <Box className={styles.header}>
      <Box className={styles.titleBlock}>
        <Typography variant="h2" className={styles.title}>{title}</Typography>
        {description && (
          <Typography variant="body1" className={styles.description}>{description}</Typography>
        )}
      </Box>
      {action && <Box className={styles.action}>{action}</Box>}
    </Box>
  );
}
