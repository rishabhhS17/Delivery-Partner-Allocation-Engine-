import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions, TextField, IconButton, Typography,
} from '@mui/material';
import { Trash2, RefreshCw, Plus, ShoppingBag } from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import EmptyState from '../components/common/EmptyState';
import LocationPicker from '../components/common/LocationPicker';
import { NoCustomersIllustration } from '../components/common/illustrations';
import { SkeletonRows } from '../components/common/Skeleton';
import Spinner from '../components/common/Spinner';
import { useToast } from '../context/ToastContext';
import { validateLocationForm } from '../utils/formValidation';
import { getCustomers, createCustomer, deleteCustomer } from '../api/endpoints';
import styles from './Customers.module.css';

const EMPTY_FORM = { name: '', phone: '', address: '', latitude: '', longitude: '' };
const COLUMNS = 8;

export default function Customers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const toast = useToast();

  const errors = validateLocationForm(form);
  const showError = (field) => (attemptedSubmit || form[field] !== '') && errors[field];

  const fetchCustomers = () => {
    setStatus('loading');
    getCustomers()
      .then((res) => {
        setCustomers(res.data ?? []);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(() => {
    let mounted = true;
    setStatus('loading');
    getCustomers()
      .then((res) => { if (mounted) { setCustomers(res.data ?? []); setStatus('ready'); } })
      .catch(() =>   { if (mounted) setStatus('error'); });
    return () => { mounted = false; };
  }, []);

  const handleCreate = async () => {
    setAttemptedSubmit(true);
    if (Object.keys(errors).length > 0) return;

    setCreating(true);
    try {
      await createCustomer({
        ...form,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setAttemptedSubmit(false);
      fetchCustomers();
      toast.success(`${form.name || 'Customer'} added`);
    } catch {
      toast.error('Could not add customer');
    } finally {
      setCreating(false);
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setForm(EMPTY_FORM);
    setAttemptedSubmit(false);
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

  const handlePlaceOrder = (customer) => {
    navigate('/orders', { state: { prefillCustomerId: customer._id, prefillCustomerName: customer.name } });
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
        <Table sx={{ minWidth: 640 }}>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Address</TableCell>
              <TableCell>Latitude</TableCell>
              <TableCell>Longitude</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Order</TableCell>
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
                  <IconButton size="small" onClick={() => handlePlaceOrder(c)} aria-label="Place order for this customer" disabled={!c.isActive}>
                    <ShoppingBag size={16} />
                  </IconButton>
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

      <Dialog open={dialogOpen} onClose={closeDialog}>
        <DialogTitle>Add customer</DialogTitle>
        <DialogContent className={styles.dialogForm}>
          <Box>
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} size="small" fullWidth error={!!showError('name')} />
            {showError('name') && <Typography className={styles.fieldError}>{errors.name}</Typography>}
          </Box>
          <Box>
            <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} size="small" fullWidth error={!!showError('phone')} />
            {showError('phone') && <Typography className={styles.fieldError}>{errors.phone}</Typography>}
          </Box>
          <TextField label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} size="small" fullWidth />
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
