# Backend Build Phases — Delivery Partner Allocation Engine

Build top to bottom. Each phase has a clear "done when" gate.
Reference: `docs/ALLOCATION_LOGIC.MD`, `docs/DATABASE_DESIGN.MD`,
`docs/APPLICATION_FLOW.MD`, `docs/API_ENDPOINTS.MD`.

**Current scaffold state:**
- `src/config/db.js`, `src/config/env.js` — exist, wired
- `src/middleware/authMiddleware.js`, `errorMiddleware.js` — exist as stubs
- `src/routes/index.js` — exists with `GET /health` only
- `src/app.js`, `src/server.js` — exist
- `src/models/`, `src/services/`, `src/controllers/`, `src/utils/`, `src/validators/` — empty

---

## Phase B1 — Constants & config

**File:** `src/config/constants.js` (new, separate from `env.js`)

`env.js` holds secrets from `.env`. `constants.js` holds tunable business logic.

```js
export const H3_RESOLUTION        = 7;
export const H3_CANDIDATE_K       = 2;    // ~4–5 km rider candidate ring
export const H3_SERVICE_AREA_K    = 5;    // ~8–10 km customer ↔ restaurant ring

export const RIDER_SPEED_KMH      = 40;   // constant speed for ETAR + movement
export const TICK_INTERVAL_MS     = 1000; // simulation heartbeat
export const RIDER_SEED_COUNT     = 32;
export const AUTO_ORDER_INTERVAL_MS = 600_000; // 10 min
export const LOAD_WINDOW_MINUTES  = 60;   // rolling window for recent-load score
export const MAX_ALLOCATION_RETRIES = 10; // (enhancement) stale order backoff
export const MIN_RIDER_SPEED_MS     = 3;  // m/s fallback floor for Phase 3 traffic (≈10 km/h)

export const DEFAULT_WEIGHTS = { etar: 0.50, rating: 0.30, load: 0.20 };

// Ranchi bounding box — all seeded coords fall inside this
export const RANCHI_BOUNDS = {
  minLat: 23.25, maxLat: 23.45,
  minLng: 85.25, maxLng: 85.45,
};
```

Live weights are mutable at runtime — keep them in a module-level object in
`constants.js` with a `getWeights()` / `setWeights()` getter/setter pair so
the `PUT /config/weights` route can update them without a restart.

**Done when:** `import { RIDER_SPEED_KMH } from './config/constants.js'` works anywhere in the project.

---

## Phase B2 — Models

**Directory:** `src/models/`  
**Files:** `Rider.js`, `Restaurant.js`, `Customer.js`, `Order.js`, `AllocationHistory.js`

Full schema field list is in `docs/DATABASE_DESIGN.MD §2`. Fields to not miss:

**Rider.js:**
- `h3Index: { type: String, required: true }` — pre-computed H3 cell at res 7
- `nextOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null }`
- `isSimulated: { type: Boolean, required: true }`
- `deliveryTimestamps: [Date]` — sliding window for recent-load; entries older than 60 min are pruned on read

**Order.js:**
- `polyline: [{ lat: Number, lng: Number }]` — Phase 1: two points; Phase 2: road geometry
- `leg1Duration_s: Number` — haversine(rider, restaurant) / 40 * 3600, set at assignment
- `leg2Duration_s: Number` — haversine(restaurant, customer) / 40 * 3600, set at assignment
- `legStartedAt: Date` — when current leg began; progress is derived from this
- `progress: Number` — 0–1, stored for WS broadcast, derived from legStartedAt
- `queuedAt: Date` — when order last entered PENDING (creation or re-queue)

**Add indexes** (use `schema.index()` calls, not inline `index: true`):
```js
// Rider
RiderSchema.index({ availabilityStatus: 1, h3Index: 1 });
RiderSchema.index({ availabilityStatus: 1, status: 1 });
// Order
OrderSchema.index({ status: 1, createdAt: 1 });
OrderSchema.index({ assignedRiderId: 1, deliveredAt: 1 });
// Restaurant / Customer
RestaurantSchema.index({ isActive: 1 });
CustomerSchema.index({ isActive: 1 });
// AllocationHistory
AllocationHistorySchema.index({ orderId: 1 });
```

**Done when:** `node -e "import('./src/models/Rider.js').then(m => console.log(m.default.schema.paths))"` shows all fields without errors.

---

## Phase B3 — Seed script

