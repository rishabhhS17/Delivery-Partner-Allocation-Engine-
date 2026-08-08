# Phase 2 — Dedicated Allocation View (H3 candidate zones + click-to-score)

## Context

The allocation engine already narrows the fleet to the riders inside a k=2 H3 grid disk
(19 cells at resolution 7) around a restaurant via `getCandidateCells`
(`backend/src/services/allocationEngine.js:15`), then scores them with `allocateOrder`. Both
steps are invisible today — the maps show riders, orders, and routes, but never the *search
area* the engine considers or *why* a rider wins. Phase 2 makes the engine legible with a new,
guest-visible **Allocation view**: a live map that draws each pending order's candidate zone as
a merged outline, and — on clicking a pending order — shows its in-range candidates ranked with
a live, read-only ETAR/rating/load scoring breakdown. It changes **no** allocation, movement,
or state-machine logic; it only visualizes what the engine already computes.

### Decisions locked (from the user)
1. **Always-on zones for pending orders** — every order waiting for a rider shows its zone; it
   disappears when the order is assigned (self-cleaning).
2. **A dedicated Allocation view** — a new page/route/nav item, not a layer on the Order Map.
3. **Merged outline per zone** — one boundary around the whole 19-cell disk (via h3-js
   `cellsToMultiPolygon(cells, true)`, v4.4), not 19 individual hexes.
4. **Zones + click-to-score** — clicking a pending order shows its candidate riders ranked with
   score + E/R/L breakdown (winner highlighted), from a **read-only** dry-run endpoint (no
   assignment).

### Grounded assumptions
- **Guest-visible.** The Allocation view is the engine showcase, so it lives in the guest-
  allowed route group and its endpoints sit behind `protect` only (not `requireAdmin`).
- **DB rider positions are accurate for scoring.** Candidates are IDLE riders, which are
  stationary (they sit at home base until assigned), so scoring against DB positions matches the
  live map. Moving riders (ACCEPTED/PICKED_UP) are never candidates — no staleness issue. This
  lets the preview endpoint reuse the DB query pattern already in `POST /allocate`.

---

## Backend changes (`backend/src`)

### 1. `services/allocationEngine.js`
- **`getCandidateZone(lat, lng)`** — reuse `getCandidateCells` (cached in `diskCache`), then
  `cellsToMultiPolygon(cells, true)` (h3-js v4.4 → GeoJSON `[lng,lat]`, closed rings) to build
  the merged outline. Return a GeoJSON `Feature` with `MultiPolygon` geometry. Add a boundary
  cache keyed by the restaurant cell, mirroring the existing `diskCache` pattern.
- **`rankCandidates(order, candidates, weights)`** — extract the existing scoring loop from
  `allocateOrder` (the `.map(...).sort(...)` block) into an exported function returning the
  **full ranked array** `[{ rider, score, breakdown }]`. Refactor `allocateOrder` to call it and
  return `ranked[0]` — a pure DRY refactor, no behavior change (the preview needs every
  candidate's score, not just the winner's).

### 2. `routes/allocation.js` (already mounted behind `protect`; do NOT add `requireAdmin`)
- **`GET /candidate-zone?lat=&lng=`** — validate both are finite numbers (`Number.isFinite`, as
  in `restaurantController.getAllRestaurants`), else 400. Return
  `{ success, geojson: { type:'FeatureCollection', features:[ getCandidateZone(...) ] } }`.
  Cheap and cacheable per restaurant; drives the always-on zones.
- **`GET /preview?orderId=`** — find the PENDING order; 404 if missing / 400 if not PENDING.
  Compute `getCandidateCells`, query idle ONLINE riders in those cells from the DB (mirror the
  `Rider.find({ availabilityStatus:'ONLINE', h3Index:{ $in: cells } })` filter in `POST
  /allocate`, filtered to `status:'IDLE'`), run `rankCandidates`, and return
  `{ success, zone:<feature>, winnerId, candidates:[{ riderId, name, rating, score, breakdown }] }`.
  **Read-only — performs no writes.**
- Leave `POST /allocate` (admin) and `GET /history` untouched.

No model, socket, or simulation-engine changes.

---

## Frontend changes (`frontend/src`)

