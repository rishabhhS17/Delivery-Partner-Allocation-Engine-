# Delivery Partner Allocation Engine — Project Phases

The complete build roadmap. Each phase builds on the last.
Reference docs: `PROJECT_SPEC.MD`, `ALLOCATION_LOGIC.MD`, `DATABASE_DESIGN.MD`,
`APPLICATION_FLOW.MD`, `FEATURES.MD`, `FRONTEND_PAGES.MD`, `API_ENDPOINTS.MD`.

---

## Phase 0 — Backend Foundation
**Goal:** a running server with allocation, simulation, and seeded data.
No frontend pages. Done when you can hit the API and watch the simulation
log in the terminal.

### 0.1 — Project setup

```
backend/
  config.js
  models.js
  allocationEngine.js
  simulation.js
  orderGenerator.js
  seed.js
  server.js
  routes/
    auth.js
    riders.js
    restaurants.js
    customers.js
    orders.js
    allocation.js
    config.js
    analytics.js
```

Install: `express`, `mongoose`, `socket.io`, `h3-js`, `node-cron`, `bcryptjs`, `jsonwebtoken`, `dotenv`, `cors`

---

### 0.2 — `config.js`

All tunable constants in one place. Nothing hardcoded elsewhere.

| Constant | Value | Notes |
|---|---|---|
| `RANCHI_BOUNDS` | `{ minLat: 23.25, maxLat: 23.45, minLng: 85.25, maxLng: 85.45 }` | Bounding box for seeding |
| `H3_RESOLUTION` | `7` | All H3 ops use this |
| `H3_CANDIDATE_K` | `2` | k-ring for rider candidate pool (~4–5 km) |
| `H3_SERVICE_AREA_K` | `5` | k-ring for customer ↔ restaurant pairing (~8–10 km) |
| `RIDER_SPEED_KMH` | `40` | Constant speed for ETAR + movement |
| `TICK_INTERVAL_MS` | `1000` | Simulation heartbeat |
| `RIDER_SEED_COUNT` | `32` | Riders created by seed script |
| `AUTO_ORDER_INTERVAL_MS` | `600000` | Auto-order every 10 min |
| `LOAD_WINDOW_MINUTES` | `60` | Rolling window for recent-load score |
| `MAX_ALLOCATION_RETRIES` | `10` | *(Enhancement)* Stale order backoff |
| `DEFAULT_WEIGHTS` | `{ etar: 0.50, rating: 0.30, load: 0.20 }` | Runtime-configurable |

---

### 0.3 — `models.js`

Five Mongoose schemas. Full field list in `DATABASE_DESIGN.MD §2`.

**Key fields to not miss:**

- **Rider:** `h3Index` (String, required), `nextOrderId` (ObjectId, ref Orders), `isSimulated` (Boolean)
- **Order:** `polyline` (Array of {lat,lng}), `leg1Duration_s`, `leg2Duration_s`, `legStartedAt` (Date), `progress` (Number, 0-1), `queuedAt` (Date)
- **AllocationHistory:** `breakdown` (Mixed — stores `{ etarScore, ratingScore, loadScore, rawEtar_s }`)

**Indexes to create** (see `DATABASE_DESIGN.MD §6`):
- riders: `{ availabilityStatus: 1, h3Index: 1 }`
- orders: `{ status: 1, createdAt: 1 }`
- orders: `{ assignedRiderId: 1, deliveredAt: 1 }`

---

### 0.4 — `allocationEngine.js`

Single exported function: `allocateOrder(order, h3Buckets, riderState, weights)`

**Steps:**
1. `restaurantHex = h3.latLngToCell(order.restaurantLat, order.restaurantLng, 7)`
2. `candidateZone = new Set(h3.gridDisk(restaurantHex, 2))`
3. Union all cells in `candidateZone` from `h3Buckets` → rider IDs. Filter: `rider.availabilityStatus === 'ONLINE'`
4. For each candidate, compute ETAR:
   - `IDLE`: `haversine(rider, restaurant) / 40 * 3600`
   - `PICKED_UP`: `(1 - progress) * order.leg2Duration_s + haversine(rider, restaurant) / 40 * 3600`
   - `ACCEPTED`: `(1 - progress) * order.leg1Duration_s + order.leg2Duration_s + haversine(rider, restaurant) / 40 * 3600`
   - `progress = min(1.0, (Date.now() - order.legStartedAt) / (legDuration_s * 1000))`
