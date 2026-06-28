# Simulation Engine Bug Fixes — Design

**Date:** 2026-06-28
**Source:** `docs/simulation_bugs.md` (code audit, confirmed against current code)
**Scope:** Backend only — `backend/src/services/simulationEngine.js`, `backend/reseed.js`, `frontend/src/context/SimulationContext.jsx`

## Context

The simulation engine has progressed past the Phase 1 Haversine-only model
(per `PROJECT_PHASES.MD`) into the road-routing phase (B12) with a
segment-traversal movement model (B13-style: `currentSegmentIdx` /
`distanceCoveredOnSegment`). All six bugs below are defects within that
existing architecture — none require restructuring it or skipping ahead in
the phase plan. `hydrate()` already implements the correct pre-advancement
pattern (`_preAdvancePolyline`); several bugs are simply that pattern not
being applied consistently elsewhere.

## Bugs and fixes

### 1. Rider dot teleports to route start (SIM-BUG-1)

**File:** `simulationEngine.js`, `getRoute().then()` callback (~line 468-477)

When the road-snapped route arrives, `currentSegmentIdx` and
`distanceCoveredOnSegment` are unconditionally reset to 0, snapping the rider
back to the start of the polyline even though they've been moving via lerp
for 1-3 seconds already.

**Fix:** Before resetting, compute
`elapsed_s = (Date.now() - winner.legStartedAt) / 1000` and call
`_preAdvancePolyline(r, elapsed_s * RIDER_SPEED_KMH / 3.6)` — the same
function `hydrate()` already calls correctly (lines 235, 266) — before
applying `legCoords`/`leg2Coords`.

### 2. Route overwrite corrupts leg2 if `getRoute()` resolves late (SIM-BUG-2)

**File:** `simulationEngine.js`, same callback (~line 470)

The guard only checks `r.currentOrderId?.toString() === orderId`, so if the
rider has already transitioned `ACCEPTED → PICKED_UP` (via fast lerp
completion) before the promise resolves, the callback overwrites
`r.legCoords` back to `leg1Coords` — sending the rider back toward the
restaurant instead of the customer.

**Fix:** Add a status check: only apply `leg1Coords`/`leg2Coords` together
if `r.status === 'ACCEPTED'`. If `r.status === 'PICKED_UP'`, apply only
`leg2Coords` to `r.legCoords` (the currently active leg), leave the rest
alone.

### 3. `activeRoutes` not restored after server restart (SIM-BUG-3)

**File:** `simulationEngine.js`, `hydrate()` (~line 197)

`activeRoutes.clear()` runs on hydrate, but is never repopulated for riders
already `ACCEPTED`/`PICKED_UP`. New WebSocket clients replay `activeRoutes`
on connect, so after a restart no `order:route` events fire and the
`OrdersMap` overview page shows no polylines until a fresh order is
assigned.

**Fix:** In `hydrate()`, after reconstructing each rider's in-memory entry,
also `activeRoutes.set(orderId, {...})` using that rider's `leg1Coords`/
`leg2Coords` from the DB — mirroring the snippet already documented in the
audit.

### 4. Cancelled orders never cleared from frontend `routes` Map (SIM-BUG-4)

**Files:** `simulationEngine.js` (`_healOrphanedRiders`, `_healOrphanedOrders`),
`frontend/src/context/SimulationContext.jsx`

No `order:cancelled` event is emitted when orders are cancelled, so the
frontend's `routes` Map only ever shrinks on `order:delivered`. Cancelled
orders accumulate indefinitely (memory leak, low severity, not currently
visible).

**Fix:** Emit `ioRef.emit('order:cancelled', { orderId })` from both
`_healOrphanedRiders()` and `_healOrphanedOrders()` wherever they currently
set an order to `CANCELLED`. Add a `socket.on('order:cancelled', ...)`
listener in `SimulationContext.jsx` that deletes the entry from `routes`,
mirroring the existing `order:delivered` handler.

### 5. `order:status` emitted but never consumed (SIM-BUG-5)

**Files:** `simulationEngine.js` (~line 583), `SimulationContext.jsx`

Backend emits `order:status` with `{ orderId, status: 'PICKED_UP', riderId }`
when a rider picks up food. No listener exists, so `OrderMap.jsx`'s status
badge (fetched once via REST on mount) goes stale until manual refresh.

**Fix:** Add a `socket.on('order:status', ...)` listener in
`SimulationContext.jsx` that exposes the event (e.g. a `lastOrderStatus`
value or a small pub/sub callback) so `OrderMap.jsx` can react. Since
`OrderMap` owns its own `order` state via REST fetch, the simplest
correct behavior is: when the event's `orderId` matches the currently
mounted order's id, call `fetchOrder()` again.

### 6. Two riders permanently idle — wrong city (SIM-BUG-6)

**File:** `backend/reseed.js` (RIDERS array, ~line 42-43)

Rishi (`26.8467, 80.9462`, Lucknow) and Manav (`25.4358, 81.8463`,
Allahabad) are ~500km and ~420km from Ranchi respectively — outside the H3
`gridDisk(restaurantHex, H3_CANDIDATE_K=2)` ring search radius (~4-5km) for
every restaurant, and off-screen on the Ranchi-centered map.

**Fix:** Replace their coordinates with in-bounds Ranchi-area points:
Rishi → Namkum (`23.3290, 85.3830`), Manav → Booty More (`23.4020,
85.3540`). Re-run `node reseed.js` after the change.

## Out of scope

- Frontend UX issues from `FRONTEND_MISTAKES.MD` — covered in a separate
  spec (`2026-06-28-frontend-ux-fixes-design.md`).
- No schema changes, no new endpoints, no changes to the allocation engine
  or H3 candidate-search radius itself.

## Testing approach

Each fix is independently verifiable by triggering its specific scenario
(assign an order and watch the dot on first route arrival; force a slow
route response and watch leg2; restart the server mid-simulation and check
`OrdersMap`; cancel an order and check the `routes` Map size; watch the
status badge update on pickup without refresh; confirm Rishi/Manav appear
on-screen and get allocated after reseed).