### 1. `api/endpoints.js`
- `getCandidateZone({ lat, lng })` → `GET /allocation/candidate-zone` (returns the FeatureCollection).
- `getAllocationPreview(orderId)` → `GET /allocation/preview?orderId=…`.

### 2. `pages/Allocation.jsx` (new page)
Reuse the `OrdersMap.jsx` scaffolding (same `MAPBOX_TOKEN`, `RANCHI_CENTER`, dark style,
`ResizeObserver`, `MapGL` + `Source`/`Layer` + `Marker` pattern, `useSimulation()` for live
`riders`, polled `getOrders`/`getRestaurants`, and the `pendingOrders` memo).
- **Always-on zones:** a `zoneCache` (`useRef(new Map())`) keyed by `` `${lat},${lng}` ``; an
  effect fetches missing zones for the deduped set of pending-order restaurants and caches them
  (the poll must not refetch cached keys). A `useMemo` merges cached zone features into one
  `FeatureCollection`, rendered via one `<Source>` + a fill layer (`fill-color:'#f59e0b'`,
  `fill-opacity:0.08`) and a line layer (outline, opacity ~0.4), placed beneath markers.
- **Markers:** restaurants, rider markers (from `useSimulation`), and **clickable** pending-
  order markers at the restaurant pickup point (reuse `OrderMarker`/`RiderMarker`).
- **Click-to-score:** clicking a pending order calls `getAllocationPreview(order._id)` and opens
  a side panel (MUI) listing candidates ranked by score with the E/R/L breakdown (reuse the
  `E.. · R.. · L..` formatting from `AllocationHistory.jsx`), **winner highlighted**; optionally
  emphasize that order's zone. Render "no eligible riders in range" when the ring is empty.

### 3. Routing & nav
- `routes/AppRoutes.jsx` — add `<Route path="allocation" element={<Allocation />} />` inside the
  **guest-visible** group (the plain `ProtectedRoute`, not the `requireAdmin` wrapper).
- `config/navigation.js` — add `{ label:'Allocation', path:'/allocation', icon: <Target/Radar> }`
  **without** `adminOnly` (guest-visible). The existing admin-only "Allocation History" (table of
  past decisions) stays as-is — the new page is the live map/why-view; they complement.

---

## Files at a glance
- **Backend — modified:** `services/allocationEngine.js` (`getCandidateZone` + `rankCandidates`
  refactor), `routes/allocation.js` (`GET /candidate-zone`, `GET /preview`).
- **Frontend — new:** `pages/Allocation.jsx`. **Modified:** `api/endpoints.js`,
  `routes/AppRoutes.jsx`, `config/navigation.js`.

Reuse: `getCandidateCells` + `diskCache` (`allocationEngine.js:13-21`), the scoring loop in
`allocateOrder`, the `Rider.find` geo-filter in `routes/allocation.js`'s `POST /allocate`, and
the `MapGL`/`Source`/`Layer`/`Marker` + `pendingOrders` patterns and `E·R·L` formatting from
`OrdersMap.jsx` / `AllocationHistory.jsx`.

---

## Verification (end-to-end)
1. **Zone endpoint:** `GET /api/allocation/candidate-zone?lat=23.3441&lng=85.3096` (with a
   token) returns a `FeatureCollection` with one `MultiPolygon` feature; invalid coords → 400.
2. **Preview endpoint:** with a PENDING order id, `GET /api/allocation/preview?orderId=…` returns
   ranked `candidates` (each with `score` + `breakdown`) and `winnerId`; confirm the order is
   **still PENDING** afterward (no writes). Non-pending id → 400/404.
3. **View:** run the simulation; open **Allocation**. Restaurants with a pending order show a
   translucent merged outline; assigning an order removes its zone. Clicking a pending order
   opens the candidate panel with scores, winner highlighted; "no eligible riders" renders when
   the ring is empty.
4. **Guest:** "Enter as Guest" → Allocation is in the sidebar, the page and both endpoints work
   (no 403).
5. **Perf/regressions:** the order poll doesn't refetch cached zones; Order Map and Allocation
   History are unchanged.

---

## Related docs
- `NEXT_PHASES.md` — Phase 2 is this; Phase 3 (demand heatmap) reuses this hexagon/zone renderer.
- `ALLOCATION_LOGIC_MODEL.md` / `ZOMATO.md` §3-4 — why H3 geo-filtering + scoring is the engine.
