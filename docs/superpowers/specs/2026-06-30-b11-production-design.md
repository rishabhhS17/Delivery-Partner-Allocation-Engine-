# Design Spec: B11 Production Pass — Auth + Integration Bugs + Analytics

**Date:** 2026-06-30  
**Approach:** Targeted (Approach B) — Auth + B11 + Integration Bugs  
**Scope:** Everything needed to make the backend and frontend work smoothly through B11. No security hardening (rate limiting, helmet, CORS locking) — deferred to a future pass.

---

## Goals

1. Wire real JWT auth so every protected route rejects unauthenticated requests
2. Fix the 5 integration bugs that silently break the delivery loop
3. Complete B11 analytics (extended aggregates for Dashboard)
4. Remove frontend mock data fallbacks so real errors surface
5. Normalize coordinate field names so map pages use the right fields

---

## What Is Already Done (Not Changing)

- `orderController.js` already calls `addPendingOrder` after creating orders — H14 is fixed
- `auth.js` already has working `POST /auth/login` + `GET /auth/me` with real bcrypt + JWT
- `hydrate()` in simulationEngine already picks up PENDING orders on restart — no pre-launch queue needed
- Simulation engine (B8), WebSocket (B9), allocation engine (B6), order generator (B7) all complete

---

## Section 1 — Backend: Auth Middleware + Env Fail-Fast

### `backend/src/middleware/authMiddleware.js`

Replace the no-op stub with real JWT verification:

```js
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

export const protect = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'No token' });
  try {
    req.user = jwt.verify(header.slice(7), config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};
```

### `backend/src/routes/index.js`

Mount `protect` on all routes **except** `/health` and `/auth/*`. Analytics stays public so the Dashboard can poll without auth:

```js
router.use('/riders',             protect, riderRoutes);
router.use('/restaurants',        protect, restaurantRoutes);
router.use('/customers',          protect, customerRoutes);
router.use('/orders',             protect, orderRoutes);
router.use('/allocation',         protect, allocationRoutes);
router.use('/config',             protect, configRoutes);
router.use('/simulation',         protect, simulationRoutes);
// /health and /auth are NOT protected
// /analytics is NOT protected (Dashboard polls it)
```

### `backend/src/config/env.js`

Add fail-fast at module load time. Remove `|| 'admin123'` default:

```js
if (!process.env.MONGODB_URI) throw new Error('[env] Missing MONGODB_URI — server cannot start');
if (!process.env.JWT_SECRET)  throw new Error('[env] Missing JWT_SECRET — server cannot start');

export const config = {
  port:        process.env.PORT || 5000,
  mongoUri:    process.env.MONGODB_URI,
  jwtSecret:   process.env.JWT_SECRET,
  mapboxToken: process.env.MAPBOX_TOKEN,
};
```

**Done when:** calling any protected route without a Bearer token returns 401. Missing env vars crash the server with a clear message at boot.

---

## Section 2 — Backend: Simulation Loop Fixes

### C1/C2 — Manual-allocate IDLE path doesn't sync in-memory state

**Problem:** `allocation.js` IDLE path writes to the DB but never updates `riderState` or `h3Buckets`. The next sim tick still sees the rider as IDLE and re-assigns them.

**Fix — `backend/src/services/simulationEngine.js`:**

Export a new function `syncManualAllocation`:

```js
export function syncManualAllocation(riderId, orderId) {
  const id = riderId.toString();
  const rider = riderState.get(id);
  if (!rider) return; // sim not running — DB write already happened, nothing to sync
  _removeFromH3(id, rider.h3Index);
  rider.status = 'ACCEPTED';
  rider.currentOrderId = orderId;
  pendingQueue.delete(orderId.toString());
}
```

**Fix — `backend/src/routes/allocation.js`:**

Import `syncManualAllocation` and call it after the IDLE path `Promise.all` resolves:

```js
import { queueNextOrder, syncManualAllocation } from '../services/simulationEngine.js';

// in the IDLE path, after await Promise.all([...]):
syncManualAllocation(winner._id, order._id);
```

The BUSY path already calls `queueNextOrder` which handles its own sync — no change needed there.

### H3 — Auto-order job never fires

**Problem:** `startAutoOrderJob` / `stopAutoOrderJob` are defined in `orderGenerator.js` but never called anywhere. Auto-orders are advertised but silently don't run.

**Fix — `backend/src/services/simulationEngine.js`:**

