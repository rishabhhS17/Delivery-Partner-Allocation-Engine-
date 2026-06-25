import { useEffect, useState } from 'react';
import {
  Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions, TextField, IconButton,
} from '@mui/material';
import PageHeader from '../components/common/PageHeader';
import EmptyState from '../components/common/EmptyState';
import { getCustomers, createCustomer, deleteCustomer } from '../api/endpoints';
import styles from './Customers.module.css';

const EMPTY_FORM = { name: '', phone: '', address: '', latitude: '', longitude: '' };

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchCustomers = () => {
    setStatus('loading');
    getCustomers()
      .then((res) => {
        setCustomers(res.data ?? []);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(fetchCustomers, []);

  const handleCreate = async () => {
    await createCustomer({
      ...form,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
    });
    setDialogOpen(false);
    setForm(EMPTY_FORM);
    fetchCustomers();
  };

  const handleDelete = async (id) => {
    await deleteCustomer(id);
    fetchCustomers();
  };

  return (
    <Box>
      <PageHeader
        eyebrow="Ops — Customers"
        title="Customers"
        description="Drop-off points the allocation engine pairs with nearby restaurants."
        action={
          <Button variant="contained" onClick={() => setDialogOpen(true)}>
            Add customer
          </Button>
        }
      />

      <TableContainer component={Paper} elevation={0}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Address</TableCell>
              <TableCell>Latitude</TableCell>
              <TableCell>Longitude</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {status !== 'ready' || customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className={styles.emptyCell}>
                  <EmptyState
                    title={status === 'error' ? 'Could not load customers' : 'No customers yet'}
                    description={
                      status === 'error'
                        ? 'The backend isn’t reachable yet — this will resolve once it’s live.'
                        : 'Customers you add will appear here.'
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              customers.map((c) => (
                <TableRow key={c._id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.phone}</TableCell>
                  <TableCell>{c.address}</TableCell>
                  <TableCell>{c.latitude}</TableCell>
                  <TableCell>{c.longitude}</TableCell>
                  <TableCell>
                    <span className={styles.activeBadge} data-active={String(c.isActive)}>
                      {c.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleDelete(c._id)} aria-label="Remove customer">
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
        <DialogTitle>Add customer</DialogTitle>
        <DialogContent className={styles.dialogForm}>
          <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} size="small" fullWidth />
          <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} size="small" fullWidth />
          <TextField label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} size="small" fullWidth />
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