5. Normalize ETAR, rating, load to 0–1:
   - If `maxETAR === 0` → all `ETARScore = 1.0`
   - If `maxLoad === 0` → all `LoadScore = 1.0`
   - Otherwise: `ETARScore = 1 - (etar / maxETAR)`, `RatingScore = rating / 5`, `LoadScore = 1 - (load / maxLoad)`
6. Normalize weights: `w = weights / sum(weights)`
7. `finalScore = w.etar * ETARScore + w.rating * RatingScore + w.load * LoadScore`
8. Return winner + breakdown + AI/template reason
9. If no candidates: return `null`

**`generateReason(winner, breakdown)`** — deterministic template:
`"${name} selected: ~${km}km away, ~${mins}min ETAR, rated ${rating}/5, ${load} recent deliveries."`
AI call wraps this with a try/catch; template is the fallback.

**`haversine(a, b)`** — helper, returns km.

---

### 0.5 — `simulation.js`

The heart of the system. Owns all in-memory state.

**In-memory structures:**
```js
const riderState  = new Map()  // riderId (string) → full rider object
const h3Buckets   = new Map()  // h3Cell (string) → Set<riderId>
const pendingQueue = []         // [{ orderId, queuedAt, priority }] — sorted priority DESC, queuedAt ASC
```

**`initSimulation()`** — called at server start:
1. Load all riders from MongoDB
2. For each rider: `riderState.set(id, rider)`; add to `h3Buckets[rider.h3Index]`
3. Load all `PENDING` orders from MongoDB sorted by `queuedAt ASC`
4. Push each to `pendingQueue` at priority 0

**`startSimulation(io)`** — starts tick interval; called when first WS client connects

**`stopSimulation()`** — clears interval; called when last WS client disconnects

**`tick()` — runs every `TICK_INTERVAL_MS`:**
1. **Process queue**: pop oldest pending order (FIFO, respect priority). Call `allocateOrder`. If winner found:
   - If winner is `IDLE`: assign now (update riderState, h3Buckets, flush to MongoDB, write AllocationHistory)
   - If winner is `ACCEPTED`/`PICKED_UP`: pre-assign (`rider.nextOrderId = order._id`; flush `nextOrderId` + order `ASSIGNED` to MongoDB)
   - If no winner: push back to queue unchanged
2. **Move riders**: for each rider in `ACCEPTED`/`PICKED_UP`:
   - Compute `progress = min(1.0, (Date.now() - order.legStartedAt) / (legDuration_ms))`
   - Interpolate position along `order.polyline`
   - Update `riderState` (lat, lng, h3Index)
   - If `progress >= 1.0`: trigger state transition
3. **State transitions** (flush to MongoDB as lifecycle events):
   - `ACCEPTED` → `PICKED_UP`: order `pickedUpAt = now`, reset `legStartedAt` for leg 2, update rider position
   - `PICKED_UP` → `IDLE`: order `deliveredAt = now`, push `deliveredAt` to `rider.deliveryTimestamps`; check `rider.nextOrderId` → if set, auto-start (→ `ACCEPTED`, set `legStartedAt = now`); if not, go `IDLE`
4. **Broadcast**: emit `simulation:tick` over Socket.IO with all rider positions + states + queue depth

**`updateRiderH3(rider)`** — recomputes `rider.h3Index`, updates `h3Buckets` (remove old cell, add new cell)

**`reQueueOrder(orderId, priority)`** — prepends to queue at given priority; updates order in MongoDB (`status: PENDING, assignedRiderId: null, queuedAt: now`)

**`handleRiderOffline(riderId)`** — if rider is `ACCEPTED`: `reQueueOrder(rider.currentOrderId, 1)`; clear rider state

---

### 0.6 — `orderGenerator.js`

**`createOrder()`:**
1. Pick random active restaurant
2. Build `restaurantHex` and `serviceArea = h3.gridDisk(restaurantHex, 5)`
3. Fetch all active customers; filter to those whose `h3.latLngToCell(lat, lng, 7)` is in `serviceArea`
4. If no valid customers found after 10 attempts: abort
5. Snapshot restaurant + customer onto order; save with `status: PENDING`, `queuedAt: now`
6. Push to `pendingQueue` in simulation