**File:** `seed.js` at project root (`node seed.js`)

Idempotent — check if data already exists before inserting. Uses `RANCHI_BOUNDS` from `constants.js`.

```
1. Connect to MongoDB
2. Seed 8 restaurants — fixed coords with real-sounding Ranchi names, isActive: true
3. Seed 25 customers — random coords in RANCHI_BOUNDS, isActive: true
4. Seed 32 riders — random coords in RANCHI_BOUNDS, each:
     availabilityStatus: 'ONLINE', status: 'IDLE'
     h3Index: h3.latLngToCell(lat, lng, H3_RESOLUTION)   ← compute before saving
     rating: random 3.5–5.0
     isSimulated: true
5. Disconnect
```

4. **Admin user (1)** — `email: admin@demo.com`, `role: 'admin'`, `riderId: null`, `passwordHash: bcrypt(plain password from .env)`

**Done when:** `node seed.js` runs clean, all four collections visible in Atlas, `h3Index` values correct on every rider, admin login works.

---

## Phase B4 — CRUD APIs

**Add files:**
- `src/controllers/riderController.js`
- `src/controllers/restaurantController.js`
- `src/controllers/customerController.js`
- `src/controllers/orderController.js`
- `src/routes/riders.js`, `restaurants.js`, `customers.js`, `orders.js`
- Mount all in `src/routes/index.js`

**Endpoints to implement** (see `docs/API_ENDPOINTS.MD`):

| Method | Path | Notes |
|---|---|---|
| `POST` | `/riders` | Create rider; compute `h3Index` from lat/lng before save |
| `GET` | `/riders` | List all |
| `GET` | `/riders/:id` | Single rider |
| `PUT` | `/riders/:id/location` | Update lat/lng + recompute `h3Index` |
| `PUT` | `/riders/:id/status` | Toggle `availabilityStatus` (ONLINE/OFFLINE) |
| `POST` | `/restaurants` | Create |
| `GET` | `/restaurants` | List active only (isActive: true) |
| `DELETE` | `/restaurants/:id` | Soft delete: `isActive: false` |
| `POST` | `/customers` | Create |
| `GET` | `/customers` | List active only |
| `DELETE` | `/customers/:id` | Soft delete |
| `POST` | `/orders` | Single order (uses `createOrder()` from orderGenerator) |
| `POST` | `/orders/bulk` | N orders (`createOrder()` in loop) |
| `GET` | `/orders` | List; optional `?status=` filter |
| `GET` | `/orders/:id` | Single order |

Use the existing `errorMiddleware.js` for consistent error responses.
Add `src/validators/` files (express-validator or manual) for POST bodies.

**Done when:** all endpoints return expected data in Postman. Soft-delete works. `h3Index` is always populated on rider create.

---

## Phase B5 — Utility: Haversine

**File:** `src/utils/haversine.js`

```js
// Returns distance in km between two {lat, lng} points
export function haversine(a, b) { ... }
```

Used by both `allocationEngine.js` and `simulation.js`. Write once.

---

## Phase B6 — Allocation Engine

**File:** `src/services/allocationEngine.js`

Exported function: `allocateOrder(order, h3Buckets, riderState, weights)`

**Step-by-step logic:**

```
1. restaurantHex = h3.latLngToCell(order.restaurantLat, order.restaurantLng, H3_RESOLUTION)
2. candidateCells = h3.gridDisk(restaurantHex, H3_CANDIDATE_K)  // 19 cells
3. candidates = union of h3Buckets[cell] for each cell
   → filter: rider.availabilityStatus === 'ONLINE'

4. For each candidate, compute ETAR:
   a. Get rider's active order from riderState
   b. Compute progress = min(1.0, (Date.now() - order.legStartedAt) / (legDuration_s * 1000))
      IDLE      → progress irrelevant; time_to_free = 0
      ACCEPTED  → time_to_free = (1 - progress) * activeOrder.leg1Duration_s
                                 + activeOrder.leg2Duration_s
      PICKED_UP → time_to_free = (1 - progress) * activeOrder.leg2Duration_s
   c. travel_time = haversine(rider, restaurant) / RIDER_SPEED_KMH * 3600
   d. ETAR = time_to_free + travel_time

5. Normalize per candidate:
   maxETAR = max of all ETARs (if 0 → all ETARScore = 1.0)
   maxLoad = max of all loads (if 0 → all LoadScore = 1.0)
   ETARScore   = 1 - (etar / maxETAR)
   RatingScore = rider.rating / 5
   LoadScore   = 1 - (recentLoad / maxLoad)

   recentLoad = rider.deliveryTimestamps.filter(t => t > now - 60min).length

6. finalScore = w.etar*ETARScore + w.rating*RatingScore + w.load*LoadScore
   (weights already normalized to sum=1 by setWeights())

7. Return winner { riderId, score, breakdown, ETAR } or null if no candidates
```

