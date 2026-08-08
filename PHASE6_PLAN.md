# Phase 6 — Model A: Capped Interleaved Clubbing (marginal-cost ETAR + anti-starvation)

Branch: **`feature/multi-order-engine`** (off `enhancements`), after Phase 4's stop-list.
**Engine-only** for now — no map visualization; verified via logs/data/tests.

## Context

Replace today's single-order `nextOrderId` chaining with true **interleaved clubbing**: a rider
can carry multiple orders and pick up order B while still carrying A, when it's geographically
sensible and doesn't break anyone's promise. A new order is placed into the rider's stop-list at
its **cheapest feasible insertion**, chosen by **marginal cost** (extra minutes it adds), with
hard **anti-starvation** guarantees so the oldest order is never deferred forever. This is Model A
from `ALLOCATION_LOGIC_MODEL.md`, built on the Phase 4 stop-list.

### Decisions locked (from the user)
1. **Cap is a tunable ceiling (start 2), architecture general for any N.** `CLUBBING_CAP` is a
   constant; all logic (stop-list, insertion, cost, deadlines) works for arbitrary N — nothing is
   hardcoded to 2. **Cheapest-insertion** (don't reorder existing stops) keeps it N-general and
   tractable; full route re-optimization (reorder everything) is deferred — that's Model B / VRP.
2. **Club same-restaurant AND nearby different restaurants** (drops in a compatible direction) —
   the fuller Model A (multi-pickup, multi-drop).
3. **Full anti-starvation:** absolute per-order deadline + deadline-validated insertion +
   head-of-route freeze + aging.
4. **Engine-only** — no clubbing map viz yet (emit the data so a future viz can render it).

---

## Backend changes (`backend/src`)

### 1. Config — `config/constants.js`
- `CLUBBING_CAP` (default 2) — max concurrent orders per rider.
- Clubbing gate: `CLUBBING_RESTAURANT_RADIUS_KM` (B's restaurant near the rider's path),
  `CLUBBING_DROP_RADIUS_KM` (B's drop near an existing drop), and a same-direction bearing
  tolerance.
- Anti-starvation: `ORDER_DEADLINE_SLACK_S`, and a head-freeze threshold (`HEAD_FREEZE_S`).

### 2. Order model — `models/Order.js`
- `promisedBy` (Date), set at creation = `createdAt + estimate(firstMile + prep + lastMile) +
  slack` (haversine legs + `prepTime_s` from Phase 4). Fixed for life — the absolute deadline.

### 3. Marginal-cost machinery — `services/allocationEngine.js`
- `routeTime(stops, startPos)` — total time to traverse a stop-list from `startPos`, charging
  **wait at each pickup** as `max(arrival, prepReadyAt)` (prep-aware, from Phase 4).
- `cheapestInsertion(stops, orderB)` — try inserting B's pickup + drop at each valid position
  (pickup before drop, nothing before a completed stop, **existing stops not reordered**), score
  each with `routeTime`, return the cheapest feasible ordering + its cost. O(stops²) → N-general.
- `marginalCost = cheapestNewCost − baseCost` (base = current stop-list cost). An idle rider's
  marginal cost is a fresh trip inserted into an empty list. Blend with rating/load as today.
- `deadlineOk(ordering)` — every onboard order **and** B finish before their `promisedBy` in the
  resulting ordering; otherwise the insertion is illegal.

### 4. Allocation loop — `services/simulationEngine.js` (tick Phase 2)
- **Candidate pool** for a pending order B: idle riders in B's restaurant H3 candidate cells
  (as today) **plus** busy riders under `CLUBBING_CAP` whose position/next stop is near B's
  restaurant (H3) and who have a drop within `CLUBBING_DROP_RADIUS_KM` in a compatible direction.
- For each candidate: compute `cheapestInsertion` → `marginalCost`, and **reject** any candidate
  whose best ordering fails `deadlineOk`, the **head-of-route freeze** (rider within
  `HEAD_FREEZE_S` of its next drop → no inserting ahead of that drop; append after), or **aging**
  (near-deadline onboard orders are effectively immovable). Winner = lowest marginal cost.
- **Commit:** insert B's stops into the winner's stop-list, update `activeOrders` + onboard-order
  set, DB writes, and `getRoute` for the new/affected legs (reuse Phase 4 leg wiring).
- **Respects Phase 4 JIT hold:** B is still held until its `departBy` (computed against when the
  chosen rider would reach B's restaurant in the resulting itinerary) — clubbing decides *who*
  and *where in the route*, the hold decides *when*.

### 5. Movement / persistence — `services/simulationEngine.js`
- Movement, `WAITING`, and per-stop completion already come from Phase 4's stop-list; clubbing
  just means the list can hold >2 interleaved stops. Order status stays derived per stop.
- **Persist the full onboard-order set** (not just `currentOrderId`/`nextOrderId`) so `hydrate`
  can rebuild an N-order stop-list on restart; extend orphan healers for multi-order riders.
- **Telemetry:** include each rider's carrying count + onboard order ids in the `simulation:tick`
  payload (so a later viz can render ×N badges / multi-drop routes) — no frontend work now.

---

## Staying N-general (why the cap isn't baked in)
- **Data model:** the stop-list already holds an arbitrary number of stops (Phase 4).
- **Insertion:** cheapest-insertion is O(stops²) per new order — scales to any N; it never
  reorders existing stops (that non-reordering is exactly what keeps this Model A and avoids the
  factorial VRP blow-up of Model B).
- **Cap:** `CLUBBING_CAP` is just the ceiling used in candidate filtering; raise it and everything
  else works unchanged.
- **Future (Model B):** full route re-optimization (reordering all stops, 2-opt/insertion VRP)
  and continuous per-tick re-insertion — deliberately out of scope here.

## Out of scope (future)
- Clubbing map visualization (×N badge, stitched path, two drop-lines).
- Full route re-optimization / continuous re-insertion (Model B).
- Decomposed-ETA display (Phase 5 — dropped as user-facing; timings stay internal).

## Verification (end-to-end)
1. **Helpers:** `routeTime`, `cheapestInsertion`, `marginalCost`, `deadlineOk` are correct on
   small fixtures (incl. prep/wait charging and pickup-before-drop constraint).
2. **Clubbing happens:** with clustered orders, a busy rider under cap picks up a 2nd nearby
   order (same or nearby-restaurant); logs show a rider with a nearby drop beating a farther idle
   rider on marginal cost.
3. **Anti-starvation:** in a scenario where new orders keep arriving, the oldest onboard order is
   never pushed past its `promisedBy` — deadline-validated insertion rejects starving inserts,
   head-freeze protects an imminent drop, aging locks near-deadline orders.
4. **N-general:** raise `CLUBBING_CAP` to 3+ and confirm behavior generalizes with no code change.
5. **Restart:** kill mid-run and re-hydrate — a rider carrying 2+ orders rebuilds its stop-list
   correctly; no orphans.
6. **Standalone:** the branch runs and is verifiable without any `feature/allocation-viz` code;
   backend imports clean.

## Related docs
- `ALLOCATION_LOGIC_MODEL.md` — Model A (this), plus the fairness/anti-starvation rationale.
- `PHASE4_PLAN.md` — the stop-list + prep/WAITING foundation this builds on.
- `NEXT_PHASES.md` §6, `ZOMATO.md` §6-7 — clubbing/batching in real dispatch.
- `PLAN.md` — branch strategy (Phase 6 is the last step of `feature/multi-order-engine`).

> Note: `allocationEngine.js` and `routes/allocation.js` are also touched by
> `feature/allocation-viz`. Since the branches are built independently and merged later by the
> owner, each introduces what it needs; the merge branch reconciles any overlap (e.g. a shared
> candidate-ranking helper).
