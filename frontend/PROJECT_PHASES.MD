# Frontend Build Phases — Delivery Partner Allocation Engine

Build top to bottom. Each phase depends on the previous.
Reference: `docs/FEATURES.MD`, `docs/FRONTEND_PAGES.MD`, `docs/API_ENDPOINTS.MD`.

**Current scaffold state:**
- Vite + React + MUI wired, `theme.js` exists
- `AppLayout.jsx` with `Sidebar.jsx` + `Topbar.jsx` — exists
- `AuthContext.jsx`, `ProtectedRoute.jsx` — exist as stubs (not wired yet)
- `AppRoutes.jsx` — exists but has no Login route, no protected wrapping, single `LiveMap` route
- `api/axios.js`, `api/endpoints.js` — exist but are empty TODOs
- Pages: `Dashboard.jsx`, `Riders.jsx`, `Orders.jsx`, `LiveMap.jsx`, `AllocationHistory.jsx`, `Settings.jsx` — all exist as stubs
- No Login page yet; no Customers page; no Restaurants page; no OrderMap page; no PartnerView page

---

## Two key questions

### Q1 — At which phase are WebSockets implemented?

**Backend side (when the server starts emitting):** Phases **B8 + B9**
- B8 (`simulation.js`) produces the events — `simulation:tick`, `order:assigned`, `order:delivered`
- B9 (`server.js` wiring) attaches Socket.IO to the Express server and gates the simulation on client connect/disconnect
- Neither alone is enough: B8 without B9 means events are emitted but no socket; B9 without B8 means a socket with nothing to broadcast

**Frontend side (when the client subscribes):** Phase **F8 (Rider Map)**
- `SimulationContext.jsx` is created here — it opens the Socket.IO connection, listens to `simulation:tick`, and exposes the live rider/queue state via `useSimulation()`
- F9 (Order Map) reuses the same context; it does not create a second connection

> **Bottom line:** WebSockets land in **B8+B9** on the backend and **F8** on the frontend.
> You cannot build F8 or F9 until B8+B9 are complete. F7 (Dashboard) can poll REST until then.

---

### Q2 — At which phase are real road directions and speed implemented?

The system has a **pluggable routing seam** — the `polyline` field on Order is always an array of `{lat,lng}` points. Both ETAR and the movement engine walk this array at constant speed, regardless of how many points it has.

| Phase | What changes | Where |
|---|---|---|
| **B7 / B8 (Phase 1 — now)** | `polyline` = 2 Haversine points `[{rider}, {restaurant}]` and `[{restaurant}, {customer}]`. Riders move in straight lines, may pass through buildings. Speed = constant **40 km/h**. | `orderGenerator.js` / `simulation.js` |
| **B12 enhancement (Phase 2)** | Replace the 2-point polyline with a real road polyline from **Mapbox Directions API** or **Google Routes API**. Backend calls the routing API at assignment time, gets back a full road geometry, stores it as `polyline` on the order. Rider movement now follows actual roads. Speed still 40 km/h (constant). Frontend changes **nothing** — it renders whatever array length comes back. | `simulation.js` assignment step |
| **Phase 3 (not in scope)** | Adjust `RIDER_SPEED_KMH` dynamically per road segment using a real-time traffic API (Mapbox Traffic, Google Traffic). ETAR becomes traffic-aware. This is a significant addition — constant 40 km/h is the deliberate Phase 1 decision. | `constants.js`, `allocationEngine.js`, `simulation.js` |

> **Bottom line:** straight-line Haversine is the current design. Real roads land in **B12** (backend only, frontend unchanged). Traffic-adaptive speed is **not in scope**.

---

## Phase F1 — Foundation wiring

**Backend prerequisite:** B1–B4 must be done — server running, CRUD routes returning data, so the axios interceptors and endpoints have real responses to test against.

Wire the infrastructure everything else depends on. No visible UI changes.

### `src/api/axios.js`
```js
import axios from 'axios';
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });
// Request interceptor: attach JWT from localStorage
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
// Response interceptor: redirect to /login on 401
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) window.location.href = '/login';
    return Promise.reject(err);
  }
);
export default api;
```

### `src/api/endpoints.js`
Define all API call functions here. Pages import from here — never call `api.get('/...')` directly in a component.

