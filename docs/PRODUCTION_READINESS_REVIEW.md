# Production Readiness Review — Delivery Partner Allocation Engine

**Original Review Date:** 2026-06-28
**Last Updated:** 2026-06-30
**Method:** Four parallel senior-engineer review passes (backend core/business-logic, backend API/auth/security/infra, frontend, cross-cutting testing/edge-cases/code-quality), followed by a code-state audit on 2026-06-30 to verify which issues remain open.

---

## What Changed Since Original Review

**Fixed:**
- `env.js` dotenv path is now correctly resolved (deployment risk resolved)
- `queueNextOrder` now takes `orderDoc` directly — no stale DB read for the busy-rider chaining path (partially addresses H1)
- Road-snapped polyline traversal fully implemented (Phase 2 sim movement complete)
- `_healOrphanedOrders` added to restart recovery, requeuing stuck ASSIGNED orders and cancelling orphaned PICKED_UP orders

**Still Open:** Everything else below.

---

## 1. Critical Bugs — STILL OPEN

| # | Issue | File:Line | Status |
|---|---|---|---|
| C1 | Two independent allocators (sim tick loop and `POST /allocation/allocate`) can double-assign the same rider. The manual allocate route's IDLE path writes the DB but never calls `_removeFromH3` or updates `riderState` — so the next sim tick still sees that rider as IDLE and re-assigns it. | `backend/src/routes/allocation.js:48-93`, `backend/src/services/simulationEngine.js:395-540` | **OPEN** |
| C2 | Manual allocate IDLE path never syncs in-memory state (`riderState`/`h3Buckets`). The BUSY path correctly calls `queueNextOrder`, but the IDLE path has no equivalent. Result: the rider stays in `h3Buckets` as available and gets double-allocated on the next tick. | `backend/src/routes/allocation.js:48-80` | **OPEN** |
| C3 | `authMiddleware.js`'s `protect` is a no-op stub (`(req,res,next)=>next()`) and is never mounted on any route. Every endpoint — including deletes, config/weight mutation, and simulation start/stop — is fully public. | `backend/src/middleware/authMiddleware.js:1-4`; not wired in `backend/src/routes/index.js` | **OPEN** |
| C4 | No fail-fast validation of required env vars. `ADMIN_PASSWORD` defaults to hardcoded `'admin123'`; missing `JWT_SECRET` causes `jwt.sign(undefined)` to throw at request time; missing `MONGODB_URI` causes silent boot failure. | `backend/src/config/env.js:12`, `backend/src/routes/auth.js:28-32` | **OPEN** |
| C5 | Frontend's `endpoints.js` gates a mock-auth/mock-CRUD fallback behind `import.meta.env.DEV`. Any dev build accepts `admin@demo.com`/`password` and fabricates successful writes for failed mutations. | `frontend/src/api/endpoints.js:12-39, 174-200, 215-241, 268-316` | **OPEN** |
| C6 | `acceptOrder` calls `PUT /orders/:id/accept`, which does not exist in the backend — guaranteed 404. Dead but broken code. | `frontend/src/api/endpoints.js:312`; no matching route in `backend/src/routes/orders.js` | **OPEN** |
| C7 | Essentially zero test coverage. No test runner configured in `frontend/package.json`. No integration/unit tests for allocation, controllers, or validators. | repo-wide | **OPEN** |

---

## 2. High Priority Bugs — STILL OPEN

