# Production Readiness Review — Delivery Partner Allocation Engine

**Date:** 2026-06-28
**Method:** Four parallel senior-engineer review passes (backend core/business-logic, backend API/auth/security/infra, frontend, cross-cutting testing/edge-cases/code-quality), each reading every file in its domain on the current worktree (`bugfix-ux-implementation`, includes all recent SIM-BUG and frontend-UX fixes).
**Scope:** Read-only analysis. No code was modified as part of this review.

---

## 1. Critical Bugs

| # | Issue | File:Line | Domain |
|---|---|---|---|
| C1 | Two independent allocators (sim tick loop and `POST /allocation/allocate`) mutate the same Rider/Order rows with no shared lock or compare-and-swap — can double-assign the same rider/order. | `backend/src/services/simulationEngine.js:422-563`, `backend/src/routes/allocation.js:15-122` | Backend Core |
| C2 | The manual-allocate route's IDLE-assignment branch never updates in-memory `riderState`/`h3Buckets` — the sim tick loop still sees that rider as IDLE and will assign it a second order; the route's order never advances past ASSIGNED until a restart. | `backend/src/routes/allocation.js:48-93` | Backend Core |
| C3 | `authMiddleware.js`'s `protect` is a no-op stub (`(req,res,next)=>next()`) and is **never even mounted** on any route. Every endpoint — including deletes, config/weight mutation, and simulation start/stop — is fully public, compounded by wildcard CORS (`origin:'*'`) on both HTTP and Socket.IO. | `backend/src/middleware/authMiddleware.js:1-4`; not wired in `backend/src/routes/index.js`; `backend/src/app.js:8`; `backend/src/server.js:13` | Backend API/Security (confirmed independently by 2 of 4 agents) |
| C4 | No fail-fast validation of required env vars. Missing `MONGODB_URI` is logged and silently skipped (app boots in a broken half-state); missing `JWT_SECRET` causes `jwt.sign(undefined)` to throw at request time; `ADMIN_PASSWORD` defaults to the hardcoded `'admin123'`. | `backend/src/config/env.js:8-14`, `backend/src/config/db.js:6-9`, `backend/src/routes/auth.js:28-32,53` | Backend API/Security |
| C5 | Frontend's `endpoints.js` gates an entire mock-auth/mock-CRUD fallback layer behind `import.meta.env.DEV` only. Any build/run with dev mode active (e.g. `vite preview`, a misconfigured CI artifact) accepts a documented demo login (`admin@demo.com`/`password`) and fabricates "successful" writes for failed mutations. | `frontend/src/api/endpoints.js:12-39, 174-200, 215-241, 268-316` | Frontend |
| C6 | `frontend/src/api/endpoints.js`'s `acceptOrder` calls `PUT /orders/:id/accept`, which does not exist on the backend (`backend/src/routes/orders.js` has no such route) — guaranteed 404 if ever wired up; currently dead but broken code. | `frontend/src/api/endpoints.js:318`; no matching route in `backend/src/routes/orders.js` | Cross-cutting |
| C7 | Essentially zero test coverage outside three new unit-test files added in the recent bug-fix round (`simulationEngine.js` internal helpers). Zero coverage on: allocation scoring math, order generation, every controller/route, every validator, and the entire frontend (no test runner configured in `frontend/package.json`). | repo-wide | Cross-cutting |

## 2. High Priority Bugs