```js
import api from './axios';

// Auth
export const login        = (body)  => api.post('/auth/login', body);
export const getMe        = ()      => api.get('/auth/me');

// Riders
export const getRiders    = ()      => api.get('/riders');
export const getRider     = (id)    => api.get(`/riders/${id}`);
export const updateLocation = (id, body) => api.put(`/riders/${id}/location`, body);
export const updateStatus = (id, body)   => api.put(`/riders/${id}/status`, body);

// Restaurants
export const getRestaurants   = ()     => api.get('/restaurants');
export const createRestaurant = (body) => api.post('/restaurants', body);
export const deleteRestaurant = (id)   => api.delete(`/restaurants/${id}`);

// Customers
export const getCustomers   = ()     => api.get('/customers');
export const createCustomer = (body) => api.post('/customers', body);
export const deleteCustomer = (id)   => api.delete(`/customers/${id}`);

// Orders
export const getOrders    = (params) => api.get('/orders', { params });
export const getOrder     = (id)     => api.get(`/orders/${id}`);
export const createOrder  = ()       => api.post('/orders');
export const bulkOrders   = (count)  => api.post('/orders/bulk', { count });
export const acceptOrder  = (id)     => api.put(`/orders/${id}/accept`);

// Allocation
export const getAllocationHistory = () => api.get('/allocation-history');

// Config
export const getWeights   = ()     => api.get('/config/weights');
export const setWeights   = (body) => api.put('/config/weights', body);

// Analytics
export const getAnalytics = () => api.get('/analytics');
```

### `src/context/AuthContext.jsx`
Wire up the stub:
- State: `{ user, token, loading }`
- `login(email, password)`: call `endpoints.login`, save token in `localStorage`, set user
- `logout()`: clear token, clear user state
- `useEffect` on mount: if token in localStorage, call `getMe()` to rehydrate user

### `src/routes/ProtectedRoute.jsx`
Wire up the stub:
```jsx
// Redirects to /login if no token; shows nothing while auth loads
const { user, loading } = useAuth();
if (loading) return null;
if (!user) return <Navigate to="/login" replace />;
return <Outlet />;
```

### `src/routes/AppRoutes.jsx`
Restructure routes:
```
/login            → <Login />           (public)
/                 → <ProtectedRoute />  (all admin routes under this)
  /dashboard      → <Dashboard />
  /restaurants    → <Restaurants />
  /customers      → <Customers />
  /riders         → <Riders />
  /orders         → <Orders />
  /map/riders     → <RiderMap />
  /map/orders/:id → <OrderMap />
  /allocation-history → <AllocationHistory />
  /settings       → <Settings />
/partner          → <PartnerRoute />    (Phase 2 — partner login required)
  /partner/dashboard → <PartnerView />
```

### `src/config/navigation.js`
Update nav items to include Restaurants, Customers, and both map routes. Remove the old LiveMap entry.

**Done when:** auth flow compiles without error, protected routes redirect to `/login`, `endpoints.js` exports all functions.

---

## Phase F2 — Login page

**Backend prerequisite:** B10 (Auth) — `POST /auth/login` and `GET /auth/me` must exist.
Without B10, you can build the page but cannot test it end to end.

**File:** `src/pages/Login.jsx`  
**Route:** `/login` (public, redirects to `/dashboard` if already logged in)

- MUI `Card` centered on screen — email + password fields + Submit button
- On submit: call `endpoints.login()` → on success, `AuthContext.login()` → redirect to `/dashboard`
- Show inline error on 401 ("Invalid credentials")
- Style in `src/pages/Login.module.css` — no inline styles

**Done when:** you can log in and land on the dashboard; a wrong password shows an error; a logged-in user visiting `/login` is redirected.

---

## Phase F3 — Restaurant Management

**Backend prerequisite:** B4 (CRUD APIs) — restaurant routes (`GET /restaurants`, `POST /restaurants`, `DELETE /restaurants/:id`) must be live.

**File:** `src/pages/Restaurants.jsx`  
**Route:** `/restaurants`  
**Endpoints:** `getRestaurants`, `createRestaurant`, `deleteRestaurant`

- MUI `DataGrid` or table: columns — Name, Phone, Lat, Lng, Active badge, Actions
- "Add Restaurant" button → inline form or modal (Name, Phone, Latitude, Longitude)
- Soft-delete button per row (sets `isActive: false`; row disappears from active list)
- Fetch on mount; refetch after add/delete

**Done when:** you can add a restaurant, see it in the table, and soft-delete it.

