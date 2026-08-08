# Phase 3 — Demand Heatmap (H3 pending-order density) + H3 config centralization

## Context

Phase 2 makes the allocation engine's *candidate step* visible (per-order H3 zones + scoring on
the Allocation view). Phase 3 adds the *demand* picture: a live heatmap colouring H3 cells by how
many orders are currently waiting for a rider, so clustering/pressure is visible at a glance —
the reactive precursor to real surge/pre-positioning (`ZOMATO.md` §9, `NEXT_PHASES.md` Phase 3).
While here, we also centralize the H3 resolution/k config into a single source of truth and
expose it to the frontend, addressing hardcoded-value drift.

**Depends on Phase 2** (the `pages/Allocation.jsx` view, the `/allocation` route/nav, and the
candidate-zone endpoint). Build Phase 2 first (or Phase 2 then Phase 3 together).

### Decisions locked (from the user)
1. **Lives on the Allocation view** (from Phase 2) — no new page.
2. **Intensity = live pending-order count** per cell (reactive, unserved demand now).
3. **Bucket by restaurant (pickup) cell** — where a rider is dispatched; aligns with allocation.
4. **Cell size = H3 res 7**, same as allocation (from the central config).
5. **Hex choropleth** — fill each cell graded by count (cool → hot), crisp per-cell.
6. **Backend demand endpoint** produces the per-cell counts (H3 stays server-side; no new
   frontend dep).
7. **Coexistence: a toggle** ("Demand heatmap" | "Candidate zones"), one layer at a time.
   *Future improvement:* heatmap ambient + candidate zone on click.
8. **Visualization only.** *Future work:* nudge idle riders toward hot cells (sim behavior).
9. **Centralize H3 config** — one source in `constants.js`, exposed to the frontend via `/config`.
   *Future work:* broader centralization of frontend map constants (center, style, colours).

---

## Backend changes (`backend/src`)

### 1. H3 config as single source — `config/constants.js` + a config endpoint
- Confirm `H3_RESOLUTION` and the k values (`H3_CANDIDATE_K`, `RESTAURANT_SERVICE_K`) are the
  sole definitions; audit for any stray hardcoded resolution/k literals across the backend and
  replace with imports from `constants.js`. (Backend already imports these widely — this is a
  verify-and-tidy pass, not a rewrite.)
- Add **`GET /config/h3`** in `routes/config.js` (mounted behind `protect`; guests allowed, like
  `GET /weights`) returning `{ resolution, candidateK, restaurantServiceK }` from `constants.js`.
  This is the "single source, exposed to the frontend" piece.

### 2. Demand aggregation — `routes/allocation.js` (behind `protect`; not `requireAdmin`)
- Add **`GET /allocation/demand`**: query `Order.find({ status:'PENDING' })`, bucket each by
  `latLngToCell(restaurantLat, restaurantLng, H3_RESOLUTION)`, tally per-cell counts, then build a
  GeoJSON `FeatureCollection` of hex Polygon features (`cellToBoundary(cell)` → flip `[lat,lng]`
  →`[lng,lat]`, close ring) with `properties:{ count }`. Return `{ success, geojson, max }`
  (`max` = highest cell count, for colour scaling). Read-only.
- Reuse the boundary-building helper from Phase 2's `getCandidateZone` (factor a small
  `cellToPolygon(cell)` in `allocationEngine.js` if not already extracted).

No model, socket, or simulation-engine changes.

---

## Frontend changes (`frontend/src`)

### 1. `api/endpoints.js`
- `getDemand()` → `GET /allocation/demand`.
- `getH3Config()` → `GET /config/h3` (so the frontend never hardcodes H3 res/k).

### 2. `pages/Allocation.jsx` (extend the Phase 2 view)
- Add a **segmented toggle** (MUI `ToggleButtonGroup`) at the top of the map: **Demand heatmap**
  | **Candidate zones**. Only the selected layer renders (mutually exclusive).
- **Demand heatmap layer:** when selected, poll `getDemand()` (reuse the existing `POLL_MS`
  pattern) and render a `<Source id="demand" type="geojson">` with a fill `<Layer>` whose
  `fill-color` is data-driven on the `count` property —
  `['interpolate',['linear'],['get','count'], 0, <cool>, max, <hot>]` — plus a thin cell outline
  and `fill-opacity` ~0.5. A small legend shows the count→colour scale.
- **Candidate zones layer:** the Phase 2 always-on merged zones + click-to-score, unchanged.
- Consume `getH3Config()` once (small context or a top-level fetch) so any client-side H3 need
  reads the backend value rather than a literal — establishes the single-source pattern on the
  frontend even though the heatmap geometry itself is backend-built.

No changes to Order Map / Rider Map / Allocation History.

---

## Files at a glance
- **Backend — modified:** `config/constants.js` (verify single source), `routes/config.js`
  (`GET /config/h3`), `routes/allocation.js` (`GET /allocation/demand`), `services/allocationEngine.js`
  (optional `cellToPolygon` helper shared with Phase 2).
- **Frontend — modified:** `api/endpoints.js`, `pages/Allocation.jsx` (toggle + heatmap layer +
  H3-config consumption).

Reuse: `H3_RESOLUTION`/k in `constants.js`; `latLngToCell`/`cellToBoundary` (h3-js v4.4, already a
backend dep); Phase 2's `getCandidateZone`/`cellToPolygon` boundary code; the `Source`/`Layer` +
`POLL_MS` + `pendingOrders` patterns in `OrdersMap.jsx`/`Allocation.jsx`; the `E·R·L`/legend
styling from `AllocationHistory.jsx`.

---

## Verification (end-to-end)
1. **Config endpoint:** `GET /api/config/h3` returns `{ resolution:7, candidateK, restaurantServiceK }`.
2. **Demand endpoint:** with pending orders present, `GET /api/allocation/demand` returns a
   `FeatureCollection` of hex polygons whose `count`s match the pending orders bucketed by
   restaurant cell (two pending orders at restaurants in the same cell → one feature, count 2);
   empty collection when nothing is pending; `max` reflects the hottest cell.
3. **View:** on the Allocation page, the toggle switches between the demand heatmap (cells shaded
   by pending count, updating as orders queue/clear) and the candidate zones; only one shows at a
   time.
4. **Guest:** "Enter as Guest" → the page and both endpoints work (no 403).
5. **Centralization:** grep confirms no hardcoded H3 resolution/k literals remain outside
   `constants.js`; the frontend obtains H3 values from `/config/h3`, not a literal.

---

## Related docs
- `PHASE2_PLAN.md` — the Allocation view this builds on.
- `NEXT_PHASES.md` — Phase 3 in the roadmap.
- `ZOMATO.md` §9 — demand forecasting / surge (the direction this points toward).
