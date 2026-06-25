import { useEffect, useState } from 'react';
import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import { getRiders } from '../api/endpoints';
import styles from './Riders.module.css';

export default function Riders() {
  const [riders, setRiders] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error

  useEffect(() => {
    getRiders()
      .then((res) => {
        setRiders(res.data ?? []);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  return (
    <Box>
      <PageHeader
        eyebrow="Ops — Riders"
        title="Riders"
        description="Delivery partners, their live status, and current assignment."
      />

      <TableContainer component={Paper} elevation={0}>
        <Table>
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
            {status !== 'ready' || riders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className={styles.emptyCell}>
                  <EmptyState
                    title={status === 'error' ? 'Could not load riders' : 'No riders yet'}
                    description={
                      status === 'error'
                        ? 'The backend isn’t reachable yet — this will resolve once it’s live.'
                        : 'Seeded riders will appear here once the backend is running.'
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              riders.map((r) => (
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
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
