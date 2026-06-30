import { useEffect, useState } from 'react';
import {
  Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions, TextField, IconButton,
} from '@mui/material';
import { Trash2, RefreshCw, Plus } from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import EmptyState from '../components/common/EmptyState';
import { NoCustomersIllustration } from '../components/common/illustrations';
import { SkeletonRows } from '../components/common/Skeleton';
import Spinner from '../components/common/Spinner';
import { useToast } from '../context/ToastContext';
import { getCustomers, createCustomer, deleteCustomer } from '../api/endpoints';
import styles from './Customers.module.css';

const EMPTY_FORM = { name: '', phone: '', address: '', latitude: '', longitude: '' };
const COLUMNS = 7;

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

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
    setCreating(true);
    try {
      await createCustomer({
        ...form,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      fetchCustomers();
      toast.success(`${form.name || 'Customer'} added`);
    } catch {
      toast.error('Could not add customer');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id, name) => {
    try {
      await deleteCustomer(id);
      fetchCustomers();
      toast.success(`${name || 'Customer'} removed`);
    } catch {
      toast.error('Could not remove customer');
    }
  };

  return (
    <Box>
      <PageHeader
        title="Customers"
        description="Drop-off points the allocation engine pairs with nearby restaurants."
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setDialogOpen(true)}>
            Add customer
          </Button>
        }
      />

      <TableContainer component={Paper} elevation={0} sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 580 }}>
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
            {status === 'loading' && <SkeletonRows columns={COLUMNS} />}

            {status === 'error' && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className={styles.emptyCell}>
                  <EmptyState
                    title="Could not load customers"
                    description="The backend isn’t reachable yet — this will resolve once it’s live."
                    action={
                      <Button size="small" variant="outlined" startIcon={<RefreshCw size={14} />} onClick={fetchCustomers}>
                        Retry
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}

            {status === 'ready' && customers.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className={styles.emptyCell}>
                  <EmptyState
                    illustration={NoCustomersIllustration}
                    title="No customers yet"
                    description="Customers you add will appear here."
                    action={
                      <Button size="small" variant="contained" startIcon={<Plus size={14} />} onClick={() => setDialogOpen(true)}>
                        Add customer
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}

            {status === 'ready' && customers.map((c) => (
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
                  <IconButton size="small" color="error" onClick={() => handleDelete(c._id, c.name)} aria-label="Remove customer">
                    <Trash2 size={16} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
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
          <Button onClick={() => setDialogOpen(false)} disabled={creating}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={creating}>
            {creating ? <Spinner size="sm" /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