**`bulkCreateOrders(n)`** — call `createOrder()` n times (sequential, skip failures)

**`startAutoOrderJob()`** / **`stopAutoOrderJob()`** — `setInterval` wrapper

---

### 0.7 — `seed.js`

Run once before first use (`node seed.js`). Idempotent — checks if data already exists.

1. **Restaurants (8)** — fixed coords inside `RANCHI_BOUNDS`; give them real-sounding names
2. **Customers (25)** — random coords inside `RANCHI_BOUNDS`
3. **Riders (32)** — random coords inside `RANCHI_BOUNDS`; all `ONLINE`, `IDLE`, `isSimulated: true`; pre-compute `h3Index = h3.latLngToCell(lat, lng, 7)` before saving

---

### 0.8 — `server.js`

```
Express setup → middleware (cors, json) → route mounting → Socket.IO attach
→ MongoDB connect → initSimulation()
→ io.on('connection') → start sim if first client
→ io.on('disconnect') → stop sim if last client
```

Auth: JWT middleware. Two roles: `admin`, `partner`. Routes that need auth check the token.

**WS events emitted:**
- `simulation:tick` — `{ riders: [...], queueDepth: n }`
- `order:assigned` — `{ orderId, riderId, reason }`
- `order:delivered` — `{ orderId }`

**Phase 0 done when:** `node seed.js` runs clean, `node server.js` starts without error, `/riders` returns seeded riders, terminal logs show tick activity.

---

## Phase 1 — MVP (8 pages)

**Goal:** Admin logs in, sees live riders on the map, creates an order, watches it get assigned and delivered. Full loop end to end.

Frontend stack: React, Material UI, Axios, Socket.IO client, Mapbox GL JS (`mapbox-gl` + `react-map-gl`).

### Frontend setup

```
frontend/src/
  api/          axios instance + endpoint functions
  context/      AuthContext, SimulationContext (WS state)
  components/   shared UI pieces
  pages/        one folder per page
  styles/       all CSS / .module.css files (NO inline styles)
```

Base URL from env: `REACT_APP_API_URL`.

---

### Page 1 — Login

**Route:** `/login`  
**API:** `POST /auth/login`  
**What it does:** email + password form → JWT stored in `localStorage` → redirect to Dashboard

---

### Page 2 — Restaurant Management

**Route:** `/restaurants`  
**API:** `GET /restaurants`, `POST /restaurants`, `DELETE /restaurants/:id`  
**What it shows:** table of restaurants (name, phone, lat, lng, active/inactive). Add form. Soft-delete button.

---

### Page 3 — Customer Management

**Route:** `/customers`  
**API:** `GET /customers`, `POST /customers`, `DELETE /customers/:id`  
**What it shows:** table of customers. Add form. Soft-delete button.

---

### Page 4 — Rider Management (basic)

**Route:** `/riders`  
**API:** `GET /riders`  
**What it shows:** table — name, phone, availability status, movement status, rating, current order. Read-only in Phase 1.

---

### Page 5 — Order Management (basic)

**Route:** `/orders`  
**API:** `GET /orders`, `POST /orders`, `POST /orders/bulk`  
**What it shows:** table — status, restaurant, customer, assigned rider, created/assigned timestamps. "Create Order" and "Bulk Create" buttons. Status badge (PENDING / ASSIGNED / PICKED_UP / DELIVERED).

---

### Page 6 — Dashboard (basic)

**Route:** `/`  
**API:** `GET /analytics`  
**What it shows:** 4 stat cards — Total Riders, Available Riders, Active Orders, Completed Orders. Auto-refreshes every 10s or updates via WS.

---

### Page 7 — Rider Map

**Route:** `/map/riders`  
**WS:** subscribes to `simulation:tick`  
**What it shows:**
- Map centered on Ranchi
- All 30–35 rider markers, color-coded: green (IDLE), orange (ACCEPTED — heading to restaurant), red (PICKED_UP — heading to customer)
- Restaurant pins (fixed)
- Pending/unassigned order markers
- Markers update live on every `simulation:tick` event

---

### Page 8 — Order Map

