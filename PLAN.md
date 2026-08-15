# Plan: Keep the H3 geo-filter honest for moving riders

## Context

**The problem:** riders are geo-filtered for an order by their stored H3 cell, but a
moving rider's cell goes stale — so they could be selected for a restaurant they've
physically driven out of range of (or missed for one they've entered).

**What the investigation found — it's a *latent* bug, not a live one:**

- The allocator reads H3 **cell membership**, which is only mutated at lifecycle
  transitions (hydrate / assign / deliver), never as a rider moves:
  - **Sim path** (`simulationEngine.js:490-502`) reads `h3Buckets`. Membership changes
    only via `_addToH3`/`_removeFromH3` at hydrate (`:352`), assignment (`:538`),
    delivery (`:815`). The tick recomputes `rider.h3Index` every tick (`:442`) but never
    re-buckets.
  - **Manual path** (`allocation.js:27-31`) reads the DB `h3Index`, which the tick never
    writes per-tick — stale for anyone in motion.
- Today this cannot misallocate, because **both paths only consider `status === 'IDLE'`
  riders** (`simulationEngine.js:499`, `allocation.js:35`) and **IDLE riders never move**
  — the tick skips them (`:428`) and delivery teleports them home and re-buckets there
  (`:811-815`). The concern becomes real only under the planned v2 "assign to moving
  riders by ETAR" direction.
- Separately: `H3_CANDIDATE_K = 20` at resolution 7 is a ~30km ring — larger than the
  ~20km Ranchi bounds. So the H3 filter barely bounds range today; effectively every IDLE
  rider in the city is a candidate. **Scoring already uses live coords**
  (`simulationEngine.js:508-509`, `computeEtar` in `allocationEngine.js:88`) — only the
  candidate-generation *filter* is stale/coarse.

**Decisions taken (approved):**
1. Approach: **re-bucket moving riders + precise post-filter** (H3 for candidate gen,
   haversine as the authority for "in range").
2. Scope: **post-filter now + re-bucket hook now**, but keep **IDLE-only eligibility**.
   Do NOT build full moving-rider allocation — that stays a separate, later v2 feature.
3. Range gate: **runtime-tunable `maxRangeKm`, default 5 km**, in the mutable H3 config
   (same pattern as `candidateK`/TTL).

**Intended outcome:** a real, tunable service radius enforced on live positions today, and
a spatial index that is correct-by-construction the moment moving riders become eligible —
with zero behavior change to the current IDLE-only flow.

## Changes

### 1. `backend/src/config/constants.js` — add the `maxRangeKm` knob
- Add `export const MAX_ALLOCATION_RANGE_KM = 5;` near the other H3 constants.
- Add `maxRangeKm: MAX_ALLOCATION_RANGE_KM` to the initial `currentH3` object (`:44-48`).
- In `setH3Config` (`:54-72`), destructure and validate `maxRangeKm` — require a finite
  number `> 0`, else `throw new Error('maxRangeKm must be a positive number')` — and set
  `next.maxRangeKm`. `getH3Config()` already returns the whole object, so it's exposed
  automatically.

### 2. `backend/src/routes/config.js` — doc only
No functional change (`PUT /h3` already forwards `req.body` to `setH3Config` and returns
`getH3Config()`). Update the `GET /h3` / `PUT /h3` comments (`:60`, `:65-68`) to mention
`maxRangeKm`.

### 3. `backend/src/services/simulationEngine.js` — post-filter + re-bucket hook
**Post-filter (sim allocation, Phase 2, `:490-514`):** read
`const { maxRangeKm } = getH3Config();` and, when collecting `eligible` from the buckets,
keep a rider only if their **live** position is within range:
```js
if (r && r.status === 'IDLE' &&
    haversine({ lat: r.lat, lng: r.lng },
              { lat: order.restaurantLat, lng: order.restaurantLng }) <= maxRangeKm) {
  eligible.push(r);
}
```
(`haversine` and `getH3Config` are already imported.)

**Re-bucket hook (correct-by-construction, no-op today):**
- Add `bucketCell: null` to `_buildEntry` (`:383-417`) — tracks the cell a rider is
  currently indexed under.
- Refactor the bucket helpers (`:905-913`) to take the rider entry and maintain
  `bucketCell` (removal uses `bucketCell`, which is strictly more correct than the current
  `h3Index` arg):
  ```js
  function _addToH3(riderId, rider) {
    const cell = rider.h3Index;
    if (!h3Buckets.has(cell)) h3Buckets.set(cell, new Set());
    h3Buckets.get(cell).add(riderId);
    rider.bucketCell = cell;
  }
  function _removeFromH3(riderId, rider) {
    if (rider.bucketCell) h3Buckets.get(rider.bucketCell)?.delete(riderId);
    rider.bucketCell = null;
  }
  function _reindexIfBucketed(riderId, rider) {
    if (rider.bucketCell && rider.bucketCell !== rider.h3Index) {
      _removeFromH3(riderId, rider);
      _addToH3(riderId, rider);
    }
  }
  ```
- Update the 4 call sites to pass the rider entry instead of a cell string: hydrate
  `:352` `_addToH3(id, entry)`, `syncManualAllocation` `:134` `_removeFromH3(id, rider)`,
  tick assignment `:538` `_removeFromH3(winnerId, winner)`, delivered `:815`
  `_addToH3(riderId, rider)`.
- In tick Phase 1, immediately after `rider.h3Index = latLngToCell(...)` (`:442`), call
  `_reindexIfBucketed(riderId, rider);`.

**Why this is a no-op today:** only IDLE riders are ever bucketed, and IDLE riders never
enter the movement block (`:428`), so `bucketCell` always equals `h3Index` for bucketed
riders and `_reindexIfBucketed` never relocates anyone. When moving riders are later made
eligible+bucketed, the hook keeps their index live automatically.

### 4. `backend/src/routes/allocation.js` — post-filter on the manual path
- Import `getH3Config` from `../config/constants.js` (already imports `getWeights`,
  `RIDER_SPEED_KMH`; `haversine` already imported).
- Extend the IDLE filter (`:35`) with the same live-distance gate:
  ```js
  const { maxRangeKm } = getH3Config();
  const idleCandidates = candidates.filter(c =>
    c.status === 'IDLE' &&
    haversine({ lat: c.latitude, lng: c.longitude },
              { lat: order.restaurantLat, lng: order.restaurantLng }) <= maxRangeKm
  );
  ```

## Out of scope (explicitly deferred to the v2 moving-rider feature)
- Making busy/moving riders eligible candidates via `computeEtar`'s `timeToFree`.
- Queuing next orders through the sim tick (only the manual `nextOrderId` path exists now).
- Any per-tick DB write of `h3Index`/`lat`/`lng`.

## Verification
1. `cd backend && npm run dev` (or the project's start script); start the simulation from
   the UI or `POST /api/simulation/start`.
2. **Knob exposed:** `GET /api/config/h3` → response includes `maxRangeKm: 5`.
3. **Gate works:** `PUT /api/config/h3` `{ "maxRangeKm": 1 }` → returns the updated config;
   observe that orders whose restaurant is >1 km from every IDLE rider now stay PENDING and
   eventually CANCELLED (TTL) instead of being allocated. `PUT` it back to `5` (or higher)
   → allocation resumes. Invalid values (`0`, `-1`, `"x"`) → `400`.
4. **No regression:** at the default 5 km, normal allocation, pickup, delivery, and the
   manual `POST /api/allocation/allocate` path all still work; sim tick logs no errors; the
   re-bucket hook produces no observable change (it is a no-op under IDLE-only eligibility).
5. Optional sanity: temporarily log `eligible.length` per order before/after the gate to
   confirm distant riders are dropped from candidate generation.
