import { Card, Box, Typography } from '@mui/material';
import styles from './MapPanel.module.css';

export default function MapPanel({ eyebrow, legend, children, variant = 'full' }) {
  return (
    <Card elevation={0} className={styles.panel}>
      <Box className={styles.headerBar}>
        {eyebrow && <Typography className={styles.eyebrow}>{eyebrow}</Typography>}
        {legend && (
          <Box className={styles.legend}>
            {legend.map((item) => (
              <Box key={item.label} className={styles.legendItem}>
                <span className={styles.legendDot} data-color={item.color} />
                <Typography className={styles.legendLabel}>{item.label}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
      <Box className={styles.content} data-variant={variant}>
        {children}
      </Box>
    </Card>
  );
}
