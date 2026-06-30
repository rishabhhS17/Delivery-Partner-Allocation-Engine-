# B11 Production Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real JWT auth, fix the 5 integration bugs that break the delivery loop, and complete B11 analytics so backend and frontend work smoothly end-to-end.

**Architecture:** All changes are surgical — modify existing files, add minimal new exports. No new packages, no restructuring. Backend first (auth → simulation fixes → analytics), then frontend (remove mock fallbacks).

**Tech Stack:** Node.js + Express + Mongoose (backend), React + Vite + MUI (frontend), Socket.IO, JWT (jsonwebtoken), MongoDB aggregation pipeline.

## Global Constraints

- No new npm packages
- No inline styles in JSX — all styles stay in `.module.css` files
- Keep implementations simple and direct — no abstractions beyond what the task needs
- Backend runs on `http://localhost:5000`, frontend on `http://localhost:5173`
- `.env` must have `MONGODB_URI`, `JWT_SECRET`, `MAPBOX_TOKEN` set

---

## File Map

| File | Task | Change |
|---|---|---|
| `backend/src/config/env.js` | 1 | Fail-fast on missing MONGODB_URI / JWT_SECRET |
| `backend/src/middleware/authMiddleware.js` | 1 | Replace no-op with real JWT verify |
| `backend/src/routes/index.js` | 2 + 5 | Mount `protect` on all routes; extend analytics |
| `backend/src/services/simulationEngine.js` | 3 | Export `syncManualAllocation`; wire auto-order job |
| `backend/src/routes/allocation.js` | 4 | Call `syncManualAllocation` after IDLE path writes |
| `backend/src/routes/orders.js` | 5 | Add `PUT /:id/accept` |
| `frontend/src/api/endpoints.js` | 6 | Remove all mock fallbacks and MOCK_* constants |

> **H12 note:** Coordinate fields are already correct in all frontend map files —
> socket data uses `r.lat`/`r.lng`, REST data uses `r.latitude`/`r.longitude`.
> No changes needed there.

---

## Task 1: Env Fail-Fast + Auth Middleware

**Files:**
- Modify: `backend/src/config/env.js`
- Modify: `backend/src/middleware/authMiddleware.js`

**Interfaces:**
- Produces: `protect` middleware — `(req, res, next) => void`. Attaches `req.user = { userId, email, role }` on success, returns `401` on failure.

- [ ] **Step 1: Add fail-fast to `env.js`**

Replace the entire file:

```js
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

if (!process.env.MONGODB_URI) throw new Error('[env] Missing MONGODB_URI — server cannot start');
if (!process.env.JWT_SECRET)  throw new Error('[env] Missing JWT_SECRET — server cannot start');

export const config = {
  port:        process.env.PORT || 5000,
  mongoUri:    process.env.MONGODB_URI,
  jwtSecret:   process.env.JWT_SECRET,
  mapboxToken: process.env.MAPBOX_TOKEN,
};
```

- [ ] **Step 2: Implement real JWT verify in `authMiddleware.js`**

Replace the entire file:

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

- [ ] **Step 3: Verify fail-fast works**

Temporarily rename `MONGODB_URI` in `.env` to `MONGODB_URI_BAK`, then:

```
cd backend && node src/server.js
```

Expected: process exits immediately with `[env] Missing MONGODB_URI — server cannot start`.  
Restore `.env` after checking.

- [ ] **Step 4: Verify auth stub is replaced**

Start the server normally (`node src/server.js`), then:

```
curl -s http://localhost:5000/api/riders
```

