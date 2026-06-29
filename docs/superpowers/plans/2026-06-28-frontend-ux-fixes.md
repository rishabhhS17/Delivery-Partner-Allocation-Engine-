# Frontend UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 7 items in `docs/FRONTEND_MISTAKES.MD`, per the design in `docs/superpowers/specs/2026-06-28-frontend-ux-fixes-design.md`.

**Architecture:** Seven independent, small UI/data changes across existing pages — no new pages, no routing changes. Two items (Create Order picker, Customers total-orders count) need a small backend addition each; both follow the existing controller/validator/service conventions already used for Restaurants/Customers.

**Tech Stack:** React + MUI + `react-map-gl`/`mapbox-gl` (frontend, all already installed), Express + Mongoose (backend, no new dependencies).

## Global Constraints

- No inline styles — every visual change goes through a `.module.css` file. (Source: project CLAUDE.md.)
- All frontend API calls go through `src/api/endpoints.js` — never call `api.get/post` directly in a page component. (Source: `PROJECT_PHASES.MD` F1 convention, already followed by every existing page.)
- No automated tests for this plan — per the agreed testing strategy, frontend changes are verified manually by running the dev servers. Each task ends with concrete manual verification steps instead of test code.
- New map UI reuses the existing `mapbox-gl` + `react-map-gl` setup already used in `OrderMap.jsx`/`RiderMap.jsx` — same `MAPBOX_TOKEN`/`MAP_STYLE` pattern, not a new library.
- Backend additions follow the existing per-resource convention: validators in `src/validators/<resource>Validator.js` returning an error string or `null` (see `customerValidator.js`), controllers calling them before touching the DB.

---

### Task 1: Hide the "Map" button on delivered orders

**Files:**
- Modify: `frontend/src/pages/Orders.jsx`

**Interfaces:** None — purely a render-condition change inside the existing `orders.map(...)` block.

- [ ] **Step 1: Make the change**

  In `frontend/src/pages/Orders.jsx`, replace:
  ```jsx
                <TableCell>
                  <Button size="small" startIcon={<MapPin size={14} />} onClick={() => navigate(`/map/orders/${o._id}`)}>Map</Button>
                </TableCell>
  ```
  with:
  ```jsx
                <TableCell>
                  {o.status !== 'DELIVERED' && (
                    <Button size="small" startIcon={<MapPin size={14} />} onClick={() => navigate(`/map/orders/${o._id}`)}>Map</Button>
                  )}
                </TableCell>
  ```

- [ ] **Step 2: Manually verify**

  1. `cd frontend && npm run dev` (backend can be mocked — this page already falls back to `MOCK_ORDERS` in dev when the API is unreachable; if you want real data, also run `cd backend && npm run dev`).
  2. Open `/orders`. Confirm rows with status `DELIVERED` show no Map button, and every other status still does.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/pages/Orders.jsx
  git commit -m "fix: hide Map link on delivered orders"
  ```

---

### Task 2: Shrink the customer dot on the Order Map

**Files:**
- Modify: `frontend/src/pages/OrderMap.module.css`

**Interfaces:** None — CSS-only.

- [ ] **Step 1: Make the change**

  Replace the whole file's pin rules:
  ```css
  .pinRestaurant,
  .pinCustomer,
  .pinRider {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-pill);
    border: 2px solid #ffffff;
    box-shadow: var(--shadow-sm);
  }

  .pinRestaurant { background: var(--warning); }
  .pinCustomer   { background: var(--violet); }
  .pinRider      { background: var(--link); }
  ```
  with:
  ```css
  .pinRestaurant,
  .pinRider {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-pill);
    border: 2px solid #ffffff;
    box-shadow: var(--shadow-sm);
  }

  .pinCustomer {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-pill);
    border: 2px solid #ffffff;
    box-shadow: var(--shadow-sm);
  }

  .pinRestaurant { background: var(--warning); }
  .pinCustomer   { background: var(--violet); }
  .pinRider      { background: var(--link); }
  ```

- [ ] **Step 2: Manually verify**

  1. `cd frontend && npm run dev`, open any order's map (`/map/orders/:id`).
  2. Confirm the violet customer dot is visibly smaller than the orange restaurant dot and the blue rider dot.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/pages/OrderMap.module.css
  git commit -m "fix: shrink oversized customer marker on Order Map"
  ```

