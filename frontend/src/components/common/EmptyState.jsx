import { Box, Typography } from '@mui/material';
import Logo from './Logo';
import styles from './EmptyState.module.css';

export default function EmptyState({ title, description, icon: Icon, illustration: Illustration, action }) {
  return (
    <Box className={styles.wrap}>
      {Illustration ? (
        <Illustration />
      ) : Icon ? (
        <span className={styles.iconWrap}>
          <Icon size={22} />
        </span>
      ) : (
        <Logo variant="mark" size="md" animated={false} className={styles.fallbackMark} />
      )}
      <Typography className={styles.title}>{title}</Typography>
      {description && <Typography className={styles.description}>{description}</Typography>}
      {action && <Box className={styles.action}>{action}</Box>}
    </Box>
  );
}
