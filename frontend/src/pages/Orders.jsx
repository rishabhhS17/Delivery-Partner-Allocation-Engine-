import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Typography,
} from '@mui/material';
import { RefreshCw, Plus, MapPin } from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import { NoOrdersIllustration } from '../components/common/illustrations';
import { SkeletonRows } from '../components/common/Skeleton';
import Spinner from '../components/common/Spinner';
import { useToast } from '../context/ToastContext';
import { getOrders, createOrder, bulkOrders, getRestaurants } from '../api/endpoints';
import styles from './Orders.module.css';

const COLUMNS = 6;

export default function Orders() {
  const navigate = useNavigate();
  const location = useLocation();
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('loading');
  // Single count-driven create control. count === 1 is the old "Create order"; count > 1 is
  // the old "Bulk create" — they were redundant (bulk-of-1 == create), so one field drives both.
  const [orderCount, setOrderCount] = useState(1);
  const [creating, setCreating] = useState(false);

  // "Place order for [customer]" flow — arrived at via a Customers.jsx row action.
  const [placeOrderOpen, setPlaceOrderOpen] = useState(false);
  const [prefillCustomer, setPrefillCustomer] = useState(null); // { id, name }
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState('');
  const [placingOrder, setPlacingOrder] = useState(false);

  const toast = useToast();

  const fetchOrders = () => {
    setStatus('loading');
    getOrders()
      .then((res) => {
        setOrders(res.data ?? []);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(() => {
    let mounted = true;
    setStatus('loading');
    getOrders()
      .then((res) => { if (mounted) { setOrders(res.data ?? []); setStatus('ready'); } })
      .catch(() =>   { if (mounted) setStatus('error'); });
    return () => { mounted = false; };
  }, []);

  // Arrived here via "Place order" on a Customers.jsx row — open the restaurant-selection
  // dialog pre-filled with that customer. Clear the router state so a page refresh/back-nav
  // doesn't re-trigger it.
  useEffect(() => {
    const { prefillCustomerId, prefillCustomerName } = location.state ?? {};
    if (!prefillCustomerId) return;

    setPrefillCustomer({ id: prefillCustomerId, name: prefillCustomerName });
    setPlaceOrderOpen(true);
    getRestaurants()
      .then((res) => setRestaurants(res.data ?? []))
      .catch(() => toast.error('Could not load restaurants'));

    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Create one or many random orders. count === 1 uses the single-order endpoint (which keeps its
  // "simulation must be running" guard); count > 1 uses the bulk endpoint. explicitCount lets the
  // empty-state button force a single order regardless of the current field value.
  const handleGenerate = async (explicitCount) => {
    const count = Math.max(1, Math.min(100, Number(explicitCount ?? orderCount) || 1));
    setCreating(true);
    try {
      if (count === 1) {
        await createOrder({}, crypto.randomUUID());
      } else {
        await bulkOrders(count, crypto.randomUUID());
      }
      fetchOrders();
      toast.success(count === 1 ? 'Order created' : `${count} orders created`);
    } catch {
      toast.error(count === 1 ? 'Could not create order' : 'Could not create orders');
    } finally {
      setCreating(false);
    }
  };

  const closePlaceOrderDialog = () => {
    setPlaceOrderOpen(false);
    setPrefillCustomer(null);
    setSelectedRestaurantId('');
  };

  const handlePlaceOrder = async () => {
    if (!prefillCustomer || !selectedRestaurantId) return;
    setPlacingOrder(true);
    try {
      await createOrder({ customerId: prefillCustomer.id, restaurantId: selectedRestaurantId }, crypto.randomUUID());
      fetchOrders();
      toast.success(`Order placed for ${prefillCustomer.name || 'customer'}`);
      closePlaceOrderDialog();
    } catch {
      toast.error('Could not place order');
    } finally {
      setPlacingOrder(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Orders"
        description="Pending, assigned, and completed delivery assignments."
        action={
          <Box className={styles.actions}>
            <TextField
              size="small"
              type="number"
              value={orderCount}
              onChange={(e) => setOrderCount(e.target.value)}
              className={styles.bulkCount}
              inputProps={{ min: 1, max: 100 }}
              aria-label="Number of orders to create"
            />
            <Button variant="contained" startIcon={creating ? <Spinner size="sm" /> : <Plus size={16} />} onClick={() => handleGenerate()} disabled={creating}>
              {Number(orderCount) > 1 ? `Create ${Number(orderCount)} orders` : 'Create order'}
            </Button>
          </Box>
        }
      />

      <TableContainer component={Paper} elevation={0} sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 620 }}>
          <TableHead>
            <TableRow>
              <TableCell>Restaurant</TableCell>
              <TableCell>Customer</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Assigned rider</TableCell>
              <TableCell>Created at</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {status === 'loading' && <SkeletonRows columns={COLUMNS} />}

            {status === 'error' && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className={styles.emptyCell}>
                  <EmptyState
                    title="Could not load orders"
                    description="The backend is not reachable yet."
                    action={
                      <Button size="small" variant="outlined" startIcon={<RefreshCw size={14} />} onClick={fetchOrders}>
                        Retry
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}

            {status === 'ready' && orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className={styles.emptyCell}>
                  <EmptyState
                    illustration={NoOrdersIllustration}
                    title="No orders yet"
                    description="Orders created here will appear once the backend is running."
                    action={
                      <Button size="small" variant="contained" startIcon={<Plus size={14} />} onClick={() => handleGenerate(1)}>
                        Create order
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}

            {status === 'ready' && orders.map((o) => (
              <TableRow key={o._id}>
                <TableCell>{o.restaurantName}</TableCell>
                <TableCell>{o.customerName}</TableCell>
                <TableCell><StatusBadge kind="order" status={o.status} /></TableCell>
                <TableCell>{o.assignedRiderId?.name ?? '—'}</TableCell>
                <TableCell>{o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}</TableCell>
                <TableCell>
                  <Button size="small" startIcon={<MapPin size={14} />} onClick={() => navigate(`/map/orders/${o._id}`)}>Map</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={placeOrderOpen} onClose={closePlaceOrderDialog}>
        <DialogTitle>Place order for {prefillCustomer?.name || 'customer'}</DialogTitle>
        <DialogContent className={styles.placeOrderForm}>
          <Typography className={styles.placeOrderHint}>
            Choose the restaurant this order should be picked up from.
          </Typography>
          <TextField
            select
            label="Restaurant"
            value={selectedRestaurantId}
            onChange={(e) => setSelectedRestaurantId(e.target.value)}
            size="small"
            fullWidth
          >
            {restaurants.map((r) => (
              <MenuItem key={r._id} value={r._id}>{r.name}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={closePlaceOrderDialog} disabled={placingOrder}>Cancel</Button>
          <Button variant="contained" onClick={handlePlaceOrder} disabled={placingOrder || !selectedRestaurantId}>
            {placingOrder ? <Spinner size="sm" /> : 'Place order'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
