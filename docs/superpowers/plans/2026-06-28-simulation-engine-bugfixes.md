# Simulation Engine Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 6 confirmed bugs in `backend/src/services/simulationEngine.js` / `backend/reseed.js` / `frontend/src/context/SimulationContext.jsx` documented in `docs/simulation_bugs.md`, per the design in `docs/superpowers/specs/2026-06-28-simulation-engine-bugfixes-design.md`.

**Architecture:** Each fix extracts the buggy inline logic into a small, named, mostly-pure helper function inside `simulationEngine.js`, then calls that helper from the (1 or 2) places it's needed. Helpers are exposed via a single `__internal` test-only export object at the bottom of the file — the real public API (`initSimulation`, `startSimulation`, etc.) is untouched.

**Tech Stack:** Node.js (ESM), Mongoose, Socket.IO, `node:test` (built into Node — zero new dependencies) for backend unit tests. Frontend fixes (SIM-BUG-4's listener half, SIM-BUG-5) are verified manually per the agreed testing strategy: automated tests for backend logic, manual verification for frontend.

## Global Constraints

- Zero new dependencies — use Node's built-in `node:test` + `node:assert/strict`. (Source: testing-strategy decision; backend `package.json` currently has no test framework at all.)
- No schema changes, no new endpoints, no changes to the allocation engine or H3 candidate-search radius. (Source: spec "Out of scope".)
- `RIDER_SPEED_KMH` and `TICK_INTERVAL_MS` already live in `backend/src/config/constants.js` — reuse them, do not redefine.
- All new backend helper functions added to `simulationEngine.js` stay as plain `function` declarations (not exported directly) and are exposed for tests only through one `__internal` object at the bottom of the file.
- This plan discovered a second, previously-undocumented occurrence of the SIM-BUG-1/SIM-BUG-2 pattern inside `_transitionToDelivered`'s next-order-chaining branch (~line 677-695 of the current file) — both occurrences are fixed by Task 1, using the same extracted helper.

---

### Task 1: Fix SIM-BUG-1 + SIM-BUG-2 — extract `_applyIncomingRoute`

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/services/simulationEngine.js`
- Test: `backend/test/services/applyIncomingRoute.test.js`

**Interfaces:**
- Produces: `_applyIncomingRoute(r, route) → boolean` — a private helper in `simulationEngine.js`, exposed to tests via `__internal._applyIncomingRoute`. Mutates the rider entry `r` (sets `r.legCoords`, `r.leg2Coords`, `r.legDuration_s`, `r.leg2Duration_s`, `r.currentSegmentIdx`, `r.distanceCoveredOnSegment`) and calls the existing private `_preAdvancePolyline(rider, meters)`. Returns `true` if the route was applied, `false` if dropped (rider status is neither `'ACCEPTED'` nor `'PICKED_UP'`).
- Produces: `__internal` — new named export from `simulationEngine.js`, an object exposing `_applyIncomingRoute` and `_preAdvancePolyline` for tests. Later tasks add more entries to this same object.

- [ ] **Step 1: Add the `test` script**

  In `backend/package.json`, add to `"scripts"`:
  ```json
  "test": "node --test"
  ```

- [ ] **Step 2: Write the failing tests**

  Create `backend/test/services/applyIncomingRoute.test.js`:
  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { haversine } from '../../src/utils/haversine.js';
  import { __internal } from '../../src/services/simulationEngine.js';

  const { _preAdvancePolyline, _applyIncomingRoute } = __internal;

  // [lng, lat] pairs — matches the GeoJSON order used throughout simulationEngine.js
  const POLYLINE = [
    [85.3000, 23.3000],
    [85.3010, 23.3000],
    [85.3020, 23.3000],
  ];

  function segmentMeters(a, b) {
    return haversine({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] }) * 1000;
  }

  test('_preAdvancePolyline stays within the first segment when distance is short', () => {
    const rider = { legCoords: POLYLINE, currentSegmentIdx: 0, distanceCoveredOnSegment: 0 };
    const seg0Len = segmentMeters(POLYLINE[0], POLYLINE[1]);

    _preAdvancePolyline(rider, seg0Len / 2);

    assert.equal(rider.currentSegmentIdx, 0);
    assert.ok(Math.abs(rider.distanceCoveredOnSegment - seg0Len / 2) < 0.01);
  });

  test('_preAdvancePolyline crosses into the next segment when distance exceeds the first', () => {
    const rider = { legCoords: POLYLINE, currentSegmentIdx: 0, distanceCoveredOnSegment: 0 };
    const seg0Len = segmentMeters(POLYLINE[0], POLYLINE[1]);

    _preAdvancePolyline(rider, seg0Len + 5);

    assert.equal(rider.currentSegmentIdx, 1);
    assert.ok(Math.abs(rider.distanceCoveredOnSegment - 5) < 0.01);
  });

  test('_preAdvancePolyline clamps at the end of the polyline', () => {
    const rider = { legCoords: POLYLINE, currentSegmentIdx: 0, distanceCoveredOnSegment: 0 };
    const totalLen = segmentMeters(POLYLINE[0], POLYLINE[1]) + segmentMeters(POLYLINE[1], POLYLINE[2]);

    _preAdvancePolyline(rider, totalLen + 1000);

    assert.equal(rider.currentSegmentIdx, POLYLINE.length - 1);
  });

  test('_applyIncomingRoute installs both legs and pre-advances when rider is ACCEPTED', () => {
    const rider = {
      status: 'ACCEPTED',
      legStartedAt: new Date(Date.now() - 2000), // 2s ago
      legCoords: [],
      leg2Coords: [],
      currentSegmentIdx: 0,
      distanceCoveredOnSegment: 0,
      legDuration_s: null,
      leg2Duration_s: null,
    };
    const route = {
      leg1Coords: POLYLINE,
      leg2Coords: [[85.3100, 23.3100], [85.3110, 23.3100]],
      leg1Duration_s: 300,
      leg2Duration_s: 200,
    };

    const applied = _applyIncomingRoute(rider, route);

    assert.equal(applied, true);
    assert.deepEqual(rider.legCoords, POLYLINE);
    assert.deepEqual(rider.leg2Coords, route.leg2Coords);
    assert.equal(rider.legDuration_s, 300);
    assert.equal(rider.leg2Duration_s, 200);
    // 2s of travel must move the rider off the start of the polyline (this is the SIM-BUG-1 regression check)
    assert.ok(rider.currentSegmentIdx > 0 || rider.distanceCoveredOnSegment > 0);
  });

  test('_applyIncomingRoute only installs leg2Coords when rider already picked up', () => {
    const rider = {
      status: 'PICKED_UP',
      legStartedAt: new Date(Date.now() - 1000),
      legCoords: [[85.3050, 23.3050], [85.3060, 23.3050]], // leg2 polyline already swapped in at pickup
      leg2Coords: [],
      currentSegmentIdx: 0,
      distanceCoveredOnSegment: 0,
      legDuration_s: 999,
      leg2Duration_s: 999,
    };
    const route = {
      leg1Coords: POLYLINE, // stale — rider already passed leg1, must NOT be applied
      leg2Coords: [[85.3050, 23.3050], [85.3060, 23.3050], [85.3070, 23.3050]],
      leg1Duration_s: 111,
      leg2Duration_s: 222,
    };

    const applied = _applyIncomingRoute(rider, route);

    assert.equal(applied, true);
    assert.deepEqual(rider.legCoords, route.leg2Coords);
    // This is the SIM-BUG-2 regression check — leg1-only fields must stay untouched
    assert.equal(rider.legDuration_s, 999);
    assert.equal(rider.leg2Duration_s, 999);
  });

  test('_applyIncomingRoute drops a stale route for a rider that already moved on', () => {
    const rider = {
      status: 'IDLE',
      legStartedAt: new Date(),
      legCoords: [],
      leg2Coords: [],
      currentSegmentIdx: 0,
      distanceCoveredOnSegment: 0,
    };
    const route = { leg1Coords: POLYLINE, leg2Coords: POLYLINE, leg1Duration_s: 1, leg2Duration_s: 1 };

    const applied = _applyIncomingRoute(rider, route);

    assert.equal(applied, false);
    assert.deepEqual(rider.legCoords, []);
  });
  ```

- [ ] **Step 3: Run the tests to verify they fail**

  Run: `cd backend && npm test`
  Expected: FAIL — `__internal` is not exported from `simulationEngine.js` (`TypeError: Cannot destructure property '_preAdvancePolyline' of 'undefined'` or similar).

- [ ] **Step 4: Add `_applyIncomingRoute` and the `__internal` export**

  In `backend/src/services/simulationEngine.js`, insert this new function immediately after `_preAdvancePolyline` (right before the `// Compute lat/lng from current segmentIdx...` comment that precedes `_positionFromPolyline`):
  ```js
  // Applies a freshly-fetched road route to a rider, pre-advancing along the polyline
  // for however much time has elapsed since the leg started (SIM-BUG-1) and only
  // touching the leg that's actually active for the rider's current status (SIM-BUG-2).
  // Pure aside from reading Date.now() — no DB/socket access, unit-testable directly.
  function _applyIncomingRoute(r, route) {
    if (r.status === 'ACCEPTED') {
      r.legCoords      = route.leg1Coords;
      r.leg2Coords     = route.leg2Coords;
      r.legDuration_s  = route.leg1Duration_s;
      r.leg2Duration_s = route.leg2Duration_s;
    } else if (r.status === 'PICKED_UP') {
      r.legCoords = route.leg2Coords;
    } else {
      return false; // order finished/cancelled before the route arrived — drop it
    }

    r.currentSegmentIdx        = 0;
    r.distanceCoveredOnSegment = 0;

    const elapsed_s     = (Date.now() - r.legStartedAt.getTime()) / 1000;
    const metersElapsed = (RIDER_SPEED_KMH / 3.6) * elapsed_s;
    _preAdvancePolyline(r, metersElapsed);
    return true;
  }
  ```

  At the very end of the file, after `_removeFromH3`, add:
  ```js

  // ─── Test-only exports ────────────────────────────────────────────────────────
  // Exposed for unit tests — not part of the public simulation API.
  export const __internal = {
    _applyIncomingRoute,
    _preAdvancePolyline,
  };
  ```

- [ ] **Step 5: Run the tests to verify they pass**

  Run: `cd backend && npm test`
  Expected: PASS — all 6 tests in `applyIncomingRoute.test.js` green.

- [ ] **Step 6: Replace both call sites with the new helper**

  First occurrence — inside `tick()`'s `getRoute().then()` callback. Replace:
  ```js
    ).then(route => {
        const r = riderState.get(winnerId);
        if (r && r.currentOrderId?.toString() === orderId) {
          r.legCoords              = route.leg1Coords;
          r.leg2Coords             = route.leg2Coords;
          r.currentSegmentIdx      = 0;
          r.distanceCoveredOnSegment = 0;
          r.legDuration_s          = route.leg1Duration_s;
          r.leg2Duration_s         = route.leg2Duration_s;
        }
        activeRoutes.set(orderId, {
  ```
  with:
  ```js
    ).then(route => {
        const r = riderState.get(winnerId);
        if (r && r.currentOrderId?.toString() === orderId) {
          _applyIncomingRoute(r, route);
        }
        activeRoutes.set(orderId, {
  ```

  Second occurrence — inside `_transitionToDelivered`'s next-order-chaining `getRoute().then()` callback. Replace:
  ```js
    ).then(route => {
        const r = riderState.get(riderId);
        if (r && r.currentOrderId?.toString() === nextIdStr) {
          r.legCoords              = route.leg1Coords;
          r.leg2Coords             = route.leg2Coords;
          r.currentSegmentIdx      = 0;
          r.distanceCoveredOnSegment = 0;
          r.legDuration_s          = route.leg1Duration_s;
          r.leg2Duration_s         = route.leg2Duration_s;
        }
        activeRoutes.set(nextIdStr, { riderId, leg1Coords: route.leg1Coords, leg2Coords: route.leg2Coords });
  ```
  with:
  ```js
    ).then(route => {
        const r = riderState.get(riderId);
        if (r && r.currentOrderId?.toString() === nextIdStr) {
          _applyIncomingRoute(r, route);
        }
        activeRoutes.set(nextIdStr, { riderId, leg1Coords: route.leg1Coords, leg2Coords: route.leg2Coords });
  ```

- [ ] **Step 7: Run the tests again to confirm nothing broke**

  Run: `cd backend && npm test`
  Expected: PASS — same 6 tests still green (this step doesn't add new tests, just confirms the call-site refactor didn't break the helper).

- [ ] **Step 8: Commit**

  ```bash
  git add backend/package.json backend/src/services/simulationEngine.js backend/test/services/applyIncomingRoute.test.js
  git commit -m "fix: stop rider dot teleporting and leg2 corruption when road route arrives late (SIM-BUG-1, SIM-BUG-2)"
  ```

---

### Task 2: Fix SIM-BUG-3 — extract `_routeEntryForRider`, restore `activeRoutes` in `hydrate()`

**Files:**
- Modify: `backend/src/services/simulationEngine.js`
- Test: `backend/test/services/routeEntryForRider.test.js`

**Interfaces:**
- Consumes: nothing new — reads only the rider-entry shape already produced by `_buildEntry`/`hydrate()` (`status`, `legCoords`, `leg2Coords`, `currentOrderId`, `_id`).
- Produces: `_routeEntryForRider(entry) → { riderId, leg1Coords, leg2Coords } | null`, a pure function. Adds `_routeEntryForRider` to the existing `__internal` export object from Task 1.

- [ ] **Step 1: Write the failing tests**

  Create `backend/test/services/routeEntryForRider.test.js`:
  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { __internal } from '../../src/services/simulationEngine.js';

  const { _routeEntryForRider } = __internal;

  const LEG1 = [[85.30, 23.30], [85.31, 23.30]];
  const LEG2 = [[85.31, 23.30], [85.32, 23.30]];

  test('returns the leg1/leg2 split for an ACCEPTED rider', () => {
    const entry = {
      _id: { toString: () => 'rider-1' },
      currentOrderId: { toString: () => 'order-1' },
      status: 'ACCEPTED',
      legCoords: LEG1,
      leg2Coords: LEG2,
    };

    assert.deepEqual(_routeEntryForRider(entry), {
      riderId: 'rider-1',
      leg1Coords: LEG1,
      leg2Coords: LEG2,
    });
  });

  test('returns leg1Coords empty and legCoords as leg2 for a PICKED_UP rider', () => {
    const entry = {
      _id: { toString: () => 'rider-2' },
      currentOrderId: { toString: () => 'order-2' },
      status: 'PICKED_UP',
      legCoords: LEG2,    // hydrate() already swapped legCoords to hold leg2 for PICKED_UP riders
      leg2Coords: [],
    };

    assert.deepEqual(_routeEntryForRider(entry), {
      riderId: 'rider-2',
      leg1Coords: [],
      leg2Coords: LEG2,
    });
  });

  test('returns null for an IDLE rider', () => {
    const entry = { _id: { toString: () => 'rider-3' }, currentOrderId: null, status: 'IDLE', legCoords: [], leg2Coords: [] };
    assert.equal(_routeEntryForRider(entry), null);
  });

  test('returns null when legCoords has fewer than 2 points (lerp fallback, no road route yet)', () => {
    const entry = {
      _id: { toString: () => 'rider-4' },
      currentOrderId: { toString: () => 'order-4' },
      status: 'ACCEPTED',
      legCoords: [],
      leg2Coords: [],
    };
    assert.equal(_routeEntryForRider(entry), null);
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd backend && npm test`
  Expected: FAIL — `_routeEntryForRider` is `undefined` on `__internal`.

- [ ] **Step 3: Add `_routeEntryForRider`**

  In `backend/src/services/simulationEngine.js`, insert this new function immediately after `_buildEntry` (right before the `// ─── Tick ───` section comment... actually before `async function hydrate()` — place it directly above `async function hydrate() {`):
  ```js
  // Reconstructs the activeRoutes entry for a rider rebuilt during hydrate() — pure,
  // no DB access, so it's unit-testable without mocking Mongoose.
  function _routeEntryForRider(entry) {
    if (!entry.currentOrderId || !entry.legCoords || entry.legCoords.length < 2) return null;
    if (entry.status === 'ACCEPTED') {
      return { riderId: entry._id.toString(), leg1Coords: entry.legCoords, leg2Coords: entry.leg2Coords ?? [] };
    }
    if (entry.status === 'PICKED_UP') {
      return { riderId: entry._id.toString(), leg1Coords: [], leg2Coords: entry.legCoords };
    }
    return null;
  }
  ```

  Update the `__internal` export at the bottom of the file to:
  ```js
  export const __internal = {
    _applyIncomingRoute,
    _preAdvancePolyline,
    _routeEntryForRider,
  };
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `cd backend && npm test`
  Expected: PASS — all 4 new tests green, plus the 6 from Task 1 still green.

- [ ] **Step 5: Call `_routeEntryForRider` from `hydrate()`**

  In `hydrate()`, find this line (it appears once, right after the rider reconstruction `if/else if/else` block):
  ```js
      riderState.set(id, entry);
  ```
  Replace it with:
  ```js
      riderState.set(id, entry);

      const routeEntry = _routeEntryForRider(entry);
      if (routeEntry) activeRoutes.set(entry.currentOrderId.toString(), routeEntry);
  ```

- [ ] **Step 6: Run the tests again to confirm nothing broke**

  Run: `cd backend && npm test`
  Expected: PASS — same tests as Step 4, still green.

- [ ] **Step 7: Commit**

  ```bash
  git add backend/src/services/simulationEngine.js backend/test/services/routeEntryForRider.test.js
  git commit -m "fix: restore activeRoutes for in-flight orders on server restart (SIM-BUG-3)"
  ```

---

### Task 3: Fix SIM-BUG-4 — emit `order:cancelled`, clean up frontend `routes` Map

**Files:**
- Modify: `backend/src/services/simulationEngine.js`
- Create: `backend/test/helpers/fakeQuery.js`
- Test: `backend/test/services/healOrphans.test.js`
- Modify: `frontend/src/context/SimulationContext.jsx`

**Interfaces:**
- Consumes: `ioRef` (existing module-level variable, set via `initSimulation(io)`).
- Produces: `fakeQuery(result)` in the new test helper — a chainable, awaitable stand-in for a Mongoose `Query` object (`.lean()`, `.select()`, `.populate()` all return another `fakeQuery(result)`), used to mock `Model.find(...)` in tests without a real database connection.
- Adds `_healOrphanedRiders` and `_healOrphanedOrders` to the `__internal` export object.

- [ ] **Step 1: Write the failing tests**

  Create `backend/test/helpers/fakeQuery.js`:
  ```js
  // Minimal stand-in for a Mongoose Query object — chainable (.lean()/.select()/.populate())
  // and awaitable, so tests can mock Model.find()/updateMany() without a real database.
  export function fakeQuery(result) {
    const promise = Promise.resolve(result);
    promise.lean     = () => fakeQuery(result);
    promise.select   = () => fakeQuery(result);
    promise.populate = () => fakeQuery(result);
    return promise;
  }
  ```

  Create `backend/test/services/healOrphans.test.js`:
  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import Order from '../../src/models/Order.js';
  import Rider from '../../src/models/Rider.js';
  import { __internal, initSimulation } from '../../src/services/simulationEngine.js';
  import { fakeQuery } from '../helpers/fakeQuery.js';

  const { _healOrphanedOrders, _healOrphanedRiders } = __internal;

  test('_healOrphanedOrders emits order:cancelled for each stuck PICKED_UP order', async (t) => {
    const stuckOrderId = '507f1f77bcf86cd799439011';
    const riderId      = '507f1f77bcf86cd799439012';

    t.mock.method(Order, 'find', (query) => {
      if (query.status === 'ASSIGNED')  return fakeQuery([]);
      if (query.status === 'PICKED_UP') return fakeQuery([{ _id: stuckOrderId, assignedRiderId: riderId }]);
      return fakeQuery([]);
    });
    t.mock.method(Rider, 'find', () => fakeQuery([])); // no rider is actively PICKED_UP → order is stuck
    t.mock.method(Order, 'updateMany', async () => ({}));

    const emitted = [];
    initSimulation({ on() {}, emit: (event, payload) => emitted.push({ event, payload }) });

    await _healOrphanedOrders();

    const cancelled = emitted.filter((e) => e.event === 'order:cancelled');
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].payload.orderId, stuckOrderId);
  });

  test('_healOrphanedOrders emits nothing when no orders are stuck', async (t) => {
    t.mock.method(Order, 'find', () => fakeQuery([]));
    t.mock.method(Rider, 'find', () => fakeQuery([]));
    t.mock.method(Order, 'updateMany', async () => ({}));

    const emitted = [];
    initSimulation({ on() {}, emit: (event, payload) => emitted.push({ event, payload }) });

    await _healOrphanedOrders();

    assert.equal(emitted.length, 0);
  });

  test('_healOrphanedRiders emits order:cancelled for orphaned riders stuck mid-delivery', async (t) => {
    const orphanedRiderId = '507f1f77bcf86cd799439013';
    const stuckOrderId    = '507f1f77bcf86cd799439014';

    t.mock.method(Rider, 'find', () => fakeQuery([{ _id: orphanedRiderId, name: 'Test Rider' }]));
    t.mock.method(Order, 'find', () => fakeQuery([{ _id: stuckOrderId }]));
    t.mock.method(Rider, 'updateMany', async () => ({}));
    t.mock.method(Order, 'updateMany', async () => ({}));

    const emitted = [];
    initSimulation({ on() {}, emit: (event, payload) => emitted.push({ event, payload }) });

    await _healOrphanedRiders();

    const cancelled = emitted.filter((e) => e.event === 'order:cancelled');
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].payload.orderId, stuckOrderId);
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd backend && npm test`
  Expected: FAIL — `_healOrphanedOrders`/`_healOrphanedRiders` are `undefined` on `__internal`.

- [ ] **Step 3: Add the emits in `_healOrphanedRiders`**

  Replace the whole function body with (adds one query + one emit block; the three `updateMany` calls are unchanged):
  ```js
  async function _healOrphanedRiders() {
    const orphaned = await Rider.find({
      availabilityStatus: 'ONLINE',
      status: { $in: ['ACCEPTED', 'PICKED_UP'] },
      currentOrderId: null,
    });
    if (!orphaned.length) return;

    const orphanedIds = orphaned.map(r => r._id);
    console.warn(`[sim] healing ${orphaned.length} orphaned rider(s):`, orphaned.map(r => r.name).join(', '));

    const toCancel = await Order.find(
      { assignedRiderId: { $in: orphanedIds }, status: 'PICKED_UP' }
    ).select('_id').lean();

    await Promise.all([
      // Reset orphaned riders to IDLE
      Rider.updateMany(
        { _id: { $in: orphanedIds } },
        { status: 'IDLE', currentOrderId: null, activeOrders: 0 }
      ),
      // ASSIGNED orders with no rider in-flight → re-queue as PENDING
      Order.updateMany(
        { assignedRiderId: { $in: orphanedIds }, status: 'ASSIGNED' },
        { $set: { status: 'PENDING', assignedRiderId: null, assignedAt: null } }
      ),
      // PICKED_UP orders → cancel (food was collected but delivery never completed)
      Order.updateMany(
        { assignedRiderId: { $in: orphanedIds }, status: 'PICKED_UP' },
        { $set: { status: 'CANCELLED', cancelledAt: new Date() } }
      ),
    ]);

    if (ioRef) {
      for (const o of toCancel) ioRef.emit('order:cancelled', { orderId: o._id.toString() });
    }
  }
  ```

- [ ] **Step 4: Add the emit in `_healOrphanedOrders`**

  Find the end of `_healOrphanedOrders` (the "Part 2" block):
  ```js
    console.warn(`[sim] cancelling ${toCancel.length} stuck PICKED_UP order(s)`);
    await Order.updateMany(
      { _id: { $in: toCancel.map(o => o._id) } },
      { $set: { status: 'CANCELLED', cancelledAt: new Date() } }
    );
  }
  ```
  Replace with:
  ```js
    console.warn(`[sim] cancelling ${toCancel.length} stuck PICKED_UP order(s)`);
    await Order.updateMany(
      { _id: { $in: toCancel.map(o => o._id) } },
      { $set: { status: 'CANCELLED', cancelledAt: new Date() } }
    );

    if (ioRef) {
      for (const o of toCancel) ioRef.emit('order:cancelled', { orderId: o._id.toString() });
    }
  }
  ```

  Update the `__internal` export at the bottom of the file to:
  ```js
  export const __internal = {
    _applyIncomingRoute,
    _preAdvancePolyline,
    _routeEntryForRider,
    _healOrphanedRiders,
    _healOrphanedOrders,
  };
  ```

- [ ] **Step 5: Run the tests to verify they pass**

  Run: `cd backend && npm test`
  Expected: PASS — all 3 new tests green, plus all prior tests still green.

- [ ] **Step 6: Add the frontend cleanup listener**

  In `frontend/src/context/SimulationContext.jsx`, immediately after the existing `order:delivered` listener block (`socket.on('order:delivered', ...)`), add:
  ```js
      socket.on('order:cancelled', ({ orderId }) => {
        setRoutes((prev) => {
          const next = new Map(prev);
          next.delete(orderId);
          return next;
        });
      });
  ```

- [ ] **Step 7: Manually verify the frontend half**

  No automated frontend test per the agreed testing strategy (backend logic gets automated tests; this is a one-line socket listener with no meaningful logic to assert beyond "the Map shrinks", which is already covered by the backend test proving the event fires with the right `orderId`). Verify by running the app:
  1. `cd backend && npm run dev` and `cd frontend && npm run dev`.
  2. Let an order reach `PICKED_UP`, then manually flip it to `CANCELLED` in MongoDB (or restart the backend mid-flight to trigger `_healOrphanedOrders`).
  3. Confirm the browser console (or a temporary `console.log` in the new listener) shows the `order:cancelled` event arriving and the order's polyline disappearing from `OrdersMap`.
  4. Remove any temporary `console.log` before committing.

- [ ] **Step 8: Commit**

  ```bash
  git add backend/src/services/simulationEngine.js backend/test/helpers/fakeQuery.js backend/test/services/healOrphans.test.js frontend/src/context/SimulationContext.jsx
  git commit -m "fix: emit order:cancelled so cancelled orders clear from the frontend routes Map (SIM-BUG-4)"
  ```

---

### Task 4: Fix SIM-BUG-5 — consume `order:status` so the OrderMap badge updates live

**Files:**
- Modify: `frontend/src/context/SimulationContext.jsx`
- Modify: `frontend/src/pages/OrderMap.jsx`

**Interfaces:**
- Produces: `orderStatusEvent` — new field on the `SimulationContext` value, shape `{ orderId, status, riderId, ts } | null`, updated every time the backend emits `order:status` (already emitted today from `_transitionToPickedUp`, no backend change needed here).
- Consumes (in `OrderMap.jsx`): `orderStatusEvent` from `useSimulation()`, and the existing `fetchOrder` function already defined in that file.

This bug needs no backend change — the backend already emits `order:status` (confirmed at `simulationEngine.js:583`). Per the agreed testing strategy this is frontend-only, so it's verified manually rather than with an automated test.

- [ ] **Step 1: Add `orderStatusEvent` state and listener in `SimulationContext.jsx`**

  Add a new state declaration alongside the existing ones:
  ```js
    const [orderStatusEvent, setOrderStatusEvent] = useState(null);
  ```

  Add a new listener, anywhere among the other `socket.on(...)` calls:
  ```js
      socket.on('order:status', (event) => {
        setOrderStatusEvent({ ...event, ts: Date.now() });
      });
  ```

  Update the provider value to include it:
  ```js
    <SimulationContext.Provider value={{ connected, riders, queueDepth, allocations, routes, orderStatusEvent }}>
  ```

- [ ] **Step 2: Consume it in `OrderMap.jsx`**

  Change:
  ```js
    const { riders } = useSimulation();
  ```
  to:
  ```js
    const { riders, orderStatusEvent } = useSimulation();
  ```

  Add a new effect immediately after the existing `useEffect(fetchOrder, [id]);` line:
  ```js
    useEffect(() => {
      if (orderStatusEvent?.orderId === id) fetchOrder();
    }, [orderStatusEvent, id]);
  ```

- [ ] **Step 3: Manually verify**

  1. `cd backend && npm run dev` and `cd frontend && npm run dev`.
  2. Open a single order's map page (`/map/orders/:id`) for an order currently `ASSIGNED`, and leave it open.
  3. Wait for the simulated rider to reach the restaurant (status badge should flip to `PICKED_UP` on its own, without a manual page refresh).
  4. Confirm the badge updates within roughly one tick (1s) of the backend log line `[sim] ... PICKED_UP`.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/context/SimulationContext.jsx frontend/src/pages/OrderMap.jsx
  git commit -m "fix: auto-refresh OrderMap status badge on order:status events (SIM-BUG-5)"
  ```

---

### Task 5: Fix SIM-BUG-6 — move Rishi and Manav into the Ranchi service area

**Files:**
- Modify: `backend/reseed.js`

**Interfaces:** None — data-only change, no function signatures involved.

- [ ] **Step 1: Update the coordinates**

  In `backend/reseed.js`, in the `RIDERS` array, replace:
  ```js
    { name: 'Rishi',     latitude: 26.8467, longitude: 80.9462 }, // Lucknow
    { name: 'Manav',     latitude: 25.4358, longitude: 81.8463 }, // Allahabad
  ```
  with:
  ```js
    { name: 'Rishi',     latitude: 23.3290, longitude: 85.3830 }, // Namkum
    { name: 'Manav',     latitude: 23.4020, longitude: 85.3540 }, // Booty More
  ```

- [ ] **Step 2: Re-seed and manually verify**

  1. `cd backend && node reseed.js`
  2. Confirm the script logs success with 9 riders inserted, no errors.
  3. Start the backend (`npm run dev`) and frontend (`npm run dev`), open `/map/riders`.
  4. Confirm Rishi and Manav now appear on-screen near Namkum/Booty More (east side of the Ranchi map), not off-screen.
  5. Let the simulation run for a few minutes (or create several bulk orders) and confirm both riders eventually get allocated an order — i.e. their status badge leaves `IDLE` at least once.

- [ ] **Step 3: Commit**

  ```bash
  git add backend/reseed.js
  git commit -m "fix: move Rishi and Manav into the Ranchi service area so they're reachable by allocation (SIM-BUG-6)"
  ```

---

## Plan Self-Review

**Spec coverage:** All 6 bugs from `docs/superpowers/specs/2026-06-28-simulation-engine-bugfixes-design.md` are covered — SIM-BUG-1/2 → Task 1, SIM-BUG-3 → Task 2, SIM-BUG-4 → Task 3, SIM-BUG-5 → Task 4, SIM-BUG-6 → Task 5. The spec's "Out of scope" items (schema changes, allocation engine changes) are correctly not touched anywhere.

**Placeholder scan:** No TBDs. All code blocks are complete and copy-pasteable. Manual verification steps (Tasks 3, 4, 5) give concrete commands and concrete expected observations rather than "add appropriate verification."

**Type/signature consistency:** `_applyIncomingRoute(r, route)` (Task 1) and `_routeEntryForRider(entry)` (Task 2) are used identically in their own task and never referenced elsewhere with a different name. The `__internal` export object is extended additively across Tasks 1→2→3 — each task's diff for that object only adds keys, never renames or removes one a prior task introduced, so executing tasks in order never breaks an earlier test.
