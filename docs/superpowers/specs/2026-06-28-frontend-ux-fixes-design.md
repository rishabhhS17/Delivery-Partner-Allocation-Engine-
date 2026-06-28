# Frontend UX Fixes — Design

**Date:** 2026-06-28
**Source:** `docs/FRONTEND_MISTAKES.MD` (handwritten notes, confirmed against current code)
**Scope:** Frontend pages/components, plus two small backend additions
(customer order count, manual order creation) that the frontend needs.

## Context

These are UX corrections and small feature additions to pages that are
already built per `PROJECT_PHASES.MD` (F3-F6, F9). None of them require
new phases or violate the established conventions: no inline styles (all
styling stays in `.module.css` files), all API calls go through
`src/api/endpoints.js`, and new map UI reuses the existing `mapbox-gl` +
`react-map-gl` setup already used in `OrderMap.jsx` / `RiderMap.jsx`.

## Fixes

### 1. Hide "Map" link on delivered orders

**File:** `frontend/src/pages/Orders.jsx` (~line 137-147)

The Map button renders unconditionally for every order row. Wrap it in a
status check so it's omitted once `o.status === 'DELIVERED'`.

### 2. Create Order — specific restaurant/customer picker

**Files:** `frontend/src/pages/Orders.jsx`, `backend/src/controllers/orderController.js`,
`backend/src/services/orderGenerator.js`

Today `createOrder()` takes no arguments — it auto-picks a random
restaurant and a random in-service-area customer. There is no way to
assign a specific restaurant to a specific customer.

**Fix:**
- Backend: extend `createOrder()` to accept an optional
  `{ restaurantId, customerId }`. When provided, skip the random-pick and
  service-area-filter steps and snapshot those two records directly onto
  the order (manual selection is treated as an intentional override — no
  service-area validation applied). `POST /orders` accepts the same
  optional body fields.
- Frontend: add an "Assign Order" button next to the existing "Create
  Order" (random) button. Opens a dialog with two MUI `Autocomplete`
  fields (Restaurant, Customer), backed by `getRestaurants()` /
  `getCustomers()`, following the same `Dialog` pattern already used for
  Add Restaurant / Add Customer. Submits to the extended `POST /orders`.
- The existing one-click random "Create Order" button stays as-is.

### 3. Rider status label: "Accepted" → "Assigned"

**File:** `frontend/src/components/common/StatusBadge.jsx` (~line 7-12)

Display-only change: rename the rider `ACCEPTED` entry's `label` from
`'Accepted'` to `'Assigned'`. No backend enum, schema, or matching-logic
changes — `RiderMap.jsx`'s color-coding and other `status === 'ACCEPTED'`
checks are untouched.

### 4. Riders page — "Current order" column and Phone column

**File:** `frontend/src/pages/Riders.jsx` (~line 42, 46, 83, 91)

Two changes to the same table:
- Remove the `Phone` column (header + `r.phone` cell).
- Replace the raw `r.currentOrderId` ObjectId in the "Current order"
  column with the same short-code link pattern already used in
  `RiderMap.jsx`'s popup: `<Link to={`/map/orders/${id}`}>#{id.slice(-8).toUpperCase()}</Link>`,
  or `—` when there's no current order.

### 5. Customers page — columns and total-orders count

**Files:** `frontend/src/pages/Customers.jsx`, `backend/src/controllers/customerController.js`

- "Only active customers shown" — already correct; `getAllCustomers`
  filters `isActive: true`. No change needed.
- Remove the `Phone`, `Address`, and `Status` columns (header + cells).
- Add a `Total orders` column. Backend: extend `getAllCustomers` to
  attach an order count per customer via one aggregate query —
  `Order.aggregate([{ $match: { customerId: { $in: ids } } }, { $group: { _id: '$customerId', count: { $sum: 1 } } }])`
  — then join the counts onto the customer list in-memory by `_id`. One
  query regardless of customer count, no N+1 `countDocuments` calls.

### 6. OrderMap customer dot size

**File:** `frontend/src/pages/OrderMap.module.css` (`.pinCustomer`, currently
shared 14px rule with `.pinRestaurant`/`.pinRider`)

Split `.pinCustomer` into its own rule sized at 10px (down from 14px),
leaving `.pinRestaurant` and `.pinRider` at 14px.

### 7. Map-click location picker for Restaurant/Customer forms

**Files:** `frontend/src/pages/Restaurants.jsx`, `frontend/src/pages/Customers.jsx`,
new shared component e.g. `frontend/src/components/common/LocationPickerMap.jsx`

Both Add dialogs currently only have manual latitude/longitude `TextField`s.

**Fix:** Add a small shared `react-map-gl` map (same `mapbox-gl` setup as
`OrderMap.jsx`) inside both dialogs, below the existing lat/lng fields.
Clicking the map drops/moves a draggable marker and writes the clicked
coordinates into `form.latitude`/`form.longitude`. Typing directly into the
text fields continues to work and re-centers the marker — both input modes
stay in sync, satisfying the note's "choose on map OR type it in" request
without removing either option.

## Out of scope

- Backend simulation engine bugs — covered in the separate spec
  (`2026-06-28-simulation-engine-bugfixes-design.md`).
- Item 3's backend enum (`ACCEPTED` stays as the stored value; only the
  displayed label changes) — explicitly deferred per user decision to keep
  this a low-risk, display-only change.
- Geocoding / typed-address-to-coordinates conversion — manual lat/lng
  entry is kept instead, per user decision.

## Testing approach

Each item is a small, independently-verifiable UI change: hide/show the
Map button by order status; create an order via the new picker and confirm
the right restaurant/customer land on it; confirm the rider status badge
reads "Assigned"; confirm the Riders table's order link navigates to the
right Order Map; confirm Customers shows order counts and the trimmed
column set; visually confirm the smaller customer dot; click the picker
map in both dialogs and confirm the text fields update, and vice versa.