---

### Task 3: Rename the rider status label "Accepted" to "Assigned"

**Files:**
- Modify: `frontend/src/components/common/StatusBadge.jsx`

**Interfaces:** None — display label only. The stored value (`'ACCEPTED'`) and every place that matches on it (`RiderMap.jsx` color logic, `Riders.jsx` status checks) are untouched.

- [ ] **Step 1: Make the change**

  In `STATUS_MAP.rider`, replace:
  ```js
      ACCEPTED: { color: 'warning', label: 'Accepted', icon: Navigation },
  ```
  with:
  ```js
      ACCEPTED: { color: 'warning', label: 'Assigned', icon: Navigation },
  ```

- [ ] **Step 2: Manually verify**

  1. `cd frontend && npm run dev`, open `/riders` with the backend simulation running.
  2. Confirm a rider with movement status `ACCEPTED` now shows a badge reading "Assigned" instead of "Accepted".

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/common/StatusBadge.jsx
  git commit -m "fix: relabel rider status badge from Accepted to Assigned"
  ```

---

### Task 4: Riders table — remove Phone column, link "Current order" to its map page

**Files:**
- Modify: `frontend/src/pages/Riders.jsx`
- Modify: `frontend/src/pages/Riders.module.css`

**Interfaces:** None new — reuses the existing `/map/orders/:id` route already used by `Orders.jsx` and `RiderMap.jsx`'s popup link.

- [ ] **Step 1: Add the `orderLink` style**

  In `frontend/src/pages/Riders.module.css`, add:
  ```css
  .orderLink {
    color: var(--link);
    text-decoration: none;
    font-weight: 500;
  }

  .orderLink:hover {
    text-decoration: underline;
  }
  ```

- [ ] **Step 2: Update the imports and column count**

  In `frontend/src/pages/Riders.jsx`, replace:
  ```jsx
  import { useEffect, useState } from 'react';
  import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button } from '@mui/material';
  import { RefreshCw } from 'lucide-react';
  import PageHeader from '../components/common/PageHeader';
  import StatusBadge from '../components/common/StatusBadge';
  import EmptyState from '../components/common/EmptyState';
  import { NoRidersIllustration } from '../components/common/illustrations';
  import { SkeletonRows } from '../components/common/Skeleton';
  import { getRiders } from '../api/endpoints';
  import styles from './Riders.module.css';

  const COLUMNS = 6;
  ```
  with:
  ```jsx
  import { useEffect, useState } from 'react';
  import { Link } from 'react-router-dom';
  import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button } from '@mui/material';
  import { RefreshCw } from 'lucide-react';
  import PageHeader from '../components/common/PageHeader';
  import StatusBadge from '../components/common/StatusBadge';
  import EmptyState from '../components/common/EmptyState';
  import { NoRidersIllustration } from '../components/common/illustrations';
  import { SkeletonRows } from '../components/common/Skeleton';
  import { getRiders } from '../api/endpoints';
  import styles from './Riders.module.css';

  const COLUMNS = 5;
  ```

- [ ] **Step 3: Update the table header**

  Replace:
  ```jsx
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Rating</TableCell>
              <TableCell>Availability</TableCell>
              <TableCell>Movement</TableCell>
              <TableCell>Current order</TableCell>
            </TableRow>
  ```
  with:
  ```jsx
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Rating</TableCell>
              <TableCell>Availability</TableCell>
              <TableCell>Movement</TableCell>
              <TableCell>Current order</TableCell>
            </TableRow>
  ```

- [ ] **Step 4: Update the table row**

  Replace:
  ```jsx
            {status === 'ready' && riders.map((r) => (
              <TableRow key={r._id}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.phone}</TableCell>
                <TableCell className={styles.rating}>{r.rating}</TableCell>
                <TableCell>
                  <span className={styles.availabilityBadge} data-online={String(r.availabilityStatus === 'ONLINE')}>
                    {r.availabilityStatus === 'ONLINE' ? 'Online' : 'Offline'}
                  </span>
                </TableCell>
                <TableCell><StatusBadge kind="rider" status={r.status} /></TableCell>
                <TableCell className={styles.rating}>{r.currentOrderId ?? '—'}</TableCell>
              </TableRow>
            ))}
  ```
  with:
  ```jsx
            {status === 'ready' && riders.map((r) => (
              <TableRow key={r._id}>
                <TableCell>{r.name}</TableCell>
                <TableCell className={styles.rating}>{r.rating}</TableCell>
                <TableCell>
                  <span className={styles.availabilityBadge} data-online={String(r.availabilityStatus === 'ONLINE')}>
                    {r.availabilityStatus === 'ONLINE' ? 'Online' : 'Offline'}
                  </span>
                </TableCell>
                <TableCell><StatusBadge kind="rider" status={r.status} /></TableCell>
                <TableCell className={styles.rating}>
                  {r.currentOrderId ? (
                    <Link to={`/map/orders/${r.currentOrderId}`} className={styles.orderLink}>
                      #{r.currentOrderId.slice(-8).toUpperCase()}
                    </Link>
                  ) : '—'}
                </TableCell>
              </TableRow>
            ))}
  ```

- [ ] **Step 5: Manually verify**

  1. `cd backend && npm run dev` and `cd frontend && npm run dev`.
  2. Open `/riders`. Confirm there is no Phone column, and the table now has 5 columns total.
  3. For a rider currently on a delivery, confirm "Current order" shows a short `#XXXXXXXX` link (not a raw Mongo ObjectId) and clicking it navigates to that order's `/map/orders/:id` page.
  4. For an `IDLE` rider, confirm the cell shows `—`.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/pages/Riders.jsx frontend/src/pages/Riders.module.css
  git commit -m "fix: remove Phone column and link Current order to its map page on Riders table"
  ```

---

### Task 5: Customers page — drop Phone/Address/Status columns, add Total orders

**Files:**
- Modify: `backend/src/controllers/customerController.js`
- Modify: `frontend/src/pages/Customers.jsx`
- Modify: `frontend/src/pages/Customers.module.css`

**Interfaces:**
- Produces: `getAllCustomers` response shape changes from `Customer` documents to `{ ...customer, totalOrders: number }`. No route or query-param changes — frontend's existing `getCustomers()` call in `endpoints.js` needs no change since it already does `res.data?.data ?? res.data` passthrough.

- [ ] **Step 1: Add the order-count aggregate to the backend**

  In `backend/src/controllers/customerController.js`, add the import:
  ```js
  import Order from '../models/Order.js';
  ```
  (alongside the existing `import Customer from '../models/Customer.js';`)

  Replace:
  ```js
  export const getAllCustomers = async (req, res, next) => {
    try {
      const customers = await Customer.find({ isActive: true }).sort({ createdAt: -1 });
      res.json({ success: true, data: customers });
    } catch (err) {
      next(err);
    }
  };
  ```
  with:
  ```js
  export const getAllCustomers = async (req, res, next) => {
    try {
      const customers = await Customer.find({ isActive: true }).sort({ createdAt: -1 }).lean();

      const counts = await Order.aggregate([
        { $match: { customerId: { $in: customers.map((c) => c._id) } } },
        { $group: { _id: '$customerId', count: { $sum: 1 } } },
      ]);
      const countByCustomerId = new Map(counts.map((c) => [c._id.toString(), c.count]));

      const withCounts = customers.map((c) => ({
        ...c,
        totalOrders: countByCustomerId.get(c._id.toString()) ?? 0,
      }));

      res.json({ success: true, data: withCounts });
    } catch (err) {
      next(err);
    }
  };
  ```

- [ ] **Step 2: Add the `.rating` numeric-column style**

  In `frontend/src/pages/Customers.module.css`, add (matches the existing numeric-column style already used in `Riders.module.css`):
  ```css
  .rating {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum';
  }
  ```

- [ ] **Step 3: Update the table header and row in `Customers.jsx`**

  Replace:
  ```jsx
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Address</TableCell>
              <TableCell>Latitude</TableCell>
              <TableCell>Longitude</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
  ```
  with:
  ```jsx
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Latitude</TableCell>
              <TableCell>Longitude</TableCell>
              <TableCell>Total orders</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
  ```

  Replace:
  ```jsx
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
  ```
  with:
  ```jsx
            {status === 'ready' && customers.map((c) => (
              <TableRow key={c._id}>
                <TableCell>{c.name}</TableCell>
                <TableCell>{c.latitude}</TableCell>
                <TableCell>{c.longitude}</TableCell>
                <TableCell className={styles.rating}>{c.totalOrders ?? 0}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="error" onClick={() => handleDelete(c._id, c.name)} aria-label="Remove customer">
                    <Trash2 size={16} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
  ```

  Update the column count constant — replace `const COLUMNS = 7;` with `const COLUMNS = 5;`.

  Note: the Add Customer dialog's Phone/Address `TextField`s are untouched — the spec only removes these from the *table display*, the data is still collected and stored.

- [ ] **Step 4: Manually verify**

  1. `cd backend && npm run dev` and `cd frontend && npm run dev`.
  2. Open `/customers`. Confirm there is no Phone, Address, or Status column, and a new "Total orders" column shows a number (0 for customers with no orders yet).
  3. Create a few orders for a specific customer (Task 7 in the other implementation plan adds a UI for this; until then, `bulkOrders` plus checking which customer landed an order also works), refresh `/customers`, and confirm that customer's count increased.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/controllers/customerController.js frontend/src/pages/Customers.jsx frontend/src/pages/Customers.module.css
  git commit -m "feat: show total orders per customer, drop Phone/Address/Status columns"
  ```

---

### Task 6: Map-click location picker for Restaurant/Customer creation

**Files:**
- Create: `frontend/src/components/common/LocationPickerMap.jsx`
- Create: `frontend/src/components/common/LocationPickerMap.module.css`
- Modify: `frontend/src/pages/Restaurants.jsx`
- Modify: `frontend/src/pages/Customers.jsx`

**Interfaces:**
- Produces: `LocationPickerMap({ latitude, longitude, onPick })` — a React component. `latitude`/`longitude` are numbers or `undefined` (no pin shown yet). `onPick(lat, lng)` is called both on map click and on marker drag-end.

- [ ] **Step 1: Create the shared map-picker component**

  Create `frontend/src/components/common/LocationPickerMap.jsx`:
  ```jsx
  import 'mapbox-gl/dist/mapbox-gl.css';
  import Map, { Marker } from 'react-map-gl';
  import styles from './LocationPickerMap.module.css';

  const MAPBOX_TOKEN   = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  const MAP_STYLE      = 'mapbox://styles/mapbox/dark-v11';
  const RANCHI_DEFAULT = { longitude: 85.33, latitude: 23.35, zoom: 12 };

  export default function LocationPickerMap({ latitude, longitude, onPick }) {
    const hasPin = Number.isFinite(latitude) && Number.isFinite(longitude);
    const initialView = hasPin ? { longitude, latitude, zoom: 13 } : RANCHI_DEFAULT;

    return (
      <div className={styles.mapWrap}>
        <Map
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={initialView}
          mapStyle={MAP_STYLE}
          onClick={(e) => onPick(e.lngLat.lat, e.lngLat.lng)}
        >
          {hasPin && (
            <Marker
              longitude={longitude}
              latitude={latitude}
              anchor="center"
              draggable
              onDragEnd={(e) => onPick(e.lngLat.lat, e.lngLat.lng)}
            >
              <div className={styles.pin} />
            </Marker>
          )}
        </Map>
      </div>
    );
  }
  ```

  Create `frontend/src/components/common/LocationPickerMap.module.css`:
  ```css
  .mapWrap {
    width: 100%;
    height: 220px;
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .pin {
    width: 16px;
    height: 16px;
    border-radius: var(--radius-pill);
    background: var(--link);
    border: 2px solid #ffffff;
    box-shadow: var(--shadow-sm);
  }
  ```

- [ ] **Step 2: Wire it into the Add Restaurant dialog**

  In `frontend/src/pages/Restaurants.jsx`, add the import:
  ```jsx
  import LocationPickerMap from '../components/common/LocationPickerMap';
  ```

  Replace:
  ```jsx
          <TextField label="Latitude" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} size="small" fullWidth />
          <TextField label="Longitude" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} size="small" fullWidth />
        </DialogContent>
  ```
  with:
  ```jsx
          <TextField label="Latitude" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} size="small" fullWidth />
          <TextField label="Longitude" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} size="small" fullWidth />
          <LocationPickerMap
            latitude={form.latitude ? Number(form.latitude) : undefined}
            longitude={form.longitude ? Number(form.longitude) : undefined}
            onPick={(lat, lng) => setForm((f) => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }))}
          />
        </DialogContent>
  ```

- [ ] **Step 3: Wire it into the Add Customer dialog**

  In `frontend/src/pages/Customers.jsx`, add the same import and apply the identical replacement (same old/new text as Step 2, in this file's "Add customer" `DialogContent` block instead).

- [ ] **Step 4: Manually verify**

  1. `cd frontend && npm run dev`.
  2. Open `/restaurants`, click "Add restaurant". Confirm a small map appears below the Longitude field, centered on Ranchi.
  3. Click anywhere on the map — confirm a pin drops there AND the Latitude/Longitude text fields update to match.
  4. Drag the pin to a new spot — confirm the text fields update again.
  5. Manually type new Latitude/Longitude values — confirm the pin moves to match.
  6. Repeat steps 2-5 on `/customers` → "Add customer".

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/components/common/LocationPickerMap.jsx frontend/src/components/common/LocationPickerMap.module.css frontend/src/pages/Restaurants.jsx frontend/src/pages/Customers.jsx
  git commit -m "feat: add map-click location picker to Restaurant/Customer creation forms"
  ```

---

### Task 7: Create Order — specific restaurant/customer picker

**Files:**
- Create: `backend/src/validators/orderValidator.js`
- Modify: `backend/src/services/orderGenerator.js`
- Modify: `backend/src/controllers/orderController.js`
- Modify: `frontend/src/api/endpoints.js`
- Modify: `frontend/src/pages/Orders.jsx`
- Modify: `frontend/src/pages/Orders.module.css`

**Interfaces:**
- Produces: `createOrder({ restaurantId, customerId } = {})` in `orderGenerator.js` — when both ids are given, skips the random/service-area pairing and uses those records directly; when neither is given, behaves exactly as before (random pairing). Throws if only one of the two is given (caught by the new validator before this function is even called) or if a given id doesn't resolve to an active record.
- Produces: `validateManualOrderCreate({ restaurantId, customerId }) → string | null`, following the existing validator pattern in `customerValidator.js`.
- Produces (frontend): `createOrder(body)` in `endpoints.js` — `body` is now optional; `createOrder()` (no args) is unchanged behavior, `createOrder({ restaurantId, customerId })` is new.

- [ ] **Step 1: Add the validator**

  Create `backend/src/validators/orderValidator.js`:
  ```js
  export function validateManualOrderCreate({ restaurantId, customerId }) {
    if (!restaurantId && !customerId) return null; // random creation — nothing to validate
    if (!restaurantId || !customerId) return 'both restaurantId and customerId are required when assigning a specific order';
    return null;
  }
  ```

- [ ] **Step 2: Extend `orderGenerator.js` to support a specific pair**

  In `backend/src/services/orderGenerator.js`, add the imports already present (`Restaurant`, `Customer` are already imported) — no new imports needed.

  Replace:
  ```js
  export async function createOrder() {
    const { restaurant, customer } = await pickPair();

    return Order.create({
  ```
  with:
  ```js
  export async function createOrder({ restaurantId, customerId } = {}) {
    const { restaurant, customer } = restaurantId && customerId
      ? await pickSpecificPair(restaurantId, customerId)
      : await pickPair();

    return Order.create({
  ```

  Add this new function immediately after `pickPair()` (before `export async function createOrder`):
  ```js
  async function pickSpecificPair(restaurantId, customerId) {
    const [restaurant, customer] = await Promise.all([
      Restaurant.findOne({ _id: restaurantId, isActive: true }),
      Customer.findOne({ _id: customerId, isActive: true }),
    ]);
    if (!restaurant) throw new Error('Restaurant not found or inactive');
    if (!customer)   throw new Error('Customer not found or inactive');
    return { restaurant, customer };
  }
  ```

- [ ] **Step 3: Pass the body through in the controller**

  In `backend/src/controllers/orderController.js`, add the import:
  ```js
  import { validateManualOrderCreate } from '../validators/orderValidator.js';
  ```

  Replace:
  ```js
  export const createSingleOrder = async (req, res, next) => {
    try {
      const order = await createOrder();
      addPendingOrder(order);
      res.status(201).json({ success: true, data: order });
    } catch (err) {
      next(err);
    }
  };
  ```
  with:
  ```js
  export const createSingleOrder = async (req, res, next) => {
    try {
      const { restaurantId, customerId } = req.body ?? {};
      const validationError = validateManualOrderCreate({ restaurantId, customerId });
      if (validationError) { res.status(400); throw new Error(validationError); }

      const order = await createOrder({ restaurantId, customerId });
      addPendingOrder(order);
      res.status(201).json({ success: true, data: order });
    } catch (err) {
      next(err);
    }
  };
  ```

- [ ] **Step 4: Update the frontend endpoint**

  In `frontend/src/api/endpoints.js`, replace:
  ```js
  export const createOrder = async () => {
    try {
      return await api.post('/orders');
    } catch (error) {
      if (import.meta.env.DEV) {
        const newOrder = {
          _id: 'order-' + Date.now(),
          restaurantName: MOCK_RESTAURANTS[0].name,
          customerName: MOCK_CUSTOMERS[0].name,
          status: 'PENDING',
          assignedRiderId: null,
          createdAt: new Date().toISOString(),
        };
        MOCK_ORDERS.push(newOrder);
        return { data: newOrder };
      }
      throw error;
    }
  };
  ```
  with:
  ```js
  export const createOrder = async (body) => {
    try {
      return await api.post('/orders', body);
    } catch (error) {
      if (import.meta.env.DEV) {
        const restaurant = body?.restaurantId
          ? MOCK_RESTAURANTS.find((r) => r._id === body.restaurantId) ?? MOCK_RESTAURANTS[0]
          : MOCK_RESTAURANTS[0];
        const customer = body?.customerId
          ? MOCK_CUSTOMERS.find((c) => c._id === body.customerId) ?? MOCK_CUSTOMERS[0]
          : MOCK_CUSTOMERS[0];
        const newOrder = {
          _id: 'order-' + Date.now(),
          restaurantName: restaurant.name,
          customerName: customer.name,
          status: 'PENDING',
          assignedRiderId: null,
          createdAt: new Date().toISOString(),
        };
        MOCK_ORDERS.push(newOrder);
        return { data: newOrder };
      }
      throw error;
    }
  };
  ```

- [ ] **Step 5: Add the `dialogForm` style to Orders.module.css**

  In `frontend/src/pages/Orders.module.css`, add (matches the pattern already used in `Customers.module.css`/`Restaurants.module.css`):
  ```css
  .dialogForm {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding-top: var(--space-xs);
    min-width: 320px;
  }
  ```

- [ ] **Step 6: Add the Assign Order dialog to `Orders.jsx`**

  Replace the import block:
  ```jsx
  import { useEffect, useState } from 'react';
  import { useNavigate } from 'react-router-dom';
  import { Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, TextField } from '@mui/material';
  import { RefreshCw, Plus, Layers, MapPin } from 'lucide-react';
  import PageHeader from '../components/common/PageHeader';
  import StatusBadge from '../components/common/StatusBadge';
  import EmptyState from '../components/common/EmptyState';
  import { NoOrdersIllustration } from '../components/common/illustrations';
  import { SkeletonRows } from '../components/common/Skeleton';
  import Spinner from '../components/common/Spinner';
  import { useToast } from '../context/ToastContext';
  import { getOrders, createOrder, bulkOrders } from '../api/endpoints';
  import styles from './Orders.module.css';
  ```
  with:
  ```jsx
  import { useEffect, useState } from 'react';
  import { useNavigate } from 'react-router-dom';
  import {
    Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, TextField,
    Dialog, DialogTitle, DialogContent, DialogActions, Autocomplete,
  } from '@mui/material';
  import { RefreshCw, Plus, Layers, MapPin, Link2 } from 'lucide-react';
  import PageHeader from '../components/common/PageHeader';
  import StatusBadge from '../components/common/StatusBadge';
  import EmptyState from '../components/common/EmptyState';
  import { NoOrdersIllustration } from '../components/common/illustrations';
  import { SkeletonRows } from '../components/common/Skeleton';
  import Spinner from '../components/common/Spinner';
  import { useToast } from '../context/ToastContext';
  import { getOrders, createOrder, bulkOrders, getRestaurants, getCustomers } from '../api/endpoints';
  import styles from './Orders.module.css';
  ```

  Add new state, immediately after the existing `const [bulkCreating, setBulkCreating] = useState(false);` line:
  ```jsx
    const [assignOpen, setAssignOpen] = useState(false);
    const [assigning, setAssigning] = useState(false);
    const [restaurants, setRestaurants] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [selectedRestaurant, setSelectedRestaurant] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
  ```

  Add a new effect immediately after the existing `useEffect(fetchOrders, []);` line:
  ```jsx
    useEffect(() => {
      if (!assignOpen) return;
      getRestaurants().then((res) => setRestaurants(res.data ?? []));
      getCustomers().then((res) => setCustomers(res.data ?? []));
    }, [assignOpen]);
  ```

  Add a new handler immediately after the existing `handleBulkCreate` function:
  ```jsx
    const handleAssign = async () => {
      if (!selectedRestaurant || !selectedCustomer) return;
      setAssigning(true);
      try {
        await createOrder({ restaurantId: selectedRestaurant._id, customerId: selectedCustomer._id });
        setAssignOpen(false);
        setSelectedRestaurant(null);
        setSelectedCustomer(null);
        fetchOrders();
        toast.success('Order assigned');
      } catch {
        toast.error('Could not assign order');
      } finally {
        setAssigning(false);
      }
    };
  ```

  Add the new button to the `PageHeader`'s `action` block — replace:
  ```jsx
            <Button variant="contained" startIcon={creating ? <Spinner size="sm" /> : <Plus size={16} />} onClick={handleCreate} disabled={creating}>
              Create order
            </Button>
          </Box>
        }
      />
  ```
  with:
  ```jsx
            <Button variant="contained" startIcon={creating ? <Spinner size="sm" /> : <Plus size={16} />} onClick={handleCreate} disabled={creating}>
              Create order
            </Button>
            <Button variant="outlined" startIcon={<Link2 size={16} />} onClick={() => setAssignOpen(true)}>
              Assign order
            </Button>
          </Box>
        }
      />
  ```

  Add the new dialog immediately before the closing `</Box>` at the end of the component's returned JSX (right after the `</TableContainer>`):
  ```jsx
      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)}>
        <DialogTitle>Assign order</DialogTitle>
        <DialogContent className={styles.dialogForm}>
          <Autocomplete
            options={restaurants}
            getOptionLabel={(r) => r.name}
            value={selectedRestaurant}
            onChange={(_, value) => setSelectedRestaurant(value)}
            renderInput={(params) => <TextField {...params} label="Restaurant" size="small" />}
          />
          <Autocomplete
            options={customers}
            getOptionLabel={(c) => c.name}
            value={selectedCustomer}
            onChange={(_, value) => setSelectedCustomer(value)}
            renderInput={(params) => <TextField {...params} label="Customer" size="small" />}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignOpen(false)} disabled={assigning}>Cancel</Button>
          <Button variant="contained" onClick={handleAssign} disabled={assigning || !selectedRestaurant || !selectedCustomer}>
            {assigning ? <Spinner size="sm" /> : 'Assign'}
          </Button>
        </DialogActions>
      </Dialog>
  ```

- [ ] **Step 7: Manually verify**

  1. `cd backend && npm run dev` and `cd frontend && npm run dev`.
  2. Open `/orders`, click "Create order" — confirm the existing random-order behavior still works unchanged.
  3. Click "Assign order" — confirm a dialog opens with two searchable dropdowns (Restaurant, Customer).
  4. Pick a specific restaurant and a specific customer, click "Assign" — confirm a new order appears in the table with exactly that restaurant name and customer name.
  5. In `/customers`, confirm that customer's "Total orders" count (from Task 5) increased by one.
  6. Try POSTing `{ restaurantId: '<id>' }` with no `customerId` directly (e.g. via curl/Postman) — confirm a 400 response with the validator's message, not a 500.

- [ ] **Step 8: Commit**

  ```bash
  git add backend/src/validators/orderValidator.js backend/src/services/orderGenerator.js backend/src/controllers/orderController.js frontend/src/api/endpoints.js frontend/src/pages/Orders.jsx frontend/src/pages/Orders.module.css
  git commit -m "feat: add Assign Order dialog for picking a specific restaurant/customer pair"
  ```

---

## Plan Self-Review

**Spec coverage:** All 7 items from `docs/superpowers/specs/2026-06-28-frontend-ux-fixes-design.md` are covered 1:1 — Task 1→item 1, Task 2→item 6, Task 3→item 3, Task 4→item 4, Task 5→item 5, Task 6→item 7, Task 7→item 2. The spec's "Out of scope" notes (backend `ACCEPTED` enum unchanged, no geocoding) are respected — Task 3 only changes the display label, Task 6 keeps manual lat/lng entry alongside the map click.

**Placeholder scan:** No TBDs. Every step shows the literal before/after code or the exact new file content; manual verification steps list concrete actions and concrete expected results.

**Type/signature consistency:** `createOrder({ restaurantId, customerId })` has the same shape on both the backend (`orderGenerator.js`, `orderController.js`) and frontend (`endpoints.js`, `Orders.jsx`) across Task 7's steps. `LocationPickerMap`'s `onPick(lat, lng)` signature (Task 6) is called identically from both `Restaurants.jsx` and `Customers.jsx`. `r.currentOrderId`/`c.totalOrders` field names introduced in Tasks 4 and 5 match what the corresponding backend response actually returns (`currentOrderId` already existed on the Rider API response; `totalOrders` is the exact key added in Task 5 Step 1).

**Task ordering note:** Task 5 (customer order count) and Task 7 (order assignment picker) are independent — Task 5 does not require Task 7 to have shipped first; the manual verification for Task 5 uses `bulkOrders` as a stand-in until Task 7 lands, and Task 7's own verification (Step 7.5) re-confirms the count once both are in place.
