import { useEffect, useState } from 'react';
import {
  Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions, TextField, IconButton,
} from '@mui/material';
import PageHeader from '../components/common/PageHeader';
import EmptyState from '../components/common/EmptyState';
import { getRestaurants, createRestaurant, deleteRestaurant } from '../api/endpoints';
import styles from './Restaurants.module.css';

const EMPTY_FORM = { name: '', phone: '', latitude: '', longitude: '' };

export default function Restaurants() {
  const [restaurants, setRestaurants] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

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
    await createRestaurant({
      ...form,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
    });
    setDialogOpen(false);
    setForm(EMPTY_FORM);
    fetchRestaurants();
  };

  const handleDelete = async (id) => {
    await deleteRestaurant(id);
    fetchRestaurants();
  };

  return (
    <Box>
      <PageHeader
        eyebrow="Ops — Restaurants"
        title="Restaurants"
        description="Pickup points the allocation engine generates orders from."
        action={
          <Button variant="contained" onClick={() => setDialogOpen(true)}>
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
            {status !== 'ready' || restaurants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className={styles.emptyCell}>
                  <EmptyState
                    title={status === 'error' ? 'Could not load restaurants' : 'No restaurants yet'}
                    description={
                      status === 'error'
                        ? 'The backend isn’t reachable yet — this will resolve once it’s live.'
                        : 'Restaurants you add will appear here.'
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              restaurants.map((r) => (
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
                    <IconButton size="small" onClick={() => handleDelete(r._id)} aria-label="Remove restaurant">
                      ✕
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
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
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