**Route:** `/map/orders/:id`  
**API:** `GET /orders/:id`  
**WS:** subscribes to `simulation:tick`, filters for the assigned rider  
**What it shows:**
- Restaurant pin
- Customer drop-off pin
- Assigned rider's live position
- Two-leg route line (rider → restaurant → customer), drawn from `order.polyline`
- Order status badge

**Phase 1 done when:** full loop works: login → see riders on Rider Map → create order → watch allocation → watch rider move to restaurant → PICKED_UP → rider moves to customer → DELIVERED.

---

## Phase 2 — Depth

**Goal:** the system is transparent and observable. Makes it look like a real ops tool.

### Page 9 — Allocation History

**Route:** `/allocation-history`  
**API:** `GET /allocation-history`  
**What it shows:** table — order ID, winning rider, final score, AI reason, per-factor breakdown (ETAR / rating / load sub-scores), candidates considered, timestamp. Sortable.

---

### Page 10 — Delivery Partner View

**Route:** `/partner`  
**API:** `GET /auth/me`, `PUT /riders/:id/status`, `PUT /orders/:id/accept`  
**What it shows:** assigned order card (restaurant name, customer address, status). Accept button. Toggle availability switch. Current location display.

---

### Extensions to Phase 1 pages

| Page | What to add |
|---|---|
| Dashboard | Avg pickup time, avg delivery time, throughput (orders/hr), per-rider fairness bar chart |
| Rider Management | Movement status column, current order link, recent workload (deliveries in last 60 min) |
| Order Management | Pending/queued orders tab, allocation reason + score on row expand, lifecycle timestamps |
| Rider Map | Confirm three-state colors work; add pending order markers if not already there |
| Order Map | Explicit leg annotations (leg 1 / leg 2), allocation reason on click |

---

## Phase 3 — Enhancements

Each is independent — pick in any order. Traffic-adaptive speed is the final one (requires road routing from Phase 2 seam).

| Enhancement | Where | Notes |
|---|---|---|
| **Weight-tuning sliders** | Rider Map sidebar | `PUT /config/weights`; watch allocations change live. Highest value — pull forward if time allows |
| **Re-queue visibility** | Rider Map | Flash an order back to pending when an ACCEPTED rider drops; show the re-assigned rider picking it up. Logic is Phase 1 core; this is the UI visibility |
| **SLA / stale-order flagging** | Rider Map + Dashboard | Highlight orders waiting > threshold in red |
| **Candidate comparison** | Order Map or Allocation History | Show runner-up score vs winner |
| **Queue-depth chart** | Dashboard | Timeseries of queue depth over the session |
| **Order cancellation** | Order Management | `DELETE /orders/:id` — only for PENDING orders |
| **Stale order backoff** | simulation.js | After `MAX_ALLOCATION_RETRIES` failed ticks, move order to back of queue |
| **nextOrderId offline handling** | simulation.js | Pre-assigned rider goes offline → clear `nextOrderId`, re-queue order at priority 0 |
| **Road routing (Phase 2 seam)** | routingService.js + simulation.js | Replace Haversine 2-point polyline with Mapbox Directions `driving` profile. Called once at assignment. Frontend unchanged. Required before traffic. |
| **Traffic-adaptive speed *(final)*** | routingService.js + simulation.js + OrderMap.jsx | **Single snapshot at allocation time** — Mapbox `driving-traffic` + `annotations=speed,congestion` called once for the winning rider. Per-tick distance budget = `segmentSpeed_ms * TICK_INTERVAL_S` (min 3 m/s fallback). ETAR candidate scoring stays Haversine-based. Backend streams road-accurate positions; frontend colors the route line by congestion level (green/yellow/red). See `backend/PROJECT_PHASES.MD §B13` for full implementation detail. |

---

## Build Order Summary

```
Phase 0  →  Phase 1  →  Phase 2  →  Phase 3
 (server)   (full UI)   (depth)     (polish)
```

| Phase | Deliverable |
|---|---|
| 0 — Foundation | Config, models, allocation engine, simulation, order generator, seed, server |
| 1 — MVP | Login + 7 CRUD pages + Rider Map + Order Map = full allocation loop working |
| 2 — Depth | Allocation History + Partner View + extensions to all Phase 1 pages |
| 3 — Enhancements | Weight sliders, re-queue UI, SLA flags, candidate comparison, charts, traffic-adaptive movement |

> **Minimum shippable:** Phase 0 + Phase 1. Everything above that raises the ceiling.