| # | Issue | File:Line | Status |
|---|---|---|---|
| H1 | Race condition: if a rider changes status between the DB read in `allocation.js` and the `queueNextOrder` call, the order is removed from `pendingQueue` with wrong assumptions. Mitigated (no longer stale DB read for order data), but the rider-status race remains. | `backend/src/routes/allocation.js:27-108` | **OPEN (mitigated)** |
| H2 | All in-flight sim DB writes are fire-and-forget (`.catch(console.error)`) with no retry or rollback — a transient Mongo error silently diverges DB from live sim state. | `simulationEngine.js:500-524, 572-581, 609-611, 650-671, 712-720` | **OPEN** |
| H3 | `startAutoOrderJob`/`stopAutoOrderJob` are defined but never called anywhere. The advertised "auto-generates orders" behavior does not run. Generated orders also never call `addPendingOrder`, so they'd be invisible to the sim even if wired up. | `backend/src/services/orderGenerator.js:57-68` | **OPEN** |
| H4 | `computeEtar` can produce `NaN` on the manual allocation path if `leg1Duration_s`/`leg2Duration_s` are null (populated async by Mapbox). Sim tick loop is safe (IDLE-only candidates), but `allocation.js` queries all ONLINE riders including ACCEPTED/PICKED_UP. | `backend/src/services/allocationEngine.js:85-112`, `backend/src/routes/allocation.js:27-31` | **OPEN (sim tick safe, manual path still vulnerable)** |
| H5 | `H3_CANDIDATE_K=2` (~2-3km radius) permanently excludes distant seeded riders from ever being allocation candidates. No retry/escalation when an order finds zero candidates. | `backend/src/config/constants.js:2`, `backend/src/services/allocationEngine.js:15-21` | **OPEN** |
| H6 | No rate limiting anywhere — login endpoint especially is open to brute-force/CPU-exhaustion (bcrypt) attacks. | `backend/src/app.js`, `backend/src/routes/auth.js:11` | **OPEN** |
| H7 | No `helmet()`, no explicit request body size limit. | `backend/src/app.js:8-10` | **OPEN** |
| H8 | NoSQL injection: request body/query values flow unsanitized into Mongoose queries (e.g. `User.findOne({email})` in login, `req.query.status` as order filter). A body like `{"email":{"$ne":null}}` bypasses intended matching. | `backend/src/routes/auth.js:18`, `backend/src/controllers/orderController.js:33` | **OPEN** |
| H9 | CORS wide open (`cors()` with no origin option) on both the Express app and Socket.IO — any origin can call the API. | `backend/src/app.js:8`, `backend/src/server.js` | **OPEN** |
| H10 | Auth token stored in `localStorage` (readable by any same-origin JS) with no CSP configured — full token theft on any XSS. | `frontend/src/context/AuthContext.jsx`, `frontend/src/api/axios.js` | **OPEN** |
| H11 | Socket.IO has no auth (anyone who knows the WS URL can subscribe to the live fleet feed) and no "reconnecting" UX — stale rider positions keep rendering as if live on disconnect. | `frontend/src/context/SimulationContext.jsx:16-69` | **OPEN** |
| H12 | Coordinate field-name mismatch: `Dashboard.jsx:77` and `OrderMap.jsx:160` read `r.lng/r.lat` (socket tick shape), while REST API returns `latitude/longitude`. `OrdersMap.jsx` and `RiderMap.jsx` handle both inconsistently, with some lines using each form. | `Dashboard.jsx:77`, `OrderMap.jsx:160`, `OrdersMap.jsx:180,213`, `RiderMap.jsx:181,198` | **OPEN** |
| H13 | No `AbortController`/request cancellation on any data-fetching page — navigating away mid-request lets a stale response overwrite newer state. | All page components | **OPEN** |
| H14 | `addPendingOrder` silently no-ops when `!running` — orders created via API while the simulation is stopped are persisted as PENDING but never enter the live queue. API still returns `201 success`. | `simulationEngine.js:81-84`, `orderController.js:8` | **OPEN** |
| H15 | No idempotency protection on order creation — a slow request + refresh + retry creates duplicate orders for the same pair. | `frontend/src/pages/Orders.jsx:53-64`, `orderController.js:6-13` | **OPEN** |
| H16 | `getRoute`'s `fetch` call has no timeout/AbortController — a hung Mapbox connection hangs permanently, leaving that order's route un-persisted with no recovery. | `backend/src/services/routingService.js:17` | **OPEN** |
| H17 | Per-tick O(pending × candidates) allocation scan with unthrottled, un-batched Mapbox Directions calls — a bulk create of 100 orders can fire 100 simultaneous Mapbox requests in one tick. | `simulationEngine.js:395-540` | **OPEN** |

---

## 3. Medium Bugs

