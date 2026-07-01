import { useEffect, useState } from 'react';
import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button } from '@mui/material';
import { RefreshCw } from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import { NoRidersIllustration } from '../components/common/illustrations';
import { SkeletonRows } from '../components/common/Skeleton';
import { getRiders } from '../api/endpoints';
import styles from './Riders.module.css';

const COLUMNS = 6;

export default function Riders() {
  const [riders, setRiders] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error

  const fetchRiders = () => {
    setStatus('loading');
    getRiders()
      .then((res) => {
        setRiders(res.data ?? []);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(() => {
    let mounted = true;
    setStatus('loading');
    getRiders()
      .then((res) => { if (mounted) { setRiders(res.data ?? []); setStatus('ready'); } })
      .catch(() =>   { if (mounted) setStatus('error'); });
    return () => { mounted = false; };
  }, []);

  return (
    <Box>
      <PageHeader
        title="Riders"
        description="Delivery partners, their live status, and current assignment."
      />

      <TableContainer component={Paper} elevation={0} sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 560 }}>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Rating</TableCell>
              <TableCell>Availability</TableCell>
              <TableCell>Movement</TableCell>
              <TableCell>Current order</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {status === 'loading' && <SkeletonRows columns={COLUMNS} />}

            {status === 'error' && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className={styles.emptyCell}>
                  <EmptyState
                    title="Could not load riders"
                    description="The backend isn’t reachable yet — this will resolve once it’s live."
                    action={
                      <Button size="small" variant="outlined" startIcon={<RefreshCw size={14} />} onClick={fetchRiders}>
                        Retry
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}

            {status === 'ready' && riders.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className={styles.emptyCell}>
                  <EmptyState
                    illustration={NoRidersIllustration}
                    title="No riders yet"
                    description="Seeded riders will appear here once the backend is running."
                  />
                </TableCell>
              </TableRow>
            )}

            {status === 'ready' && riders.map((r) => (
              <TableRow key={r._id}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.phone}</TableCell>
                <TableCell className={styles.rating}>{r.rating}</TableCell>
                <TableCell>
                  <span className={styles.availabilityBadge} data-online={String(r.availabilityStatus === 'ONLINE')}>
                    {r.availabilityStatus === 'ONLINE' ? 'Online' : 'Offline'}
                  </span>
                </TableCell>
                <TableCell><StatusBadge kind="rider" status={r.status} /></TableCell>
                <TableCell className={styles.rating}>{r.currentOrderId ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