**Also add routes:**
- `src/routes/allocation.js` → `POST /allocate-order` (admin manual trigger), `GET /allocation-history`
- `src/routes/configRoutes.js` → `GET /config/weights`, `PUT /config/weights`

**Done when:** posting an order ID to `/allocate-order` returns `{ riderId, score, breakdown }` and writes an `AllocationHistory` record. Busy riders near the restaurant beat idle riders farther away.

---

## Phase B7 — Order Generator

**File:** `src/services/orderGenerator.js`

```
createOrder():
  1. Pick random active restaurant
  2. restaurantHex = h3.latLngToCell(restaurantLat, restaurantLng, H3_RESOLUTION)
  3. serviceArea = new Set(h3.gridDisk(restaurantHex, H3_SERVICE_AREA_K))
  4. Fetch all active customers
  5. Filter: h3.latLngToCell(customer.lat, customer.lng, H3_RESOLUTION) ∈ serviceArea
  6. If none found after 10 attempts with different restaurants: throw (no order created)
  7. Snapshot restaurant + customer onto new order; save with status: 'PENDING', queuedAt: now
  8. Return saved order

bulkCreateOrders(n):
  - Call createOrder() n times; skip failures; return count created

startAutoOrderJob() / stopAutoOrderJob():
  - setInterval wrapper using AUTO_ORDER_INTERVAL_MS
  - Only runs while sim is active (called from simulation.js)
```

**Done when:** `POST /orders/bulk` with `{ count: 5 }` creates up to 5 orders, all with customers inside the restaurant's H3 service area. Orders outside the zone are rejected.

---

## Phase B8 — Simulation (the core)

**File:** `src/services/simulation.js`

**In-memory state:**
```js
const riderState  = new Map()  // riderId → full rider object (live position)
const h3Buckets   = new Map()  // h3Cell → Set<riderId>
const pendingQueue = []        // [{ orderId, queuedAt, priority }]
let   tickTimer   = null
```

**`initSimulation()`** — call once at server start before any WS client connects:
1. Load all riders from MongoDB → populate `riderState` + `h3Buckets`
2. Load all `PENDING` orders sorted by `queuedAt ASC` → push to `pendingQueue` at priority 0

**`startSimulation(io)`** — called when first WS client connects:
- Start `setInterval(tick, TICK_INTERVAL_MS)` and `startAutoOrderJob()`

**`stopSimulation()`** — called when last WS client disconnects:
- `clearInterval(tickTimer)`, `stopAutoOrderJob()`

**`tick()` — three stages:**

**Stage 1 — Process queue:**
- Sort queue: priority DESC, then queuedAt ASC
- For the first PENDING order in queue:
  - Call `allocateOrder(order, h3Buckets, riderState, getWeights())`
  - If winner found:
    - If winner is `IDLE`:
      - Compute `leg1Duration_s`, `leg2Duration_s` from haversine distances
      - Build `polyline: [rider, restaurant]` (Phase 1: two points)
      - Set `legStartedAt = new Date()`
      - Update `riderState`: status → ACCEPTED, currentOrderId = order._id
      - Update `h3Buckets` if h3Index changed
      - Flush to MongoDB (lifecycle event): rider fields + order fields (status=ASSIGNED, assignedRiderId, assignedAt, leg1Duration_s, leg2Duration_s, legStartedAt, polyline)
      - Write `AllocationHistory` record
      - Remove order from queue
    - If winner is `ACCEPTED` or `PICKED_UP`:
      - Set `rider.nextOrderId = order._id` in riderState
      - Compute leg durations and polyline now (store on order), but do NOT set legStartedAt yet
      - Flush to MongoDB: rider.nextOrderId + order (status=ASSIGNED, assignedRiderId, assignedAt, leg1Duration_s, leg2Duration_s, polyline)
      - Write `AllocationHistory` record
      - Remove order from queue
  - If no winner: leave order in queue