---

## Phase F4 — Customer Management

**Backend prerequisite:** B4 (CRUD APIs) — customer routes must be live.

**File:** `src/pages/Customers.jsx`  
**Route:** `/customers`  
**Endpoints:** `getCustomers`, `createCustomer`, `deleteCustomer`

Identical structure to Restaurants. Columns: Name, Phone, Address, Lat, Lng, Active badge, Actions.

**Done when:** same gate as Phase F3.

---

## Phase F5 — Rider Management

**Backend prerequisite:** B4 (CRUD APIs) — rider routes (`GET /riders`, `GET /riders/:id`) must be live.
For statuses to change dynamically: B8 (Simulation) must also be running, but the page reads static DB data so B4 alone is enough for Phase 1.

**File:** `src/pages/Riders.jsx` (already exists as stub)  
**Route:** `/riders`  
**Endpoints:** `getRiders`

**Phase 1 (read-only):**
- Table columns: Name, Phone, Availability (ONLINE/OFFLINE badge), Movement Status (IDLE/ACCEPTED/PICKED_UP badge), Rating (stars or number), Current Order ID

**Phase 2 additions (extend when B8+B9 are live):**
- Statuses update live via `simulation:tick` instead of polling
- Current order link → opens Order Map (`/map/orders/:id`)
- Recent workload (deliveries in last 60 min)

**Done when:** rider list loads and shows correct statuses.

---

## Phase F6 — Order Management

**Backend prerequisite:** B4 (order CRUD) + B7 (order generator) must both be done — `createOrder()` uses B7's service-area validation. For orders to progress past PENDING: B6 (allocation engine) + B8 (simulation) must also be running.

**File:** `src/pages/Orders.jsx` (already exists as stub)  
**Route:** `/orders`  
**Endpoints:** `getOrders`, `createOrder`, `bulkOrders`

**Phase 1:**
- Table: Status badge (PENDING / ASSIGNED / PICKED_UP / DELIVERED), Restaurant name, Customer name, Assigned Rider, Created At
- "Create Order" button — calls `createOrder()`, refreshes list
- "Bulk Create" button → input for count → calls `bulkOrders(n)`, refreshes list
- Auto-refresh every 10s (or subscribe to WS `order:assigned` / `order:delivered` once B8+B9 are live)

**Phase 2 additions (extend later):**
- Pending/queued orders tab separate from active/delivered
- Row expand → allocation reason + score breakdown
- Lifecycle timestamps (assigned at, picked up at, delivered at)
- "Open on Order Map" link per row

**Done when:** you can create a single order and see it go PENDING → ASSIGNED → PICKED_UP → DELIVERED as the simulation runs.

---

## Phase F7 — Dashboard

**Backend prerequisite:** B11 (Analytics) — `GET /analytics` must be live.
The four counters work via polling without WebSockets. Live WS-driven updates arrive once B8+B9 are done, but polling every 10s is a valid Phase 1 approach.

**File:** `src/pages/Dashboard.jsx` (already exists as stub)  
**Route:** `/dashboard`  
**Endpoints:** `getAnalytics`

**Phase 1 — 4 stat cards:**
```
Total Riders | Available Riders | Active Orders | Completed Orders
```
- Fetch on mount; auto-refresh every 10s

**Phase 2 additions (extend when B8+B9 are live):**
- Replace polling with live queue-depth from `simulation:tick`
- Add: Avg pickup time, avg delivery time, throughput (orders/hr)
- Per-rider fairness bar chart (MUI Charts or recharts)

**Done when:** four cards show correct numbers that update as orders are delivered.

---

## Phase F8 — Rider Map ← Frontend WebSocket phase

**Backend prerequisite:** B8 (Simulation) + B9 (WebSocket server wiring) — both must be complete.
This is the phase where the Socket.IO client is wired up on the frontend.
Without B8+B9 there is nothing to subscribe to. Do not start this phase until the backend is broadcasting `simulation:tick`.

**File:** `src/pages/RiderMap.jsx` (new — replace the `LiveMap.jsx` stub)  
**Route:** `/map/riders`  
**WS event:** `simulation:tick`

