# Enhancements — Order TTL Cancellation + Map Segregation

Working doc for the `enhancements` branch. Two small, independent changes.

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