**Stage 2 — Move riders:**
- For each rider in riderState where status is ACCEPTED or PICKED_UP:
  - Fetch their active order
  - `legDuration_ms = (status=ACCEPTED ? leg1Duration_s : leg2Duration_s) * 1000`
  - `progress = min(1.0, (Date.now() - legStartedAt) / legDuration_ms)`
  - Interpolate lat/lng along `order.polyline` at `progress`
  - Update rider lat/lng in riderState; recompute h3Index; update h3Buckets
  - Update `order.progress` in riderState
  - If `progress >= 1.0`: trigger state transition (see below)

**State transitions (each flushes to MongoDB):**
- `ACCEPTED → PICKED_UP`:
  - Rider position = restaurant coords
  - Order: `status=PICKED_UP`, `pickedUpAt=now`, `legStartedAt=now` (resets for leg 2)
  - Rider: `status=PICKED_UP`; update h3Index; flush
- `PICKED_UP → IDLE`:
  - Order: `status=DELIVERED`, `deliveredAt=now`
  - Rider: push `now` to `deliveryTimestamps`; status=IDLE; currentOrderId=null; activeOrders=0; flush
  - Check `rider.nextOrderId`:
    - If set: transition directly to ACCEPTED for that order
      - Set `legStartedAt=now` on the next order; update rider.currentOrderId; clear nextOrderId; flush
    - If not set: rider is genuinely IDLE

**`handleRiderOffline(riderId)`:**
- If rider.status === 'ACCEPTED':
  - `reQueueOrder(rider.currentOrderId, priority=1)` — re-insert at front
  - Clear rider.currentOrderId, set rider.availabilityStatus=OFFLINE, status=IDLE
  - Flush both rider and order to MongoDB
- Update riderState + h3Buckets

**`reQueueOrder(orderId, priority)`:**
- Set order `status=PENDING`, `assignedRiderId=null`, `assignedAt=null`, `queuedAt=now` in MongoDB
- Insert at front of pendingQueue (priority 1) or back (priority 0)

**`updateRiderH3(rider, oldH3)`:**
- Remove riderId from `h3Buckets[oldH3]`
- Add riderId to `h3Buckets[newH3]` (create Set if needed)

**Stage 3 — Broadcast:**
```js
io.emit('simulation:tick', {
  riders: [...riderState.values()].map(r => ({
    _id: r._id, lat: r.latitude, lng: r.longitude,
    status: r.status, availabilityStatus: r.availabilityStatus,
    currentOrderId: r.currentOrderId
  })),
  queueDepth: pendingQueue.length
})
```

**Done when:** riders move, orders assign (including to busy riders), ACCEPTED→PICKED_UP→DELIVERED cycle completes, positions broadcast on every tick, MongoDB only written at lifecycle events.

---

## Phase B9 — WebSocket server wiring

**File:** `src/server.js` — update to wire Socket.IO with simulation:

```
on('connection', socket):
  - if first client: startSimulation(io)
  - socket.on('disconnect'):
      if last client: stopSimulation()
```

**Additional WS events to emit (from simulation.js):**
- `order:assigned`  — `{ orderId, riderId, score, reason }` — emit on allocation
- `order:delivered` — `{ orderId, riderId }` — emit on delivery

**Done when:** open two browser tabs, close them one by one — sim only stops when the last one closes.

---

## Phase B10 — Auth

**Files:** `src/routes/auth.js`, `src/controllers/authController.js`
Extend `src/middleware/authMiddleware.js`

**Endpoints:**
- `POST /auth/login` — email + password; returns JWT. Two roles: `admin`, `partner`
- `POST /auth/logout` — invalidate (client-side token drop is fine for Phase 1)
- `GET /auth/me` — return current user from token

**`authMiddleware.js`:** verify JWT, attach `req.user = { id, role }`. Admin routes require `role === 'admin'`. Partner routes require `role === 'partner'` or `admin`.

For partners, the User document maps to a `Rider._id` (add `riderId` field to user doc or use a simple user collection with role + riderId).

**Done when:** login returns a JWT; protected routes reject a missing/invalid token with 401; `GET /auth/me` returns the logged-in user.

---

## Phase B11 — Analytics

**File:** `src/routes/analytics.js`, `src/controllers/analyticsController.js`