```js
import { startAutoOrderJob, stopAutoOrderJob } from './orderGenerator.js';

export async function startSimulation() {
  if (running) return;
  await hydrate();
  running   = true;
  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  startAutoOrderJob();   // ← add this
  if (ioRef) ioRef.emit('simulation:status', { running: true });
}

export async function stopSimulation() {
  if (!running) return;
  clearInterval(tickTimer);
  stopAutoOrderJob();    // ← add this
  // ... rest unchanged
}
```

**Done when:** with the sim running, an order appears automatically every `AUTO_ORDER_INTERVAL_MS` (default 10 min) without any manual API call.

---

## Section 3 — Backend: B11 Analytics + C6 `acceptOrder`

### `backend/src/routes/index.js` — extend `/analytics`

Add three extra aggregations alongside the existing four counters:

```js
// New: avgPickupTime_s, avgDeliveryTime_s, throughput, riderFairness
const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000);

const [timingAgg, throughput, riderFairness] = await Promise.all([
  Order.aggregate([
    { $match: { status: 'DELIVERED', pickedUpAt: { $exists: true }, deliveredAt: { $exists: true } } },
    { $project: {
        pickupTime:   { $subtract: ['$pickedUpAt',   '$assignedAt']  },
        deliveryTime: { $subtract: ['$deliveredAt',  '$pickedUpAt']  },
    }},
    { $group: {
        _id:               null,
        avgPickupTime_ms:  { $avg: '$pickupTime'   },
        avgDeliveryTime_ms:{ $avg: '$deliveryTime' },
    }},
  ]),
  Order.countDocuments({ status: 'DELIVERED', deliveredAt: { $gte: sixtyMinAgo } }),
  Order.aggregate([
    { $match: { status: 'DELIVERED', deliveredAt: { $gte: sixtyMinAgo }, assignedRiderId: { $ne: null } } },
    { $group: { _id: '$assignedRiderId', deliveries: { $sum: 1 } } },
    { $lookup: { from: 'riders', localField: '_id', foreignField: '_id', as: 'rider' } },
    { $unwind: { path: '$rider', preserveNullAndEmpty: true } },
    { $project: { riderId: '$_id', name: { $ifNull: ['$rider.name', 'Unknown'] }, deliveries: 1, _id: 0 } },
    { $sort: { deliveries: -1 } },
  ]),
]);

const timing = timingAgg[0] ?? {};
res.json({
  totalRiders,
  availableRiders,
  activeOrders,
  completedOrders,
  avgPickupTime_s:    timing.avgPickupTime_ms   ? timing.avgPickupTime_ms   / 1000 : null,
  avgDeliveryTime_s:  timing.avgDeliveryTime_ms ? timing.avgDeliveryTime_ms / 1000 : null,
  throughput,
  riderFairness,
});
```

### `backend/src/routes/orders.js` — add `PUT /:id/accept` (C6 fix)

```js
// PUT /orders/:id/accept — partner accepts assigned order (Phase 2 partner flow; wired now)
router.put('/:id/accept', async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'ASSIGNED')
      return res.status(409).json({ success: false, message: `Order is ${order.status}, not ASSIGNED` });
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
});
```

**Done when:** `GET /analytics` returns all 8 fields. `PUT /orders/:id/accept` returns 200 for ASSIGNED orders and 409 otherwise.

---

## Section 4 — Frontend: Remove Mock Fallbacks (C5)

**File:** `frontend/src/api/endpoints.js`

Remove all `catch (error) { if (import.meta.env.DEV) { return { data: MOCK_* } } }` blocks and delete all `MOCK_*` constants. Every export becomes a direct API call:

```js
export const getRiders      = () => api.get('/riders').then(r => ({ data: r.data?.data ?? r.data }));
export const getRestaurants = () => api.get('/restaurants').then(r => ({ data: r.data?.data ?? r.data }));
export const getCustomers   = () => api.get('/customers').then(r => ({ data: r.data?.data ?? r.data }));
export const getOrders      = (params) => api.get('/orders', { params }).then(r => ({ data: r.data?.data ?? r.data }));
export const getOrder       = (id) => api.get(`/orders/${id}`);
export const getRider       = (id) => api.get(`/riders/${id}`);
export const createRestaurant = (body) => api.post('/restaurants', body);
export const deleteRestaurant = (id)   => api.delete(`/restaurants/${id}`);
export const createCustomer   = (body) => api.post('/customers', body);
export const deleteCustomer   = (id)   => api.delete(`/customers/${id}`);
export const createOrder      = ()     => api.post('/orders');
export const bulkOrders       = (count)=> api.post('/orders/bulk', { count });
export const getWeights       = ()     => api.get('/config/weights');
export const setWeights       = (body) => api.put('/config/weights', body);
export const getAllocationHistory = (params) => api.get('/allocation/history', { params });
export const getAnalytics     = ()     => api.get('/analytics');
export const startSimulation  = ()     => api.post('/simulation/start');
export const stopSimulation   = ()     => api.post('/simulation/stop');
export const getSimulationStatus = ()  => api.get('/simulation/status');
export const allocateOrder    = (orderId) => api.post('/allocation/allocate', { orderId });
export const acceptOrder      = (id)   => api.put(`/orders/${id}/accept`);
export const updateLocation   = (id, body) => api.put(`/riders/${id}/location`, body);
export const updateStatus     = (id, body) => api.put(`/riders/${id}/status`, body);
```

