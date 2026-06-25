import { Box, Typography, Card, CardContent, Alert } from '@mui/material';
import PageHeader from '../components/common/PageHeader';
import styles from './Settings.module.css';

const ALLOCATION_WEIGHTS = [
  { label: 'Distance Weight', value: '40%' },
  { label: 'Rating Weight', value: '30%' },
  { label: 'Current Load Weight', value: '20%' },
  { label: 'Availability Weight', value: '10%' },
];

export default function Settings() {
  return (
    <Box>
      <PageHeader
        eyebrow="Ops — Config"
        title="Settings"
        description="System configuration and allocation parameters."
      />

      <Alert severity="info" className={styles.alert}>
        Allocation weights are fixed for the POC. Dynamic configuration of these settings is currently out of scope.
      </Alert>

      <Typography variant="h6" className={styles.sectionTitle}>Allocation Weights</Typography>

      <div className={styles.weightGrid}>
        {ALLOCATION_WEIGHTS.map((weight) => (
          <Card elevation={0} key={weight.label}>
            <CardContent>
              <Typography variant="body2" className={styles.weightLabel}>
                {weight.label}
              </Typography>
              <Typography variant="h4" className={styles.weightValue}>
                {weight.value}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </div>
    </Box>
  );
}