- **No order aging/escalation**: orders with zero nearby candidates stay PENDING forever; `MAX_ALLOCATION_RETRIES` is defined but never used. (`simulationEngine.js:395-409`)
- **`setWeights` has no validation** — `{etar:0, rating:0, load:0}` produces total=0, division produces `NaN` weights that poison every allocation until restart. (`constants.js:27-34`)
- **Allocation fairness**: no tie-break or starvation guard; load score only looks backward 60 min and ignores current in-flight assignment. (`allocationEngine.js:53-82`)
- **`pickPair` biased shuffle** (`Array.sort(()=>Math.random()-0.5)`) — biased restaurant selection. (`orderGenerator.js:11`)
- **Missing index** on `{assignedRiderId, status}` used by the orphan-healers; hydration cost grows with historical order volume. (`Order.js:34-35`)
- **`deliveryTimestamps` grows unbounded** per rider — never trimmed to the load window, scanned in full on every score computation. (`simulationEngine.js:594, 719`)
- **`Order.polyline`/`progress` fields are dead** — declared in schema, never written. (`Order.js`)
- **JWT**: 7-day expiry, no refresh/revocation, no `issuer`/`audience`/algorithm pinning on verify. (`auth.js`)
- **Error handler leaks `err.message`** (including raw Mongoose text) to clients in all environments. (`errorMiddleware.js`)
- **No request logging / correlation IDs** anywhere. (`app.js`)
- **Unbounded list endpoints**: riders/orders/restaurants/customers have no pagination. (`orderController.js:30-39`)
- **`/allocation/allocate`'s `orderId` isn't validated as an ObjectId** — 500 with leaked message on malformed input. (`allocation.js:17-18`)
- **Config/simulation-control endpoints have no auth or audit log** — anyone can rewrite allocation weights or stop the simulation. (`config.js`, `simulation.js`)
- **Context values recreated every render** in all four React contexts — unnecessary re-renders cascade to every consumer on every 1s tick. (`SimulationContext.jsx`)
- **No client-side form validation** on Restaurant/Customer lat/lng (empty → `Number('')`→ 0, creating stray `(0,0)` pins). (`Restaurants.jsx`, `Customers.jsx`)
- **Heavy map routes aren't code-split** — `mapbox-gl` loads in the initial bundle even for the Login page. (`AppRoutes.jsx`)
- **Dashboard/OrdersMap pollers keep running while the tab is backgrounded** with no overlap guard. (`Dashboard.jsx`, `OrdersMap.jsx`)
- **Corrupted/partial DB records can wedge the tick loop**: non-finite coordinates throw inside `latLngToCell` inside `setInterval` — that tick's allocation phase aborts, repeating every tick. (`simulationEngine.js:366`)
- **WebSocket-only transport** (`transports:['websocket']`, no polling fallback). (`SimulationContext.jsx:17`)

## 4. Low Priority Issues (deprioritized — not blocking)

- Validators don't validate `phone`/`address` format/length or the order `status` query filter against its enum.
- No deployment manifest (Dockerfile/Procfile) and no top-level `unhandledRejection`/`uncaughtException` handlers.
- Color-only status encoding on maps (accessibility gap).
- `Settings` weight inputs accept pasted negatives.
- Dashboard's relative "Xs ago" timestamps don't tick between events.
- `Login.jsx` has redundant declarative + imperative redirect paths.
- `Sidebar`'s active-item match uses `startsWith`, fragile if routes grow.
- `AllocationHistory` recomputes derived lists every render without `useMemo`.
- Bulk-order count input has no min/max/integer guard.
- Dead exports: `updateLocation`, `updateStatus`, `acceptOrder`, simulation-control functions in `endpoints.js` never imported anywhere; `MAX_ALLOCATION_RETRIES`/`MIN_RIDER_SPEED_MS` unused.
- Duplicated leg-duration formula and polyline-position math across 2-3 locations.
- `tick()` is a ~200-line function doing four distinct jobs — hard to test in isolation.
- Magic numbers scattered throughout.
- `availableRiders / totalRiders` mixes ONLINE+IDLE numerator with all-riders denominator — ring reads low when riders are simply offline.
- `bulkCreateOrders` has a bare empty `catch {}`.
- `seed.js` places riders/customers uniformly across whole bounding box, reproducing H5 starvation in fresh demos.
- `.env.example` files are incomplete (backend omits `MAPBOX_TOKEN`, frontend omits `VITE_WS_URL`).

---

## 5. What To Work On Next (Ordered by Impact)

### Tier 1 — Fix Before Any Demo/Deploy

1. **C1/C2 — Double-allocation race**: In `allocation.js` IDLE path, after the DB writes succeed, call an exported helper from `simulationEngine.js` that mirrors what the tick loop does: `_removeFromH3(winnerId, winner.h3Index)` + update `riderState` entry status to `'ACCEPTED'`. This is a small, surgical change.

2. **C3 — Wire up auth middleware**: Replace the `protect` stub with real JWT verification and mount it on all mutating/sensitive routes in `index.js`.

3. **C4 — Fail-fast env validation**: At server startup, check `MONGODB_URI` and `JWT_SECRET` and throw if missing. Remove `|| 'admin123'` default.

4. **H6/H7 — Rate limiting + security headers**: `npm install express-rate-limit helmet` and add both to `app.js` (2-line fix each).

5. **H9 — Lock CORS**: Pass an `origin` allowlist to `cors()` and Socket.IO's cors config.

### Tier 2 — Fix Before Sharing With Others

6. **H3 — Wire up auto-order job**: Call `startAutoOrderJob`/`stopAutoOrderJob` in the simulation start/stop routes (or decide to remove the feature entirely). Also fix `createOrder` in generator to call `addPendingOrder`.

