import { useEffect, useState } from 'react';
import {
  Box, Alert, Button, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { History, RefreshCw, Star } from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import EmptyState from '../components/common/EmptyState';
import { SkeletonRows } from '../components/common/Skeleton';
import { getAllocationHistory } from '../api/endpoints';
import { useSimulation } from '../context/SimulationContext';
import styles from './AllocationHistory.module.css';

const COLUMNS = 6;

export default function AllocationHistory() {
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const { allocations } = useSimulation();

  const fetchHistory = () => {
    setStatus('loading');
    getAllocationHistory({ limit: 50 })
      .then((res) => {
        setRecords(res.data.records ?? []);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(fetchHistory, []);

  // Prepend live simulation events that aren't already in REST records
  const restIds = new Set(records.map((r) => String(r.orderId?._id ?? r.orderId)));
  const liveRows = allocations.filter((a) => !restIds.has(String(a.orderId)));

  const isEmpty = status === 'ready' && liveRows.length === 0 && records.length === 0;

  return (
    <Box>
      <PageHeader
        title="Allocation History"
        description="Audit log of all rider assignments and scoring decisions."
      />

      <Alert severity="info" className={styles.alert}>
        Rider allocation is performed by the deterministic weighted scoring engine (ETAR + Rating + Load).
        The winner is always the highest-scoring eligible rider — no randomness, no AI in the decision loop.
      </Alert>

      <TableContainer component={Paper} elevation={0} sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 580 }}>
          <TableHead>
            <TableRow>
              <TableCell>Order</TableCell>
              <TableCell>Rider</TableCell>
              <TableCell>Score</TableCell>
              <TableCell>Breakdown</TableCell>
              <TableCell>Candidates</TableCell>
              <TableCell>Time</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {status === 'loading' && <SkeletonRows columns={COLUMNS} />}

            {status === 'error' && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className={styles.emptyCell}>
                  <EmptyState
                    title="Could not load allocation history"
                    description="The backend isn’t reachable yet — this will resolve once it’s live."
                    action={
                      <Button size="small" variant="outlined" startIcon={<RefreshCw size={14} />} onClick={fetchHistory}>
                        Retry
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}

            {isEmpty && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className={styles.emptyCell}>
                  <EmptyState
                    icon={History}
                    title="No allocations yet"
                    description="Records appear here as riders are assigned to orders."
                  />
                </TableCell>
              </TableRow>
            )}

            {status === 'ready' && liveRows.map((a) => (
              <TableRow key={`live-${a.orderId}-${a.ts}`}>
                <TableCell className={styles.idCell}>
                  …{String(a.orderId).slice(-8)}
                </TableCell>
                <TableCell className={styles.idCell}>
                  …{String(a.riderId).slice(-8)}
                </TableCell>
                <TableCell className={styles.score}>
                  {(a.score * 100).toFixed(1)}%
                </TableCell>
                <TableCell className={styles.breakdown}>
                  {a.breakdown
                    ? `E ${(a.breakdown.etarScore * 100).toFixed(0)} · R ${(a.breakdown.ratingScore * 100).toFixed(0)} · L ${(a.breakdown.loadScore * 100).toFixed(0)}`
                    : '—'}
                </TableCell>
                <TableCell>—</TableCell>
                <TableCell className={styles.timestamp}>Live</TableCell>
              </TableRow>
            ))}

            {status === 'ready' && records.map((r) => (
              <TableRow key={r._id}>
                <TableCell>
                  <Typography variant="body2" className={styles.orderPrimary}>
                    {r.orderId?.restaurantName ?? '—'}
                  </Typography>
                  <Typography variant="body2" className={styles.orderSecondary}>
                    → {r.orderId?.customerName ?? '—'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{r.riderId?.name ?? '—'}</Typography>
                  {r.riderId?.rating && (
                    <Typography variant="body2" className={styles.orderSecondary}>
                      <Star size={11} className={styles.starIcon} /> {r.riderId.rating}
                    </Typography>
                  )}
                </TableCell>
                <TableCell className={styles.score}>
                  {(r.allocationScore * 100).toFixed(1)}%
                </TableCell>
                <TableCell className={styles.breakdown}>
                  {r.breakdown
                    ? `E ${(r.breakdown.etarScore * 100).toFixed(0)} · R ${(r.breakdown.ratingScore * 100).toFixed(0)} · L ${(r.breakdown.loadScore * 100).toFixed(0)}`
                    : '—'}
                </TableCell>
                <TableCell>{r.candidatesConsidered ?? '—'}</TableCell>
                <TableCell className={styles.timestamp}>
                  {new Date(r.createdAt).toLocaleTimeString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
