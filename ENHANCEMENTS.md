# Enhancements — Order TTL Cancellation + Map Segregation + Orders Payload Fix

Working doc for the `enhancements` branch. Three small, independent changes.

---

## 1. Drop stale orders → `CANCELLED` (backend)

**Problem today:** when no rider is available, an order sits in `pendingQueue`
forever. `simulationEngine.js` `tick()` does `if (!eligible.length) continue;`
(line ~482), so the order is retried every tick indefinitely. `CANCELLED` exists
in the `Order` schema (`Order.js:14`, with `cancelledAt`) but the engine never
sets it — it is dead status.

**Desired behavior:** an order stays queued, but if no rider picks it up within a
TTL it is dropped and marked `CANCELLED`. It then appears as CANCELLED in the
Orders table (already supported by `StatusBadge`, `StatusBadge.jsx:18`) and
auto-drops off the Order Map (`OrdersMap.jsx:113` already excludes CANCELLED).

### Changes

1. **`backend/src/config/constants.js`** — add:
   ```js
   // Max wall-clock time an order may sit PENDING (waiting for a rider) before
   // it is dropped and marked CANCELLED. Tunable; kept short so it is observable.
   export const ORDER_TTL_MS = 180_000; // 180 s
   ```

2. **`backend/src/services/simulationEngine.js` `tick()`** — add a TTL sweep that
   runs each tick, before the allocation loop. For any pending order whose
   `queuedAt` (fallback `createdAt`) is older than `now − ORDER_TTL_MS`:
   - remove it from `pendingQueue` (allocation never touches it again),
   - DB write: `status: 'CANCELLED'`, `cancelledAt: now`, `assignedRiderId: null`,
   - emit `order:cancelled { orderId, reason: 'no_rider' }`,
   - `console.warn('[sim] order TTL expired → CANCELLED', id)`.

3. **Guard against false cancels on re-queue.** The orphan/heal paths
   (`_sweepOrphanedOrders`, `_healOrphanedRiders`, `_healOrphanedOrders`) return
   orders to `PENDING` with a stale `queuedAt`, which the sweep would cancel
   instantly. Reset `queuedAt = now` on every transition back to `PENDING`, so the
   TTL cleanly means "continuous time spent waiting for a rider."

**Not touched:** allocation scoring, H3 filtering, rider movement, and the rider
state machine are all unchanged. The sweep only removes never-servable orders.

---

## 2. Order Map shows only active riders (frontend)

**Problem today:** riders are rendered on **both** the Rider Map and the Order
Map (`OrdersMap.jsx:259` maps over all `riders`), so the two maps are redundant.

**Desired behavior / segregation:**
- **Rider Map** — unchanged. Whole fleet view (idle + active + offline).
- **Order Map** — keeps rider pins, but only **active** ones (ACCEPTED /
  PICKED_UP). A rider carries an `orderId` exactly when active, so:
  `riders.filter(r => r.orderId)` at `OrdersMap.jsx:259`. Idle riders drop off.

Result: Rider Map = whole fleet; Order Map = orders + only the riders tied to
them. No more duplicated full-fleet rendering.

---

## Out of scope (per product decisions)

- No toast and no cancelled map marker — cancelled shows only in the Orders table.
- No Orders-table polling change — appears CANCELLED on next load/refresh.
- No changes to the Rider Map.

## Config

| Setting | Value | Location |
|---|---|---|
| Order TTL | 180 s (`ORDER_TTL_MS = 180_000`) | `backend/src/config/constants.js` |

---

## 3. Orders list endpoint payload fix (backend performance)

**Problem today:** navigating to any order-heavy page (Orders table, Order Map) hangs
for ~5–6 s. Investigation by measurement (local backend, warm server, authenticated
GET) isolated it to a single endpoint:

| Endpoint | Time | Payload |
|---|---|---|
| `/api/riders` | 0.27 s | 18 KB |
| `/api/restaurants` | 0.11 s | 2.6 KB |
| `/api/customers` | 0.09 s | 2 KB |
| **`/api/orders`** | **7.97 s** | **3.53 MB** |
| `/api/allocation/history` | 0.20 s | 10 KB |

`/api/health` responds in 7 ms, so the Node event loop is **not** blocked — the
simulation `tick()` is cleared (in-memory state + fire-and-forget writes). Every
endpoint is fast except `/api/orders`.

**Root cause:** the `Order` schema embeds three large coordinate arrays — `polyline`,
`leg1Coords`, `leg2Coords` (hundreds of `[lng,lat]` points each), `Order.js:15,20,21`.
`getAllOrders` (`orderController.js:63-73`) returns **every order with every field** (no
projection, no `.lean()`), so the ever-growing set of DELIVERED/CANCELLED history drags
full polylines across Atlas → backend → browser: 3.53 MB, ~8 s (network transfer +
Mongoose hydration + JSON serialization).

**Why the arrays are safe to drop from this endpoint (verified):**
- **Orders table** (`Orders.jsx`) uses only scalar fields — never the coord arrays.
- **Order Map** (`OrdersMap.jsx`) draws routes from the live socket
  (`SimulationContext.routes` ← `order:route`), using REST `o.leg1Coords` only as a `??`
  fallback. The server **replays every active route on socket connect**
  (`simulationEngine.js:43-50`), so a freshly-loaded map already has coords for all
  active orders — the REST fallback is redundant.
- **Single-order detail map** (`OrderMap.jsx`) uses `getOrder(id)` → `getOrderById`, a
  **different** endpoint (not touched), so it keeps full coords.
- `polyline` is referenced by **no** frontend file — pure dead weight.

### Change (single file, ~3 lines)

**`backend/src/controllers/orderController.js`** — in `getAllOrders` (line 68), project
the heavy arrays out at the query level and skip hydration:

```js
const orders = await Order.find(filter)
  .sort({ createdAt: -1 })
  .select('-polyline -leg1Coords -leg2Coords')  // table doesn't use them; map gets them live over the socket
  .populate('assignedRiderId', 'name')
  .lean();
```

Projecting at the DB level means the arrays never leave Atlas → payload collapses to
tens of KB; `.lean()` removes hydration overhead. Expected: ~8 s → <300 ms.

**Not touched:** `getOrderById` (detail endpoint keeps coords), the `Order` schema
(fields still stored + emitted over socket), the simulation engine, other controllers.

### Verification

1. Save → nodemon restarts backend.
2. Re-run the timing probe (`curl -w '%{time_total}s %{size_download}'` on
   `/api/orders` with a minted token). Expect <300 ms, tens of KB.
3. Browser: Orders table loads fast; Order Map still draws active route lines (from the
   socket replay) with the simulation running; single Order Map route still renders
   (unchanged `getOrderById`).

### Out of scope (later)

The `orders` collection grows unbounded (all DELIVERED/CANCELLED kept forever). Fine for
a demo even after this fix; if the table ever feels heavy, add pagination/limit to
`getAllOrders` + the Orders table.