**Setup — `src/context/SimulationContext.jsx` (new file):**
```js
// Opens ONE Socket.IO connection shared by both map pages.
// Exposes: { riders, queueDepth } via useSimulation() hook.
const socket = io(import.meta.env.VITE_API_URL);
socket.on('simulation:tick', ({ riders, queueDepth }) => { ... });
// Disconnect on provider unmount
```
Wrap the `AppLayout` in this provider so both RiderMap and OrderMap share the same connection.

**Install:** `socket.io-client`, `mapbox-gl`, `react-map-gl`  
**Add to `.env`:** `VITE_MAPBOX_TOKEN`, `VITE_SOCKET_URL`

**What the map shows:**
- All 30–35 rider markers, color-coded by movement status:
  - Green — `IDLE`
  - Orange — `ACCEPTED` (heading to restaurant)
  - Red — `PICKED_UP` (heading to customer)
- Restaurant pins — static, loaded once from `getRestaurants()`
- Pending order markers — from `queueDepth` count or `getOrders({ status: 'PENDING' })`
- Positions update live on every `simulation:tick` (every 1s)

**CSS:** all map styles in `RiderMap.module.css`. Map container needs explicit `height`.

**Done when:** 30+ riders appear on the Ranchi map; they move in real time; colors change with status; the map is never empty after seeding.

---

## Phase F9 — Order Map

**Backend prerequisite:** B4 (`GET /orders/:id`) + B8 + B9 (simulation + WebSocket).
The route line is drawn from `order.polyline` — in Phase 1 this is 2 Haversine points stored by B8. In Phase 2 (B12 backend enhancement) it becomes a full road polyline; this page renders it correctly either way with no changes.

**File:** `src/pages/OrderMap.jsx` (new)  
**Route:** `/map/orders/:id`  
**Endpoints:** `getOrder(id)`  
**WS event:** `simulation:tick` via `useSimulation()` (filter for assigned rider only)

**What the map shows:**
- Restaurant pin (from `order.restaurantLat/Lng`)
- Customer drop-off pin (from `order.customerLat/Lng`)
- Assigned rider's live position (from `simulation:tick`, matched by `order.assignedRiderId`)
- Route line — drawn from `order.polyline` (works for both 2-point Haversine and full road geometry)
- Status badge (PENDING / ASSIGNED / PICKED_UP / DELIVERED)

**Navigation:** "Open on Map" link in Orders page and Dashboard rows → `<Link to="/map/orders/${id}">`.

**Done when:** navigating to an order's map shows the correct pins and the rider moving along the route in real time.

---

## Phase F10 — Allocation History

**Backend prerequisite:** B6 (allocation engine) + B8 (simulation) — history records are written during the simulation's allocation step. Without both running, this table will be empty.

**File:** `src/pages/AllocationHistory.jsx` (already exists as stub)  
**Route:** `/allocation-history`  
**Endpoints:** `getAllocationHistory`

- Table: Order ID, Winning Rider, Final Score, ETAR Score, Rating Score, Load Score, Candidates Considered, AI Reason, Timestamp
- Sortable by score or timestamp
- Row expand to show full breakdown (individual scores + raw ETAR in seconds)

**Done when:** every past allocation decision appears with score breakdown and AI/template reason.

---

## Phase F11 — Delivery Partner View *(Phase 2)*

**Backend prerequisite:** B10 (Auth — partner role) + B11 (Analytics — includes `PUT /orders/:id/accept`).

**Files:** `src/pages/PartnerView.jsx`, `src/routes/PartnerRoute.jsx`  
**Route:** `/partner/dashboard`  
**Endpoints:** `getMe`, `getOrder(id)`, `acceptOrder(id)`, `updateStatus(id, body)`

- Same `/login` page, different role redirect (admin → `/dashboard`, partner → `/partner/dashboard`)
- Shows: assigned order card — restaurant name, address, customer address, current status
- "Accept Order" button → calls `acceptOrder(orderId)`
- Availability toggle (ONLINE / OFFLINE) → calls `updateStatus(riderId, { availabilityStatus })`

**`PartnerRoute.jsx`:** same as `ProtectedRoute` but checks `user.role === 'partner'`.

**Done when:** a partner can log in, see their assigned order, accept it, and toggle availability.

---

## Phase F12 — Settings / Weight Tuning *(Phase 2)*

**Backend prerequisite:** B6 (allocation engine) — `GET /config/weights` and `PUT /config/weights` are implemented as part of B6. Must be done before weight changes have any observable effect.

**File:** `src/pages/Settings.jsx` (already exists as stub)  
**Route:** `/settings`  
**Endpoints:** `getWeights`, `setWeights`