Auth functions (`login`, `getMe`) keep their current shape — they already don't have mock fallbacks beyond the mock-token check in `getMe`, which is also removed.

**Done when:** opening the browser with the backend down shows real network errors, not fake data.

---

## Section 5 — Frontend: Coordinate Field Normalization (H12)

### The rule

| Data source | Field names | Used by |
|---|---|---|
| Socket `simulation:tick` | `r.lat`, `r.lng` | RiderMap, OrderMap, OrdersMap, Dashboard |
| REST API (`/riders`, `/riders/:id`) | `r.latitude`, `r.longitude` | Riders page, rider detail |

The backend broadcasts `lat`/`lng` in `tickRiders` (simulationEngine.js line 382–383). REST returns Mongoose documents with `latitude`/`longitude`.

### Files to fix

| File | Line | Bug | Fix |
|---|---|---|---|
| `Dashboard.jsx` | 77 | Reads `r.lng/r.lat` — correct for socket shape | Verify and keep |
| `OrderMap.jsx` | 160 | Reads `r.lng/r.lat` — correct for socket shape | Verify and keep |
| `OrdersMap.jsx` | 180, 213 | Inconsistently mixes both forms | Standardize to `r.lat`/`r.lng` for socket data |
| `RiderMap.jsx` | 181, 198 | Inconsistently mixes both forms | Standardize to `r.lat`/`r.lng` for socket data |

**Done when:** riders appear at correct positions on the map when the simulation is running.

---

## File Change Summary

| File | Change |
|---|---|
| `backend/src/middleware/authMiddleware.js` | Replace no-op with real JWT verify |
| `backend/src/config/env.js` | Fail-fast + remove `admin123` default |
| `backend/src/routes/index.js` | Mount `protect` on all routes except `/health`, `/auth`, `/analytics`; extend analytics handler |
| `backend/src/services/simulationEngine.js` | Export `syncManualAllocation`; call `startAutoOrderJob`/`stopAutoOrderJob` |
| `backend/src/routes/allocation.js` | Call `syncManualAllocation` after IDLE path DB writes |
| `backend/src/routes/orders.js` | Add `PUT /:id/accept` |
| `frontend/src/api/endpoints.js` | Remove all mock fallbacks and MOCK_* constants |
| `frontend/src/pages/RiderMap.jsx` | Standardize to `r.lat`/`r.lng` from socket |
| `frontend/src/pages/OrdersMap.jsx` | Standardize to `r.lat`/`r.lng` from socket |

---

## Build Order

1. `env.js` fail-fast (no risk, instant feedback if env is missing)
2. `authMiddleware.js` real JWT verify
3. `routes/index.js` protect mounting + analytics extension
4. `simulationEngine.js` — export `syncManualAllocation`, wire auto-order job
5. `allocation.js` — call `syncManualAllocation`
6. `orders.js` — add `PUT /:id/accept`
7. `endpoints.js` — remove mock fallbacks
8. Frontend coordinate fixes — `RiderMap.jsx`, `OrdersMap.jsx`

---

## Done-When Gate (Full B11)

- [ ] Any protected route without a Bearer token returns 401
- [ ] Missing `MONGODB_URI` or `JWT_SECRET` crashes server at boot with a clear message
- [ ] Manual `/allocation/allocate` for an IDLE rider cannot double-assign on the next tick
- [ ] Auto-orders fire every 10 min while simulation is running
- [ ] `GET /analytics` returns all 8 fields including `avgPickupTime_s`, `throughput`, `riderFairness`
- [ ] `PUT /orders/:id/accept` returns 200 for ASSIGNED orders
- [ ] Opening the app with the backend down shows real network errors (no mock data)
- [ ] Riders move to correct positions on RiderMap and OrdersMap
