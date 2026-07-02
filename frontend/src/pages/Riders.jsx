import { useEffect, useState } from 'react';
import {
  Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Typography,
} from '@mui/material';
import { RefreshCw, Plus } from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import LocationPicker from '../components/common/LocationPicker';
import { NoRidersIllustration } from '../components/common/illustrations';
import { SkeletonRows } from '../components/common/Skeleton';
import Spinner from '../components/common/Spinner';
import { useToast } from '../context/ToastContext';
import { validateLocationForm } from '../utils/formValidation';
import { getRiders, createRider } from '../api/endpoints';
import styles from './Riders.module.css';

const EMPTY_FORM = { name: '', phone: '', latitude: '', longitude: '', rating: '' };
const COLUMNS = 7;

export default function Riders() {
  const [riders, setRiders] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const toast = useToast();

  const errors = validateLocationForm(form);
  const showError = (field) => (attemptedSubmit || form[field] !== '') && errors[field];

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

  const handleCreate = async () => {
    setAttemptedSubmit(true);
    if (Object.keys(errors).length > 0) return;

    setCreating(true);
    try {
      await createRider({
        name: form.name,
        phone: form.phone || undefined,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        rating: form.rating === '' ? undefined : Number(form.rating),
      });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setAttemptedSubmit(false);
      fetchRiders();
      toast.success(`${form.name || 'Rider'} added`);
    } catch {
      toast.error('Could not add rider');
    } finally {
      setCreating(false);
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setForm(EMPTY_FORM);
    setAttemptedSubmit(false);
  };

  return (
    <Box>
      <PageHeader
        title="Riders"
        description="Delivery partners, their live status, and current assignment."
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setDialogOpen(true)}>
            Add rider
          </Button>
        }
      />

      <TableContainer component={Paper} elevation={0} sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 720 }}>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Rating</TableCell>
              <TableCell>Availability</TableCell>
              <TableCell>Movement</TableCell>
              <TableCell>Current order</TableCell>
              <TableCell align="right">Total orders</TableCell>
              <TableCell align="right">Orders (1h)</TableCell>
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
                    description="Add a rider, or wait for the simulation to seed some."
                    action={
                      <Button size="small" variant="contained" startIcon={<Plus size={14} />} onClick={() => setDialogOpen(true)}>
                        Add rider
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}

            {status === 'ready' && riders.map((r) => (
              <TableRow key={r._id}>
                <TableCell>{r.name}</TableCell>
                <TableCell className={styles.rating}>{r.rating}</TableCell>
                <TableCell>
                  <span className={styles.availabilityBadge} data-online={String(r.availabilityStatus === 'ONLINE')}>
                    {r.availabilityStatus === 'ONLINE' ? 'Online' : 'Offline'}
                  </span>
                </TableCell>
                <TableCell><StatusBadge kind="rider" status={r.status} /></TableCell>
                <TableCell className={styles.rating}>
                  {r.currentOrderSummary
                    ? `${r.currentOrderSummary.restaurantName} → ${r.currentOrderSummary.customerName}`
                    : '—'}
                </TableCell>
                <TableCell align="right">{r.totalOrders ?? 0}</TableCell>
                <TableCell align="right">{r.ordersLastHour ?? 0}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={closeDialog}>
        <DialogTitle>Add rider</DialogTitle>
        <DialogContent className={styles.dialogForm}>
          <Box>
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} size="small" fullWidth error={!!showError('name')} />
            {showError('name') && <Typography className={styles.fieldError}>{errors.name}</Typography>}
          </Box>
          <Box>
            <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} size="small" fullWidth error={!!showError('phone')} />
            {showError('phone') && <Typography className={styles.fieldError}>{errors.phone}</Typography>}
          </Box>
          <Box>
            <TextField label="Rating (optional, 1-5)" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} size="small" fullWidth error={!!showError('rating')} />
            {showError('rating') && <Typography className={styles.fieldError}>{errors.rating}</Typography>}
          </Box>
          <LocationPicker
            latitude={form.latitude}
            longitude={form.longitude}
            onChange={(latitude, longitude) => setForm({ ...form, latitude, longitude })}
          />
          {attemptedSubmit && (errors.latitude || errors.longitude) && (
            <Typography className={styles.fieldError}>{errors.latitude || errors.longitude}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={creating}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={creating || Object.keys(errors).length > 0}>
            {creating ? <Spinner size="sm" /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