| # | Issue | File:Line | Domain |
|---|---|---|---|
| H1 | `queueNextOrder` deletes a pre-assigned order from `pendingQueue` based on a stale DB read of "rider is busy"; if the rider actually went IDLE in the same window, the order is permanently lost from the in-memory queue (orphaned until restart). | `backend/src/services/simulationEngine.js:89-102`, `backend/src/routes/allocation.js:95-108` | Backend Core |
| H2 | In-memory sim state advances synchronously on every transition, but the corresponding DB writes are fire-and-forget (`.catch(console.error)`) with no retry/rollback — a transient Mongo error silently diverges DB from the live simulation until the next restart's healing pass. | `simulationEngine.js:522-547, 595-604, 632-634, 673-694, 730-738` | Backend Core |
| H3 | `startAutoOrderJob`/`stopAutoOrderJob` are never called anywhere — the advertised "auto-generates orders" behavior does not run. Even if wired up, the generator's `createOrder()` call never calls `addPendingOrder`, so generated orders would be invisible to the live allocator until the next restart. | `backend/src/services/orderGenerator.js:67-80` (dead) | Backend Core |
| H4 | `computeEtar` divides by `leg1Duration_s`/`leg2Duration_s`, which are optional schema fields populated asynchronously after a Mapbox call resolves. If a candidate's route hasn't resolved yet, the division produces `NaN`, corrupting `Math.max(...)` and the entire score ranking for that allocation call (manual-allocate path only). | `backend/src/services/allocationEngine.js:90-103` | Backend Core |
| H5 | `H3_CANDIDATE_K=2` (~2-3km radius) geographically excludes several seeded riders (BIT Mesra, Hundru Falls — 12-25km out) from ever appearing as allocation candidates — permanent partner starvation by geography, with no retry/escalation when an order finds zero candidates. | `backend/src/config/constants.js:1-3`, `backend/src/services/allocationEngine.js:15-21`, `backend/reseed.js:36-46` | Backend Core |
| H6 | No rate limiting anywhere (login or API). Combined with the `admin123` default and no auth enforcement, this is an open brute-force/CPU-exhaustion (bcrypt) vector. | `backend/src/app.js`, `backend/src/routes/auth.js:11` | Backend API/Security |
| H7 | No `helmet()`, no explicit request body size limit, `urlencoded({extended:true})` widens parameter-pollution surface. | `backend/src/app.js:8-10` | Backend API/Security |
| H8 | NoSQL injection: request body/query values flow unsanitized into Mongoose queries (e.g. `User.findOne({email})` in login, `req.query.status` as an order filter) — a JSON body like `{"email":{"$ne":null}}` can bypass intended matching. | `backend/src/routes/auth.js:18`, `backend/src/controllers/orderController.js:38`, `backend/src/routes/allocation.js` (`orderId`) | Backend API/Security |
| H9 | CORS wide open (`origin:'*'`) on both the Express app and Socket.IO — any origin can call the API/subscribe to the live fleet feed. | `backend/src/app.js:8`, `backend/src/server.js:13` | Backend API/Security |
| H10 | Auth token stored in `localStorage` (readable by any same-origin JS) with no CSP configured anywhere — full token theft on any future XSS. | `frontend/src/context/AuthContext.jsx:13,30,37`, `frontend/src/api/axios.js:8,19`, `index.html` | Frontend |
| H11 | Socket.IO has no auth (anyone who knows the WS URL can subscribe to the live fleet feed) and no "reconnecting" UX — on disconnect, stale rider positions keep rendering as if live, with only a small dot indicating offline status. | `frontend/src/context/SimulationContext.jsx:16-69` | Frontend |
| H12 | Rider coordinate field-name mismatch: every map page reads `r.lng/r.lat`, while the REST/mock layer and the Riders table use `latitude/longitude`. Works today only because maps assume the socket tick payload's shape, which is never validated. | `Dashboard.jsx:66`, `RiderMap.jsx:171`, `OrdersMap.jsx:202`, `OrderMap.jsx:150` vs `api/endpoints.js` | Frontend |
| H13 | No `AbortController`/request cancellation on any data-fetching page — navigating away or changing a route param mid-request can let a stale response overwrite newer state (e.g. switching between two orders' map pages races). | `OrderMap.jsx`, `Orders.jsx`, `Riders.jsx`, `Restaurants.jsx`, `Customers.jsx`, `Dashboard.jsx`, `OrdersMap.jsx`, `Settings.jsx`, `AllocationHistory.jsx` | Frontend |
| H14 | Orders created while the simulation is stopped (`addPendingOrder`/`queueNextOrder` no-op when `!running`) are persisted as PENDING but never enter the live queue — yet the API returns `201 success`, misleading the caller. | `simulationEngine.js:81-84`; `orderController.js:13,28` | Cross-cutting |
| H15 | No idempotency protection on order creation beyond a client-side button-disable — a slow request + refresh + retry (especially via the new Assign-Order dialog) creates duplicate orders for the same pair. | `Orders.jsx:53-64,79-94`; `orderController.js:6-18` | Cross-cutting |
| H16 | `getRoute`'s `fetch` call has no timeout/AbortController — a hung Mapbox connection never resolves or rejects, permanently leaving that order's route un-persisted (straight-line forever) with no recovery. | `backend/src/services/routingService.js:17` | Cross-cutting |
| H17 | Allocation is O(pending orders × eligible riders) per 1-second tick, with each successful allocation firing an unbatched, un-throttled Mapbox Directions call — a `bulk` create of 100 orders can fire 100 simultaneous Mapbox requests in one tick, risking 429s and tick overrun. | `simulationEngine.js:423-563` | Cross-cutting |

## 3. Medium Bugs

- **No order aging/escalation**: orders with zero nearby candidates stay PENDING forever; `MAX_ALLOCATION_RETRIES` is defined but never used. (`simulationEngine.js:423-437`)
- **Allocation fairness**: no tie-break or starvation guard; load score only looks backward 60 min and ignores current in-flight assignment. (`allocationEngine.js:53-82`)
- **`pickPair` biased shuffle** (`Array.sort(()=>Math.random()-0.5)`) plus up to 10 sequential DB queries per order — biased restaurant selection, serial latency under bulk create. (`orderGenerator.js:11-20`)
- **Missing index** on `{assignedRiderId, status}` used by the orphan-healers; hydration cost grows with total historical order volume. (`Order.js:34-35`)
- **`setWeights` has no validation** — `{etar:0,rating:0,load:0}` produces `NaN` weights that poison every subsequent allocation until restart. (`constants.js:27-34`)
- **`deliveryTimestamps` grows unbounded** per rider — never trimmed to the load window, scanned in full on every score computation. (`simulationEngine.js:617,692,737`)
- **`Order.polyline`/`progress` fields are dead** — declared in schema, never written; any future consumer reading them sees stale/empty data. (`Order.js:15,23`)
- **JWT**: 7-day expiry, no refresh/revocation, no `issuer`/`audience`/algorithm pinning on verify. (`auth.js:28-32,53`)
- **Error handler leaks `err.message`** (including raw Mongoose/driver text) to clients in all environments. (`errorMiddleware.js:14-17`) — flagged independently by 2 agents.
- **No request logging / correlation IDs** anywhere — incident forensics on a failing request is currently impossible. (`app.js`)
- **Unbounded list endpoints**: riders/orders/restaurants/customers have no pagination (only `/allocation/history` paginates correctly); orders especially grow without bound as the sim runs. (`orderController.js:35-45` etc.)
- **`/allocation/allocate`'s `orderId` isn't validated as an ObjectId** before querying — same injection class as H8, plus 500-with-leaked-message on malformed input. (`allocation.js:15-20`)
- **Config/simulation-control endpoints have no auth or audit log** — anyone can rewrite allocation weights or stop the simulation with no record of who/when. (`config.js`, `simulation.js`)
- **Context values recreated every render** in all four React contexts (`SimulationContext` especially, updating every tick) — cascades unnecessary re-renders to every consumer. (`SimulationContext.jsx:66`, `AuthContext.jsx:41`, `ThemeContext.jsx:36`, `ToastContext.jsx:26-33`)
- **No client-side form validation** on Restaurant/Customer lat/lng (empty → `Number('')`→0, creating a stray `(0,0)` pin) or required fields; Save isn't disabled on empty input. (`Restaurants.jsx:40-57`, `Customers.jsx:40-57`)
- **Heavy map routes aren't code-split** — `mapbox-gl` loads in the initial bundle even for the Login page. (`AppRoutes.jsx`)
- **Dashboard/OrdersMap pollers keep running while the tab is backgrounded**, with no overlap guard if a request takes longer than the interval. (`Dashboard.jsx:52-60`, `OrdersMap.jsx:97-105`)
- **`.env.example` is incomplete** on both sides: backend's omits `MAPBOX_TOKEN` (routing silently degrades to lerp-only with no warning); frontend's omits `VITE_WS_URL`. (`backend/.env.example`, `frontend/.env.example`)
- **Corrupted/partial DB records can wedge the tick loop**: a record with non-finite coordinates throws inside `latLngToCell`, uncaught inside the `setInterval` callback — that tick's entire allocation phase aborts, repeating every tick until the bad record is fixed. (`simulationEngine.js:343,394`, `allocationEngine.js:43`)
- **Restart cancels PICKED_UP orphans rather than re-queuing them** — food already collected is simply written off if the rider didn't reload as PICKED_UP (e.g. went offline pre-restart). (`simulationEngine.js:148-188`)
- **WebSocket-only transport** (`transports:['websocket']`, no polling fallback) reduces resilience on networks where the WS upgrade is blocked. (`SimulationContext.jsx:17`)

<!-- ## 4. Low Priority Issues

- Validators don't validate `phone`/`address` format/length or the order `status` query filter against its enum.
- Route-ordering fragility note in `orders.js` (no live bug, just a footgun for future additions).
- No deployment manifest (Dockerfile/Procfile) and no top-level `unhandledRejection`/`uncaughtException` handlers.
- The already-known `env.js` dotenv-path fix is correct but still uncommitted — shipping HEAD as-is reintroduces the missing-env-file bug.
- Color-only status encoding on maps (accessibility gap for color-blind users); dialogs lack explicit initial focus.
- `Settings` weight inputs accept pasted negatives (`inputProps min` is advisory only).
- Dashboard's relative "Xs ago" timestamps don't tick between events.
- `Login.jsx` has redundant declarative + imperative redirect paths.
- `Sidebar`'s active-item match uses `startsWith`, fragile if routes grow.
- `AllocationHistory` recomputes derived lists every render without `useMemo`.
- Bulk-order count input has no min/max/integer guard (`bulkOrders(-5)` or `bulkOrders(99999)` both possible).
- Dead exports: `updateLocation`, `updateStatus`, `acceptOrder`, all three simulation-control functions in `endpoints.js` are never imported anywhere; `MAX_ALLOCATION_RETRIES`/`MIN_RIDER_SPEED_MS` constants are unused.
- Duplicated leg-duration formula and near-duplicated polyline-position math across 2-3 locations in `simulationEngine.js`/`allocation.js`.
- `tick()` is a ~200-line function doing four distinct jobs (movement, transitions, allocation, broadcast) — hard to test in isolation, which is reflected in current coverage.
- Magic numbers scattered: fallback leg durations (60/120s), poll intervals (10_000ms), pulse period (1400ms), allocation-history client cap (100).
- `availableRiders / totalRiders` mixes an ONLINE+IDLE numerator with an all-riders denominator — the "Available %" ring reads low whenever riders are simply offline.
- `bulkCreateOrders` has a bare empty `catch {}`, masking the difference between "no eligible pair" and a real DB error.
- `seed.js` places customers/riders uniformly across the whole bounding box, ignoring the H3 candidate/service-area radii — fresh demo data can itself reproduce the partner-starvation issue (H5). -->

## 5. Performance Issues

- Per-tick O(orders × candidates) allocation scan with unthrottled, un-batched Mapbox calls fanning out on bulk-create (H17).
- `pickPair`'s up-to-10 sequential `await`-in-a-loop DB queries per order, repeated serially across `bulkCreateOrders`.
- Unbounded `deliveryTimestamps` arrays scanned in full on every scoring call.
- Unbounded list endpoints (no pagination) returning entire collections as the dataset grows.
- No code-splitting for `mapbox-gl`/`react-map-gl` — inflates first-load for every page, not just map pages.
- Unmemoized context values triggering full consumer-tree re-renders on every 1s tick.
- Dashboard/OrdersMap polling continues even when the browser tab is hidden, and doesn't guard against overlapping in-flight requests.

## 6. Security Issues

(All of C3, C4, C5, H6-H13, plus the Medium-bucket JWT/error-leak/CORS-adjacent items above.) Headline: **authentication is unenforced end-to-end** — a stub middleware that's never mounted, on top of wildcard CORS, no rate limiting, no security headers, and NoSQL-injectable inputs. The frontend compounds this with a `DEV`-gated mock-auth bypass and localStorage token storage with no CSP. This is the single biggest blocker category.

## 7. Scalability Concerns

- Per-tick all-pairs allocation scan and per-allocation Mapbox fan-out (H17) — degrades as concurrent orders/riders grow.
- Unbounded `deliveryTimestamps` and unindexed `{assignedRiderId,status}` healer queries — both grow worse with order/rider volume over a long-running deployment.
- Unbounded list endpoints — payload size scales linearly with total historical data, no pagination ceiling.
- In-memory simulation state is the sole source of truth with no clustering/sharding story — this architecture inherently caps the system to a single backend instance.

## 8. UI/UX Problems

- Map shows stale/frozen rider positions during a socket outage with no "reconnecting" indicator beyond a small status dot.
- No loading/disabled-state guard against empty-field form submission (stray `(0,0)` map pins).
- Color-only status differentiation on map layers (accessibility).
- Relative timestamps ("Xs ago") freeze between events.
- No code-splitting means a slower first paint even for non-map pages like Login.
- Bulk-create count field has no sane bounds, inviting accidental mass-order creation.

## 9. Maintainability Problems

- `tick()` is an oversized, multi-responsibility 200-line function.
- Duplicated leg-duration/polyline-position math across 2-3 call sites.
- Magic numbers throughout both backend and frontend.
- Dead code: unused auto-order-job exports, several unused frontend API functions, unused constants.
- Inconsistent data shapes between REST and socket payloads for the same rider entity (`lng/lat` vs `latitude/longitude`).
- `handleDrawerToggle` prop name doesn't match its actual setState contract.

## 10. Suggested Refactoring

1. Make allocation a single source of truth: route manual `/allocation/allocate` through the sim engine's in-memory state instead of writing the DB independently (resolves C1/C2).
2. Extract `tick()`'s four responsibilities into `advanceRiders()`, `allocatePending()`, and `broadcast()` — independently testable.
3. Extract shared `legDurationSeconds(from, to)` and a shared segment-lerp helper to remove the duplicated math.
4. Normalize rider coordinate field naming to one shape (`latitude`/`longitude` or `lat`/`lng`) consumed identically by REST and socket payloads.
5. Replace the biased `Array.sort(()=>Math.random()-0.5)` shuffle with Fisher–Yates or `$sample`.
6. Wrap each React Context's `value` in `useMemo`; consider splitting `SimulationContext` into a high-frequency (riders/routes) and low-frequency (connected/queueDepth) context.
7. Remove dead code: unused `endpoints.js` exports, unused `constants.js` entries, the never-started auto-order-job (or wire it up properly per H3/H14's fix direction).

## 11. Missing Tests

- **Unit:** `allocateOrder`/`computeEtar` (scoring weights, solo-candidate branch, the NaN-duration edge case from H4, divide-by-zero guards), all validators (pure functions, trivial to test), `_extractCoords`.
- **Integration (supertest + mongodb-memory-server):** every controller's success/400/404 paths; `/config/weights` validation; both branches of `/allocation/allocate` (this would have caught C1/C2/H4 directly).
- **Contract:** a test hitting `acceptOrder`'s route would immediately catch C6 (missing route).
- **Frontend (Vitest + RTL):** `AuthContext` rehydrate-on-mount, `SimulationContext` socket-event reducers, `ProtectedRoute` redirect logic, double-submit guards on `Orders`/`Restaurants`/`Customers` create flows.
- **E2E (Playwright is already a dependency):** login → dashboard → create order → see it allocate and move on the map.
- **Race-condition test:** concurrent `POST /orders/bulk` + a running tick loop, specifically targeting C1/C2.
- **Load test:** tick duration under N concurrent pending orders, to validate/refute H17's scalability concern.

## 12. Deployment Risks

- Shipping HEAD as-is ships the **broken** `env.js` dotenv path (the fix is correct but currently uncommitted) — the deployed app would load no environment variables at all.
- No env-var fail-fast — a misnamed `MONGODB_URI` in a deploy config produces a server that reports healthy but 500s on every DB-touching request.
- No CORS allowlist, no rate limiting, no auth enforcement — deploying today exposes a fully open admin API to the public internet.
- No deployment manifest (Dockerfile/Procfile/platform config) exists yet for whatever target host is intended.
- Auto-order generation (advertised core behavior) does not run at all in the current codebase.

## 13. Production Readiness Checklist

- [ ] Implement and mount real JWT verification in `protect`; apply to all mutating/sensitive routes
- [ ] Add env-var validation at startup (fail fast on missing `MONGODB_URI`/`JWT_SECRET`); remove the `admin123` default
- [ ] Add rate limiting (especially `/auth/login`) and `helmet()`
- [ ] Sanitize/coerce all query/body inputs used in Mongoose filters (NoSQL injection)
- [ ] Lock CORS to an explicit origin allowlist (HTTP + Socket.IO)
- [ ] Resolve the dual-allocator race (C1/C2) before relying on the manual allocate route in any real usage
- [ ] Fix the NaN-ETAR edge case (H4) and add the divide-by-zero/NaN guard tests
- [ ] Commit the `env.js` dotenv-path fix
- [ ] Decide on and either wire up or remove the dead auto-order-generation feature
- [ ] Add pagination to all unbounded list endpoints
- [ ] Add a minimal integration/unit test suite covering allocation, controllers, and validators
- [ ] Add a CSP and move the auth token off `localStorage` (or explicitly accept the documented tradeoff)
- [ ] Add reconnection/staleness UX to the live maps
- [ ] Add a request timeout to `getRoute`'s Mapbox fetch
- [ ] Add basic request logging with correlation IDs and stop leaking raw error messages to clients in production

---

## Scores

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

*(Backend score is the average of the Backend-Core (5.5) and Backend-API/Security (3.5) sub-scores reported by the two backend review agents, rounded; Security is pulled down sharply by the unenforced-auth + wide-open-CORS + no-rate-limiting combination, which independent reviewers each flagged as Critical.)*

## Would you deploy this project to production today?

**No.**

### Blockers that must be fixed before deployment

1. **Authentication is not enforced anywhere** — `protect` is a no-op stub never even mounted on a route (C3). This alone makes every other fix moot until resolved.
2. **No fail-fast environment validation**, plus the hardcoded `admin123` fallback and the currently-uncommitted `env.js` path fix (C4, deployment risk).
3. **No rate limiting, no security headers, wide-open CORS, NoSQL-injectable inputs** (H6-H9) — the combination of these with #1 means the API is fully open to the public internet today.
4. **The dual-allocator race condition** (C1/C2) — can double-assign riders/orders in any deployment where the manual allocate route is used alongside the running simulation.
5. **Zero meaningful test coverage** (C7) on the business-critical allocation/order paths — there is currently no safety net to catch a regression in any of the above fixes.

Everything else in this report (performance, scalability, UI/UX, maintainability) is real but secondary — none of it should block a first production deploy once the five items above are addressed. The codebase itself is well-organized and the recent bug-fix work (simulation engine + frontend UX) is solid; the gaps are concentrated in security/auth enforcement and concurrency safety, both of which are scoped, fixable problems rather than architectural rewrites.