7. **H14 — Misleading 201 when sim is stopped**: Either reject order creation with a 409 when `!running`, or queue orders in a persistent "pre-launch" list and drain them on `startSimulation`.

8. **C6 — Remove dead `acceptOrder`**: Either implement the backend route or remove the export.

9. **H16 — Add timeout to `getRoute`**: Wrap the `fetch` in an `AbortController` with a 10-second timeout.

10. **H8 — NoSQL injection**: Use `mongoose-sanitize` or manually coerce inputs to strings before using them in queries.

### Tier 3 — Code Quality / Robustness

11. **H12 — Normalize coordinate field names**: Standardize all rider objects (both REST responses and socket tick payloads) to one shape — either `lat/lng` or `latitude/longitude` everywhere. Update all frontend map consumers accordingly.

12. **H4 — NaN-ETAR guard on manual path**: In `allocation.js`, filter candidates to only IDLE riders before passing to `allocateOrder` (consistent with sim tick behavior). Or add a `Number.isFinite` guard in `computeEtar`.

13. **H2 — Fire-and-forget DB writes**: Wrap critical transitions (`_transitionToPickedUp`, `_transitionToDelivered`) in retry logic or at minimum log divergence with enough context to recover manually.

14. **Medium — `setWeights` validation**: Guard against `total === 0` before dividing.

15. **C5 — Remove or restrict mock-auth**: Either delete the DEV fallback in `endpoints.js` or restrict it to `localhost` only via URL check.

---

## 6. Production Readiness Checklist

- [ ] **C1/C2** — Fix manual-allocate IDLE path to sync in-memory `riderState`/`h3Buckets`
- [ ] **C3** — Implement and mount real JWT verification in `protect`; apply to all mutating/sensitive routes
- [ ] **C4** — Add env-var fail-fast at startup; remove `admin123` hardcoded default
- [ ] **C5** — Remove or restrict the `DEV`-mode mock-auth bypass in `endpoints.js`
- [ ] **C6** — Remove dead `acceptOrder` export or implement the missing backend route
- [ ] **C7** — Add a minimal integration/unit test suite (allocation scoring, controllers, validators)
- [ ] **H2** — Add retry or at-minimum structural logging for fire-and-forget DB writes
- [ ] **H3** — Wire up auto-order job in simulation start/stop routes; fix `createOrder` to call `addPendingOrder`
- [ ] **H4** — Guard manual allocation path against NaN ETAR (filter to IDLE-only or add `Number.isFinite` guard)
- [ ] **H5** — Consider increasing `H3_CANDIDATE_K` or add escalation when no candidates are found
- [ ] **H6** — Add rate limiting (especially `/auth/login`)
- [ ] **H7** — Add `helmet()` and an explicit body size limit
- [ ] **H8** — Sanitize/coerce all query/body inputs used in Mongoose filters
- [ ] **H9** — Lock CORS to an explicit origin allowlist (HTTP + Socket.IO)
- [ ] **H12** — Normalize rider coordinate field names across REST, socket tick, and all frontend consumers
- [ ] **H14** — Return a 409 (or drain on start) when orders are created while the simulation is stopped
- [ ] **H16** — Add a request timeout to `getRoute`'s Mapbox fetch
- [ ] **H10** — Add CSP; move auth token off `localStorage` or document the accepted tradeoff
- [ ] **H11** — Add Socket.IO connection auth and a "reconnecting" / staleness indicator on map pages

---

## 7. Scores (Current)

| Category | Score |
|---|---|
| Overall Backend | 4.5 / 10 |
| Overall Frontend | 6.5 / 10 |
| Architecture | 5.5 / 10 |
| Security | 2.5 / 10 |
| Performance | 5 / 10 |
| Scalability | 4.5 / 10 |
| Maintainability | 6 / 10 |
| Production Readiness | 3 / 10 |

*(Scores unchanged from original review — no critical or high-priority bugs have been resolved yet. Scores will be updated after Tier 1 fixes are complete.)*

---

## Would you deploy this project to production today?

**No.**

### Blockers (in priority order)

1. **Authentication is not enforced anywhere** — `protect` is a no-op stub never even mounted on a route (C3).
2. **Double-allocation race condition** (C1/C2) — manual allocate and the running sim tick can assign the same rider to two orders simultaneously.
3. **No fail-fast environment validation**, plus the hardcoded `admin123` fallback (C4).
4. **No rate limiting, no security headers, wide-open CORS, NoSQL-injectable inputs** (H6-H9) — fully open to the public internet.
5. **Zero meaningful test coverage** (C7) — no safety net for regressions.

Everything else in this report (performance, scalability, UI/UX, maintainability) is real but secondary to these five blockers.