Expected right now: `200` (protect not mounted yet — that's Task 2).  
This confirms the middleware file compiles correctly.

- [ ] **Step 5: Commit**

```
git add backend/src/config/env.js backend/src/middleware/authMiddleware.js
git commit -m "feat: real JWT auth middleware + env fail-fast"
```

---

## Task 2: Mount `protect` on Protected Routes

**Files:**
- Modify: `backend/src/routes/index.js`

**Interfaces:**
- Consumes: `protect` from `../middleware/authMiddleware.js`
- Produces: All routes except `/health`, `/auth/*`, `/analytics` now require `Authorization: Bearer <token>`

- [ ] **Step 1: Add the `protect` import and mount it**

Open `backend/src/routes/index.js`. Add the import after the existing imports and wrap routes:

```js
import { protect } from '../middleware/authMiddleware.js';

// ... keep existing health and analytics routes unchanged ...

router.use('/auth',        authRoutes);          // public — no protect
router.use('/riders',      protect, riderRoutes);
router.use('/restaurants', protect, restaurantRoutes);
router.use('/customers',   protect, customerRoutes);
router.use('/orders',      protect, orderRoutes);
router.use('/allocation',  protect, allocationRoutes);
router.use('/config',      protect, configRoutes);
router.use('/simulation',  protect, simulationRoutes);
```

The `/health` and `/analytics` routes above these lines remain unchanged (no `protect`).

- [ ] **Step 2: Verify protected route rejects without token**

```
curl -s http://localhost:5000/api/riders
```

Expected: `{"success":false,"message":"No token"}` with HTTP 401.

- [ ] **Step 3: Verify protected route accepts valid token**

First get a token:
```
curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"<your-admin-password>"}'
```

Copy the `token` from the response, then:
```
curl -s http://localhost:5000/api/riders \
  -H "Authorization: Bearer <token>"
```

Expected: `{"success":true,"data":[...]}` with HTTP 200.

- [ ] **Step 4: Verify analytics is still public**

```
curl -s http://localhost:5000/api/analytics
```

Expected: `{"totalRiders":...}` with HTTP 200 (no token needed).

- [ ] **Step 5: Commit**

```
git add backend/src/routes/index.js
git commit -m "feat: mount protect middleware on all non-public routes"
```

---

## Task 3: Simulation Loop Fixes — syncManualAllocation + Auto-Order Wiring

**Files:**
- Modify: `backend/src/services/simulationEngine.js`

**Interfaces:**
- Produces:
  - `syncManualAllocation(riderId: string|ObjectId, orderId: string|ObjectId): void` — exported, safe to call when sim is not running (no-ops)
  - `startSimulation()` now also starts the auto-order job
  - `stopSimulation()` now also stops the auto-order job

- [ ] **Step 1: Add `syncManualAllocation` export**

Find the `queueNextOrder` export in `simulationEngine.js` (around line 89) and add the new export directly after it:

```js
// Sync in-memory state after a manual IDLE allocation so the next tick
// doesn't see the rider as available and double-assign them.
export function syncManualAllocation(riderId, orderId) {
  const id = riderId.toString();
  const rider = riderState.get(id);
  if (!rider) return; // sim not running — DB writes already happened
  _removeFromH3(id, rider.h3Index);
  rider.status = 'ACCEPTED';
  rider.currentOrderId = orderId;
  pendingQueue.delete(orderId.toString());
}
```

- [ ] **Step 2: Wire auto-order job into `startSimulation` and `stopSimulation`**

Find the import block at the top of `simulationEngine.js`. Add:

```js
import { startAutoOrderJob, stopAutoOrderJob } from './orderGenerator.js';
```

In `startSimulation()`, add `startAutoOrderJob()` after setting `running = true`:

```js
export async function startSimulation() {
  if (running) return;
  await hydrate();
  running   = true;
  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  startAutoOrderJob();                                          // ← add
  if (ioRef) ioRef.emit('simulation:status', { running: true });
  console.log('[sim] started');
}
```

In `stopSimulation()`, add `stopAutoOrderJob()` before the flush loop:

```js
export async function stopSimulation() {
  if (!running) return;
  clearInterval(tickTimer);
  tickTimer = null;
  running   = false;
  stopAutoOrderJob();                                           // ← add

  // ... rest of flush loop unchanged ...
}
```

- [ ] **Step 3: Verify the server starts without errors**

```
node backend/src/server.js
```

Expected: `[sim] started` in the log with no import or syntax errors. The auto-order job runs silently in the background (it fires every 10 minutes so you won't see it immediately).

- [ ] **Step 4: Commit**

```
git add backend/src/services/simulationEngine.js
git commit -m "fix: export syncManualAllocation; wire auto-order job to sim start/stop"
```

---

## Task 4: Fix Manual-Allocate Double-Assignment (C1/C2)

**Files:**
- Modify: `backend/src/routes/allocation.js`

**Interfaces:**
- Consumes: `syncManualAllocation` from `../services/simulationEngine.js`

- [ ] **Step 1: Import `syncManualAllocation`**

Open `backend/src/routes/allocation.js`. Find the existing import line:

```js
import { queueNextOrder } from '../services/simulationEngine.js';
```

Change it to:

```js
import { queueNextOrder, syncManualAllocation } from '../services/simulationEngine.js';
```

- [ ] **Step 2: Call `syncManualAllocation` in the IDLE path**

Find the IDLE path block (the `if (isIdle) {` branch). After the `await Promise.all([...])` resolves, add the sync call:

```js
    await Promise.all([
      Order.findByIdAndUpdate(order._id, { ... }),
      Rider.findByIdAndUpdate(winner._id, { ... }),
      AllocationHistory.create({ ... }),
    ]);

    syncManualAllocation(winner._id, order._id);    // ← add this line

    getRoute( ... ).then( ... ).catch( ... );
```

The `getRoute` fire-and-forget call that follows remains unchanged.

- [ ] **Step 3: Verify allocation route still works**

With the sim running, create a PENDING order then manually allocate it:

```
# Create an order
curl -s -X POST http://localhost:5000/api/orders \
  -H "Authorization: Bearer <token>"

# Copy the returned order _id, then manually allocate:
curl -s -X POST http://localhost:5000/api/allocation/allocate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"orderId":"<order-id>"}'
```

Expected: `{"assigned":true,"riderId":"...","score":...}`. On the next sim tick that rider should not get re-assigned.

- [ ] **Step 4: Commit**

```
git add backend/src/routes/allocation.js
git commit -m "fix(C1/C2): sync in-memory rider state after manual IDLE allocation"
```

---

## Task 5: B11 Analytics Extension + PUT /orders/:id/accept

**Files:**
- Modify: `backend/src/routes/index.js`
- Modify: `backend/src/routes/orders.js`

**Interfaces:**
- Produces:
  - `GET /api/analytics` returns 8 fields: `totalRiders`, `availableRiders`, `activeOrders`, `completedOrders`, `avgPickupTime_s`, `avgDeliveryTime_s`, `throughput`, `riderFairness`
  - `PUT /api/orders/:id/accept` returns `200` for ASSIGNED orders, `409` otherwise

- [ ] **Step 1: Extend the analytics handler in `routes/index.js`**

Replace the entire `/analytics` handler with the extended version:

```js
router.get('/analytics', async (req, res) => {
  try {
    const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [
      totalRiders,
      availableRiders,
      activeOrders,
      completedOrders,
      throughput,
      timingAgg,
      riderFairness,
    ] = await Promise.all([
      Rider.countDocuments(),
      Rider.countDocuments({ availabilityStatus: 'ONLINE', status: 'IDLE' }),
      Order.countDocuments({ status: { $in: ['ASSIGNED', 'PICKED_UP'] } }),
      Order.countDocuments({ status: 'DELIVERED' }),
      Order.countDocuments({ status: 'DELIVERED', deliveredAt: { $gte: sixtyMinAgo } }),
      Order.aggregate([
        {
          $match: {
            status: 'DELIVERED',
            pickedUpAt:  { $exists: true },
            deliveredAt: { $exists: true },
            assignedAt:  { $exists: true },
          },
        },
        {
          $group: {
            _id: null,
            avgPickupMs:   { $avg: { $subtract: ['$pickedUpAt',  '$assignedAt']  } },
            avgDeliveryMs: { $avg: { $subtract: ['$deliveredAt', '$pickedUpAt']  } },
          },
        },
      ]),
      Order.aggregate([
        {
          $match: {
            status: 'DELIVERED',
            deliveredAt: { $gte: sixtyMinAgo },
            assignedRiderId: { $ne: null },
          },
        },
        { $group: { _id: '$assignedRiderId', deliveries: { $sum: 1 } } },
        {
          $lookup: {
            from:         'riders',
            localField:   '_id',
            foreignField: '_id',
            as:           'rider',
          },
        },
        { $unwind: { path: '$rider', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id:        0,
            riderId:    '$_id',
            name:       { $ifNull: ['$rider.name', 'Unknown'] },
            deliveries: 1,
          },
        },
        { $sort: { deliveries: -1 } },
      ]),
    ]);

    const timing = timingAgg[0] ?? {};

    res.json({
      totalRiders,
      availableRiders,
      activeOrders,
      completedOrders,
      avgPickupTime_s:   timing.avgPickupMs   != null ? timing.avgPickupMs   / 1000 : null,
      avgDeliveryTime_s: timing.avgDeliveryMs != null ? timing.avgDeliveryMs / 1000 : null,
      throughput,
      riderFairness,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
```

- [ ] **Step 2: Add `PUT /:id/accept` to `orders.js`**

Add this route at the bottom of `backend/src/routes/orders.js`, before `export default router`:

```js
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

Add the `Order` import at the top if not already there:

```js
import Order from '../models/Order.js';
```

- [ ] **Step 3: Verify analytics returns all 8 fields**

```
curl -s http://localhost:5000/api/analytics | node -e "process.stdin|process.stdout"
```

Expected response shape (values will be 0/null until deliveries run):
```json
{
  "totalRiders": 32,
  "availableRiders": 24,
  "activeOrders": 0,
  "completedOrders": 0,
  "avgPickupTime_s": null,
  "avgDeliveryTime_s": null,
  "throughput": 0,
  "riderFairness": []
}
```

- [ ] **Step 4: Verify `PUT /orders/:id/accept`**

With a PENDING or DELIVERED order id:

```
curl -s -X PUT http://localhost:5000/api/orders/<order-id>/accept \
  -H "Authorization: Bearer <token>"
```

Expected: `{"success":false,"message":"Order is PENDING, not ASSIGNED"}` (409).  
With an ASSIGNED order: `{"success":true,"data":{...}}` (200).

- [ ] **Step 5: Commit**

```
git add backend/src/routes/index.js backend/src/routes/orders.js
git commit -m "feat(B11): extended analytics + PUT /orders/:id/accept"
```

---

## Task 6: Remove Frontend Mock Fallbacks (C5)

**Files:**
- Modify: `frontend/src/api/endpoints.js`

**Interfaces:**
- Produces: All endpoint functions call the real backend. Errors propagate to callers.

- [ ] **Step 1: Replace the entire contents of `endpoints.js`**

```js
import api from './axios';

// Auth
export const login  = (body) => api.post('/auth/login', body);
export const getMe  = ()     => api.get('/auth/me');

// Riders
export const getRiders  = () => api.get('/riders').then(r => ({ data: r.data?.data ?? r.data }));
export const getRider   = (id) => api.get(`/riders/${id}`);
export const updateLocation = (id, body) => api.put(`/riders/${id}/location`, body);
export const updateStatus   = (id, body) => api.put(`/riders/${id}/status`, body);

// Restaurants
export const getRestaurants   = () => api.get('/restaurants').then(r => ({ data: r.data?.data ?? r.data }));
export const createRestaurant = (body) => api.post('/restaurants', body);
export const deleteRestaurant = (id)   => api.delete(`/restaurants/${id}`);

// Customers
export const getCustomers   = () => api.get('/customers').then(r => ({ data: r.data?.data ?? r.data }));
export const createCustomer = (body) => api.post('/customers', body);
export const deleteCustomer = (id)   => api.delete(`/customers/${id}`);

// Orders
export const getOrders  = (params) => api.get('/orders', { params }).then(r => ({ data: r.data?.data ?? r.data }));
export const getOrder   = (id)     => api.get(`/orders/${id}`);
export const createOrder  = ()       => api.post('/orders');
export const bulkOrders   = (count)  => api.post('/orders/bulk', { count });
export const acceptOrder  = (id)     => api.put(`/orders/${id}/accept`);

// Allocation
export const allocateOrder       = (orderId) => api.post('/allocation/allocate', { orderId });
export const getAllocationHistory = (params) => api.get('/allocation/history', { params });

// Config
export const getWeights = ()     => api.get('/config/weights');
export const setWeights = (body) => api.put('/config/weights', body);

// Simulation control
export const startSimulation     = () => api.post('/simulation/start');
export const stopSimulation      = () => api.post('/simulation/stop');
export const getSimulationStatus = () => api.get('/simulation/status');

// Analytics
export const getAnalytics = () => api.get('/analytics');
```

- [ ] **Step 2: Start the frontend and verify no console errors on load**

```
cd frontend && npm run dev
```

Open `http://localhost:5173`. Log in with `admin@demo.com` and the password from your `.env`.

Expected: Dashboard loads with real data from the backend. No "mock" references in the network tab.

- [ ] **Step 3: Verify error states surface correctly**

Stop the backend (`Ctrl+C`) while the frontend is running. Refresh the page.

Expected: Pages that require auth redirect to `/login` (axios 401 interceptor). Pages that load data show a loading error, not fake mock data.

- [ ] **Step 4: Commit**

```
git add frontend/src/api/endpoints.js
git commit -m "fix(C5): remove all mock fallbacks from endpoints.js"
```

---

## Final Smoke Test

With both servers running (`node backend/src/server.js` + `npm run dev` in frontend):

- [ ] Open `http://localhost:5173` → redirects to `/login` (no token)
- [ ] Log in → lands on Dashboard with real rider/order counts
- [ ] Navigate to Riders → real rider list loads (no mock data)
- [ ] Navigate to Restaurants → real restaurant list loads
- [ ] Navigate to Orders → create a single order → it appears as PENDING
- [ ] Watch Rider Map → riders moving, simulation running
- [ ] Wait ~30s → order transitions PENDING → ASSIGNED → PICKED_UP → DELIVERED
- [ ] Navigate to Allocation History → allocation record appears with scores
- [ ] Check `GET /api/analytics` → all 8 fields present
- [ ] Call a protected route without a token → 401 response

---

## Done-When Gate

- [ ] Protected routes return 401 without Bearer token
- [ ] Missing `MONGODB_URI` or `JWT_SECRET` crashes server at boot with a clear message
- [ ] Manual allocate for an IDLE rider does not double-assign on the next tick
- [ ] Auto-orders fire every 10 min while simulation is running (visible in DB)
- [ ] `GET /analytics` returns all 8 fields: `totalRiders`, `availableRiders`, `activeOrders`, `completedOrders`, `avgPickupTime_s`, `avgDeliveryTime_s`, `throughput`, `riderFairness`
- [ ] `PUT /orders/:id/accept` returns 200 for ASSIGNED, 409 otherwise
- [ ] Opening app with backend down shows real network errors (no mock data)
- [ ] Full delivery loop works: PENDING → ASSIGNED → PICKED_UP → DELIVERED