**`GET /analytics` returns:**
```js
{
  totalRiders:       riders.countDocuments(),
  availableRiders:   riders.countDocuments({ availabilityStatus: 'ONLINE', status: 'IDLE' }),
  activeOrders:      orders.countDocuments({ status: { $in: ['ASSIGNED', 'PICKED_UP'] } }),
  completedOrders:   orders.countDocuments({ status: 'DELIVERED' }),
  avgPickupTime_s:   // avg of (pickedUpAt - assignedAt) for DELIVERED orders
  avgDeliveryTime_s: // avg of (deliveredAt - pickedUpAt) for DELIVERED orders
  throughput:        // count of orders delivered in last 60 min
  riderFairness:     // per-rider delivery count in last 60 min (array)
}
```

Also add: `PUT /orders/:id/accept` — partner accepts assigned order (for Phase 2 Partner View; can stub it now).

**Done when:** `GET /analytics` returns correct aggregates. Counts update after deliveries.

---

## Phase B12 — Enhancements *(pick order based on priority)*

| Enhancement | File | Notes |
|---|---|---|
| **Stale order backoff** | `simulation.js` | After `MAX_ALLOCATION_RETRIES` failed ticks, move order to back of queue (`queuedAt=now`, priority=0) |
| **nextOrderId offline** | `simulation.js` `handleRiderOffline()` | If rider has `nextOrderId`, reset that order to PENDING at priority 0; clear `nextOrderId` |
| **SLA flagging** | `simulation.js` + analytics | Flag orders where `now - queuedAt > SLA_THRESHOLD_MS`; add `isSlaBreached` to broadcast |
| **Road routing (Phase 2 seam)** | `routingService.js` + `simulation.js` | Replace 2-point Haversine polyline with Mapbox Directions `driving` profile. Called once at assignment. Frontend renders same `polyline` array unchanged. Required before B13. |

---

## Phase B13 — Traffic-adaptive speed *(Phase 3, final enhancement)*

**Prerequisite:** B12 road routing must be complete — this phase swaps the routing profile from `driving` to `driving-traffic` and adds per-segment speed data on top of the road geometry Phase 2 already provides.

**Core design — single snapshot model:**
Mapbox `driving-traffic` is called **once at allocation time** for the winning rider. The response includes road geometry (polyline), per-segment traffic speeds (m/s), and congestion labels. The simulation heartbeat uses these speeds as the per-tick distance budget instead of the fixed 40 km/h constant. ETAR candidate scoring remains Haversine-based — no API call per candidate during scoring.

---

### B13.1 — `src/services/routingService.js`

Change the Mapbox API call from `driving` to `driving-traffic` and add annotations:

```
GET https://api.mapbox.com/directions/v5/mapbox/driving-traffic/{coords}
  ?annotations=speed,congestion
  &geometries=geojson
  &access_token=MAPBOX_TOKEN
```

Updated return shape (for each leg):
```js
{
  polyline:         [{ lat, lng }],   // road-snapped coordinates
  segmentLengths_m: [float],          // distance of each segment in meters
  segmentSpeeds_ms: [float],          // traffic speed per segment in m/s
  congestion:       [string],         // 'low' | 'moderate' | 'heavy' | 'severe' per segment
  duration_s:       number,           // Mapbox traffic-aware total duration
}
```

**Fallback:** if the Mapbox call fails, return a 2-point Haversine polyline + `segmentSpeeds_ms: []` (empty signals the simulation to use the fixed-speed fallback path).

---

### B13.2 — `src/services/simulation.js` — in-memory trip data

Extend each active trip's in-memory entry. These fields are **not persisted to MongoDB** — they are reconstructed from Mapbox on each new assignment. On server restart, the system falls back to fixed-speed movement for in-progress deliveries until they complete.

```js
// Added to in-memory tripData per active order (both legs stored at assignment time)
leg1SegmentLengths_m: [float],
leg1SegmentSpeeds_ms: [float],
leg1Congestion:       [string],
leg2SegmentLengths_m: [float],
leg2SegmentSpeeds_ms: [float],
leg2Congestion:       [string],
currentSegmentIdx:    0,              // which segment the rider is currently on
distanceTraveledOnSegment_m: 0.0,    // how far into that segment
```

`leg1Duration_s` and `leg2Duration_s` on the Order are now set from Mapbox's traffic-aware `duration_s` (not Haversine / 40 km/h). This means ETAR for **busy riders** (who have leg durations stored on their current order) is automatically traffic-aware. ETAR for **idle candidates** still uses Haversine — correct trade-off, zero extra API calls.

---

