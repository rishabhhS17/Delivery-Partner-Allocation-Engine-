import { useEffect, useState } from 'react';
import {
  Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions, TextField, IconButton,
} from '@mui/material';
import { Trash2, RefreshCw, Plus } from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import EmptyState from '../components/common/EmptyState';
import { NoRestaurantsIllustration } from '../components/common/illustrations';
import { SkeletonRows } from '../components/common/Skeleton';
import Spinner from '../components/common/Spinner';
import { useToast } from '../context/ToastContext';
import { getRestaurants, createRestaurant, deleteRestaurant } from '../api/endpoints';
import styles from './Restaurants.module.css';

const EMPTY_FORM = { name: '', phone: '', latitude: '', longitude: '' };
const COLUMNS = 6;

export default function Restaurants() {
  const [restaurants, setRestaurants] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const fetchRestaurants = () => {
    setStatus('loading');
    getRestaurants()
      .then((res) => {
        setRestaurants(res.data ?? []);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(fetchRestaurants, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await createRestaurant({
        ...form,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      fetchRestaurants();
      toast.success(`${form.name || 'Restaurant'} added`);
    } catch {
      toast.error('Could not add restaurant');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id, name) => {
    try {
      await deleteRestaurant(id);
      fetchRestaurants();
      toast.success(`${name || 'Restaurant'} removed`);
    } catch {
      toast.error('Could not remove restaurant');
    }
  };

  return (
    <Box>
      <PageHeader
        title="Restaurants"
        description="Pickup points the allocation engine generates orders from."
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setDialogOpen(true)}>
            Add restaurant
          </Button>
        }
      />

      <TableContainer component={Paper} elevation={0}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Latitude</TableCell>
              <TableCell>Longitude</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {status === 'loading' && <SkeletonRows columns={COLUMNS} />}

            {status === 'error' && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className={styles.emptyCell}>
                  <EmptyState
                    title="Could not load restaurants"
                    description="The backend isn’t reachable yet — this will resolve once it’s live."
                    action={
                      <Button size="small" variant="outlined" startIcon={<RefreshCw size={14} />} onClick={fetchRestaurants}>
                        Retry
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}

            {status === 'ready' && restaurants.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className={styles.emptyCell}>
                  <EmptyState
                    illustration={NoRestaurantsIllustration}
                    title="No restaurants yet"
                    description="Restaurants you add will appear here."
                    action={
                      <Button size="small" variant="contained" startIcon={<Plus size={14} />} onClick={() => setDialogOpen(true)}>
                        Add restaurant
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}

            {status === 'ready' && restaurants.map((r) => (
              <TableRow key={r._id}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.phone}</TableCell>
                <TableCell>{r.latitude}</TableCell>
                <TableCell>{r.longitude}</TableCell>
                <TableCell>
                  <span className={styles.activeBadge} data-active={String(r.isActive)}>
                    {r.isActive ? 'Active' : 'Inactive'}
                  </span>
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="error" onClick={() => handleDelete(r._id, r.name)} aria-label="Remove restaurant">
                    <Trash2 size={16} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle>Add restaurant</DialogTitle>
        <DialogContent className={styles.dialogForm}>
          <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} size="small" fullWidth />
          <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} size="small" fullWidth />
          <TextField label="Latitude" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} size="small" fullWidth />
          <TextField label="Longitude" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} size="small" fullWidth />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={creating}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={creating}>
            {creating ? <Spinner size="sm" /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
