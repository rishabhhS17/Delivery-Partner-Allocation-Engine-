import { useEffect, useState } from 'react';
import { Box, Card } from '@mui/material';
import PageHeader from '../components/common/PageHeader';
import StatCard from '../components/common/StatCard';
import MapPanel from '../components/common/MapPanel';
import EmptyState from '../components/common/EmptyState';
import { getAnalytics } from '../api/endpoints';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  const [analytics, setAnalytics] = useState(null);

  useEffect(() => {
    getAnalytics()
      .then((res) => setAnalytics(res.data))
      .catch(() => setAnalytics(null));
  }, []);

  const stats = [
    { label: 'Total riders', value: analytics?.totalRiders },
    { label: 'Available riders', value: analytics?.availableRiders },
    { label: 'Active orders', value: analytics?.activeOrders },
    { label: 'Completed orders', value: analytics?.completedOrders },
  ];

  return (
    <Box>
      <PageHeader
        eyebrow="Ops — Overview"
        title="Dashboard"
        description="Real-time overview of fleet utilization and order throughput."
      />

      <Box className={styles.statGrid}>
        {stats.map((s) => <StatCard key={s.label} label={s.label} value={s.value} />)}
      </Box>

      <Box className={styles.lowerGrid}>
        <MapPanel
          eyebrow="Fleet — Live"
          legend={[
            { label: 'Idle', color: 'link' },
            { label: 'Accepted', color: 'warning' },
            { label: 'Picked up', color: 'violet' },
            { label: 'Offline', color: 'faint' },
          ]}
          variant="compact"
        >
          Map renders once the backend simulation is live.
        </MapPanel>

        <Card elevation={0} className={styles.activityCard}>
          <div className={styles.activityTitle}>Recent allocations</div>
          <EmptyState
            title="No recent allocations"
            description="Allocation events will appear here once orders start being assigned."
          />
        </Card>
      </Box>
    </Box>
  );
}