### B13.3 — `src/services/simulation.js` — movement engine (Stage 2)

Detect whether traffic data is available:
```js
const hasTrafficData = tripData.leg1SegmentSpeeds_ms.length > 0;
```

**If traffic data present — segment traversal model:**
```
currentSpeeds   = activeLeg === 'leg1' ? leg1SegmentSpeeds_ms : leg2SegmentSpeeds_ms
currentLengths  = activeLeg === 'leg1' ? leg1SegmentLengths_m : leg2SegmentLengths_m

rawBudget_m    = currentSpeeds[currentSegmentIdx] * TICK_INTERVAL_S
distanceBudget = max(rawBudget_m, 3 * TICK_INTERVAL_S)  // min 3 m/s ≈ 10 km/h

remaining = distanceBudget
while (remaining > 0 && currentSegmentIdx < polyline.length - 1):
  segRemaining = currentLengths[currentSegmentIdx] - distanceTraveledOnSegment_m
  if remaining >= segRemaining:
    remaining -= segRemaining
    currentSegmentIdx++
    distanceTraveledOnSegment_m = 0
    if currentSegmentIdx === polyline.length - 1:
      → trigger state transition (ACCEPTED→PICKED_UP or PICKED_UP→IDLE)
      break
  else:
    distanceTraveledOnSegment_m += remaining
    remaining = 0

// Interpolate position within current segment
t = distanceTraveledOnSegment_m / currentLengths[currentSegmentIdx]
rider.lat = lerp(polyline[currentSegmentIdx].lat,   polyline[currentSegmentIdx+1].lat,   t)
rider.lng = lerp(polyline[currentSegmentIdx].lng,   polyline[currentSegmentIdx+1].lng,   t)
```

**If no traffic data (fallback) — keep existing wall-clock progress interpolation:**
```
progress = min(1.0, (Date.now() - legStartedAt) / (legDuration_s * 1000))
→ interpolate along polyline by progress as before
```

---

### B13.4 — `src/services/simulation.js` — `simulation:tick` broadcast

Add congestion metadata so the frontend can color the active route:

```js
io.emit('simulation:tick', {
  riders:     [...riderState.values()],
  queueDepth: pendingQueue.length,
  // Per active order — only orders with traffic data populated
  orderTraffic: {
    [orderId]: {
      congestion:       activeLeg === 'leg1' ? leg1Congestion : leg2Congestion,
      segmentLengths_m: activeLeg === 'leg1' ? leg1SegmentLengths_m : leg2SegmentLengths_m,
    }
  }
})
```

---

**Done when:**
- A rider on a congested road visibly slows down on the map
- A rider on a clear road moves faster than 40 km/h
- `order:delivered` timing approximates the Mapbox traffic estimate (not the fixed-speed estimate)
- Mapbox outage triggers fallback to constant speed without crashing

---

## Phase B14 — Deployment

- Add `CORS` origin to match deployed frontend URL
- All secrets via environment variables (no hardcoding)
- Deploy to **Render** (backend), **MongoDB Atlas** (database)
- Run `node seed.js` against Atlas once
- Verify `GET /health` responds on deployed URL

---

## Build order summary

| Phase | Files created | Gate |
|---|---|---|
| B1 | `config/constants.js` | Constants importable |
| B2 | `models/*.js` | All 5 schemas + indexes |
| B3 | `seed.js` | Atlas populated, h3Index correct |
| B4 | `controllers/*.js`, `routes/*.js` | All CRUD endpoints work in Postman |
| B5 | `utils/haversine.js` | Utility ready |
| B6 | `services/allocationEngine.js` + routes | Allocation returns correct winner |
| B7 | `services/orderGenerator.js` | Orders created within service area |
| B8 | `services/simulation.js` | Full delivery cycle, lifecycle DB writes only |
| B9 | `server.js` WS wiring | Sim starts/stops with clients |
| B10 | `routes/auth.js` + middleware | JWT auth works |
| B11 | `routes/analytics.js` | Dashboard aggregates correct |
| B12 | Enhancements (stale backoff, SLA, road routing) | Per priority |
| B13 | Traffic-adaptive speed (single snapshot, segment traversal model) | Riders slow in traffic |
| B14 | Deploy config | Live on Render + Atlas |

> **Backend MVP gate:** B1–B9. After B9 the full allocation + simulation loop runs.
> B10–B11 make it usable. B12 makes it credible. B13 makes it real. B14 ships it.