- Three sliders: ETAR weight, Rating weight, Load weight
- Auto-normalize on change so they always sum to 1
- "Save" button → `setWeights({ etar, rating, load })`

**Done when:** changing sliders and saving visibly affects which riders win in subsequent allocations (observable in Allocation History).

---

## Phase F13 — Enhancements *(Phase 3)*

| Enhancement | Backend needed | Where | What to build |
|---|---|---|---|
| **Weight sliders on Rider Map** | B6 already done | `RiderMap.jsx` sidebar | Pull sliders from Settings onto the map sidebar — tune live while watching allocations. Highest-value Phase 3 item. |
| **Re-queue visibility** | B12 (`order:requeued` WS event) | `RiderMap.jsx` | Flash order back to "pending" marker when ACCEPTED rider drops; show re-assigned rider picking it up. |
| **SLA flagging** | B12 (`isSlaBreached` on `simulation:tick`) | `RiderMap.jsx` + `Dashboard.jsx` | Highlight breached orders in red. |
| **Candidate comparison** | B12 (runner-up data in AllocationHistory) | `AllocationHistory.jsx` | Expand row to show top-3 candidates with individual scores. |
| **Queue-depth chart** | B8+B9 (already done at F8) | `Dashboard.jsx` | Buffer `queueDepth` from `simulation:tick` in `SimulationContext`; render as timeseries with recharts. |
| **Order cancellation** | B12 (DELETE /orders/:id) | `Orders.jsx` | Cancel button on PENDING rows. |
| **Traffic-adaptive route coloring** | B13 (`orderTraffic` on `simulation:tick`) | `OrderMap.jsx` | Color the route line by congestion: green = low, yellow = moderate, red = heavy/severe. Use Mapbox `line-gradient` or per-segment `<Layer>` with `line-color` data expression. Rider marker slows down naturally — no frontend speed math needed, the backend streams accurate positions. |

---

## File checklist (Phase 1 end state)

```
src/
  api/
    axios.js                  ← wired (F1)
    endpoints.js              ← wired (F1)
  context/
    AuthContext.jsx            ← wired (F1)
    SimulationContext.jsx      ← new (F8)
  pages/
    Login.jsx                  ← new (F2)
    Restaurants.jsx            ← new (F3)
    Customers.jsx              ← new (F4)
    Riders.jsx                 ← extended (F5)
    Orders.jsx                 ← extended (F6)
    Dashboard.jsx              ← extended (F7)
    RiderMap.jsx               ← new, replaces LiveMap (F8)
    OrderMap.jsx               ← new (F9)
    AllocationHistory.jsx      ← extended (F10)
    Settings.jsx               ← extended (F12, Phase 2)
  routes/
    AppRoutes.jsx              ← restructured (F1)
    ProtectedRoute.jsx         ← wired (F1)
  styles/
    *.module.css               ← one per page (no inline styles ever)
```

---

## Build order summary

| Frontend phase | Backend must have | Gate |
|---|---|---|
| F1 — Foundation wiring | B1–B4 | Auth compiles, API client ready, routes restructured |
| F2 — Login | B10 | Can log in, wrong password shows error |
| F3 — Restaurants | B4 | Add / list / soft-delete |
| F4 — Customers | B4 | Add / list / soft-delete |
| F5 — Riders | B4 | Rider list with status badges |
| F6 — Orders | B4 + B7 | Create orders; full lifecycle visible once B6+B8 run |
| F7 — Dashboard | B11 | Four stat cards polling correctly |
| **F8 — Rider Map** | **B8 + B9** | **WebSocket live — riders move on map** |
| F9 — Order Map | B4 + B8 + B9 | Single order tracked end to end |
| F10 — Allocation History | B6 + B8 | Full audit trail with scores |
| F11 — Partner View | B10 + B11 | Partner login, accept order, toggle availability |
| F12 — Settings/Weights | B6 | Weight sliders save and affect allocation |
| F13 — Enhancements | B12 per item | Per-item table above |

> **Frontend MVP gate:** F1–F9. The full allocation loop is visible end-to-end.
> F10–F12 make it credible. F13 makes it memorable.
>
> **Real road routing** lands in backend **B12** (Mapbox/Google Directions API replaces
> Haversine polyline). Frontend renders it unchanged. Traffic-adaptive speed is out of scope.
