# MASTER PLAN — Multi-Order Clubbing Dispatch Engine

> **Self-sufficient build spec.** Everything needed to build all three stages is inlined here; the
> other plan docs (`PHASE4_PLAN.md`, `PHASE6_PLAN.md`, `PLAN.md`, `ALLOCATION_LOGIC_MODEL.md`) are
> now **optional deeper background**, not required reading. Model: **Model A** (capped interleaved
> clubbing, cheapest-insertion, no reorder). Branch: **`feature/multi-order-engine`**, off `main`.

---

## ⭐ WHAT WE WANT TO DO

Evolve the allocation engine from a **rigid one-order-per-rider, assign-on-arrival** machine into
a **realistic multi-order "clubbing" dispatcher** that behaves like Swiggy/Zomato while staying
fully explainable in the single-node simulation. Three things, in dependency order:

1. **Make dispatch *timing* real** — model food-prep time, **hold** assignment so a rider departs
   to arrive just as the food is ready ("just-in-time"), and add a genuine **`WAITING`** state.
   Replace the two-leg machine with a general **stop-list itinerary**.
2. **Make the geo-index *honest for moving riders*** — the foundation clubbing stands on. Keep
   busy-but-not-full riders **discoverable in the H3 index at their live position**, so a rider
   passing near a fresh pickup can actually be found and considered. (Without this, clubbing
   silently misses its best opportunities.)
3. **Make allocation a *marginal-cost clubbing decision*** — a rider may carry up to `N` (start 2)
   **interleaved** orders, inserted at their **cheapest feasible position**, with hard
   **anti-starvation** so the oldest order is never deferred forever (Model A).

**End state:** an order is held during prep, then dispatched to the rider whose route it fits most
cheaply — whether that rider is idle at home or already carrying an order and driving past — never
breaking any onboard order's promised deadline, and correctly re-indexed every tick so "who is
near this pickup right now" is always answerable.

---

## ✅ RESOLVED DECISIONS (all locked — no open gates)

Every design decision this plan depends on has been decided. Each is threaded into its stage
section below as a hard requirement.

1. **Single ranking currency → unify on marginal cost.** An idle rider is scored by inserting the
   order into an *empty* stop-list, so its marginal cost = full trip time ≈ ETAR. **Every**
   candidate (idle or busy) is ranked by one marginal-cost number, then blended with rating/load
   via the existing `getWeights`. One code path, no separate ETAR-vs-cost reconciliation.
2. **`promisedBy` first-mile → nominal constant `FIRST_MILE_NOMINAL_S = 300`.** The deadline is set
   at order creation before any rider exists, so first-mile uses a fixed nominal:
   `promisedBy = createdAt + FIRST_MILE_NOMINAL_S + prepTime_s + lastMile(haversine drop est ÷
   RIDER_SPEED_KMH) + ORDER_DEADLINE_SLACK_S`. Rider-independent and stable for life.
3. **Compatible direction → drop-to-drop bearing.** Club only if the bearing of B's drop is within
   the tolerance of an existing drop's bearing from a shared origin. **Tolerance = 45°.**
4. **Aging + head-freeze → absolute time-to-deadline.** An onboard order is **immovable** when
   `now` is within `AGING_LOCK_S = 300` s of its `promisedBy`; if the rider is within
   `HEAD_FREEZE_S = 120` s of its **next drop**, nothing may be inserted ahead of that drop
   (append after it).
5. **PENDING-order starvation → force-assign near deadline.** When a PENDING order nears its own
   `promisedBy`, force it onto the best available rider immediately, **overriding the JIT hold**.
   This is what makes "the oldest order is never deferred forever" true for *pending* orders, not
   just onboard ones.
6. **JIT grace → random 1–20 s, drawn once per order and stored.** `jitGrace_s` is a per-order
   random integer in `[1, 20]` s, assigned at creation alongside `prepTime_s` (**not** redrawn per
   tick), so `departBy = prepReadyAt − travelTime − order.jitGrace_s` counts down stably.
7. **Numeric constants (accepted starter set, all tunable):**

   | Constant | Value |
   |---|---|
   | `PREP_TIME_MIN_S` / `PREP_TIME_MAX_S` | `300` / `900` |
   | `JIT_GRACE` (per order) | random `[1, 20]` s |
   | `MAX_ALLOCATION_RANGE_KM` (`maxRangeKm`, runtime-tunable) | `5` |
   | `CLUBBING_CAP` (N-general) | `2` |
   | `CLUBBING_RESTAURANT_RADIUS_KM` | `1.5` |
   | `CLUBBING_DROP_RADIUS_KM` | `2` |
   | Bearing tolerance | `45°` |
   | `ORDER_DEADLINE_SLACK_S` | `600` |
   | `HEAD_FREEZE_S` | `120` |
   | `FIRST_MILE_NOMINAL_S` | `300` |
   | `AGING_LOCK_S` | `300` |

8. **Locked earlier:** branch `feature/multi-order-engine` off `main`; **Model A** (capped
   interleaved, cheapest-insertion, **no reorder** of existing stops); `CLUBBING_CAP` architecture
   is N-general (nothing hardcoded to 2); **engine-only** — clubbing map viz is out of scope, but
   the data is emitted so a later viz can render it.

---

## THE KEY IMPROVEMENT OVER A NAIVE CLUBBING BUILD

The clubbing candidate pool must be *"idle riders in B's restaurant H3 cells **plus busy riders
under cap whose live position is near B's restaurant**."* **That query is impossible on the current
engine:**

- A rider is **removed from `h3Buckets` the moment they're assigned** (`simulationEngine.js:538`),
  and the tick's fetch only considers `status === 'IDLE'` (`:499`). So busy riders are invisible
  to allocation — the `nextOrderId` plumbing exists but nothing feeds it.
- Even if we kept them in, the tick **never re-buckets a moving rider** — it recomputes
  `rider.h3Index` each tick (`:442`) but never relocates their bucket membership. Their index is
  frozen at the cell they were in when assigned.

The consequence (traced during debugging): a **filter can only remove, never add**, and scoring
only runs on riders we already fetched. So a busy rider who has **moved into** a new pickup's area
but whose stale index still says "elsewhere" is **never fetched, never scored, never clubbed** —
and that "moving into range" case is *exactly* the opportunity clubbing exists to capture. The
mirror case (a rider who moved *out* of range) is harmless: scoring + a live-distance gate reject
it. So the asymmetry is real and one-sided, and **no amount of scoring fixes a fetch miss.**

**Therefore this master plan inserts a geo-index correctness layer (Stage 2) between the stop-list
(Stage 1) and clubbing selection (Stage 3).** It is *load-bearing*, not decorative: it is the
difference between clubbing that works and clubbing that quietly under-fires.

---

## BUILD ORDER (three stages, strict dependency)

### STAGE 1 — Stop-list + prep + JIT hold + `WAITING`
The foundation. Replaces today's rigid two-leg state machine
(`IDLE → ACCEPTED → PICKED_UP → DELIVERED`, leg1 rider→restaurant, leg2 restaurant→customer) with
a general itinerary, and makes dispatch *timing* real.

**Config** (`config/constants.js`): `PREP_TIME_MIN_S = 300`, `PREP_TIME_MAX_S = 900`. `JIT_GRACE`
is **not** a single constant — it's a per-order random `[1,20]` s value (see Order model).

**Order model** (`models/Order.js`): add `prepTime_s` (Number), `prepReadyAt` (Date) where
`prepReadyAt = createdAt + prepTime_s` (prep starts when the order is placed), `jitGrace_s` (Number,
random `[1,20]` drawn at creation), and optional `actualWait_s` (telemetry). No new order *status* —
`WAITING` is a **rider** state; an order stays `ASSIGNED` until picked up.

**Rider model** (`models/Rider.js`): add `'WAITING'` to the status enum. Persistence stays
order-centric (`currentOrderId`/`nextOrderId`); the stop-list is an **in-memory runtime** construct
rebuilt on hydrate.

**Prep + grace on create** (`controllers/orderController.js` + `services/orderGenerator.js`): one
shared helper sets a random `prepTime_s` (→ `prepReadyAt`) and a random `jitGrace_s ∈ [1,20]` on
**every** creation path (single, bulk, auto-generated) so they stay consistent.

**Engine** (`services/simulationEngine.js`, the bulk):

- **Runtime stop-list:** replace the per-rider two-leg fields with
  `rider.stops = [{ type:'PICKUP'|'DROP', orderId, lat, lng, prepReadyAt? }, …]`. A single order is
  `[PICKUP@restaurant, DROP@customer]`; a queued next order appends its two stops after the current
  DROP (preserves today's `nextOrderId` chaining without interleaving — interleaving is Stage 3).
  The rider always moves toward `stops[0]`; each leg is `getRoute` between consecutive stops (map
  the existing leg1/leg2 polylines onto the first two legs). **Reuse** `_advanceAlongPolyline` /
  `_preAdvancePolyline` / `_positionFromPolyline`.
- **Derived statuses:** `ACCEPTED` heading to a PICKUP · `WAITING` parked at a not-ready PICKUP ·
  `PICKED_UP` heading to a DROP · `IDLE` with no stops. **Order status derived:** `ASSIGNED` until
  its PICKUP clears, `PICKED_UP` until its DROP clears, then `DELIVERED`.
- **Stop completion** on reaching `stops[0]`:
  - **PICKUP:** if `now < prepReadyAt` → enter `WAITING` (stay put) until `now ≥ prepReadyAt`,
    record `actualWait_s`, then mark the order `PICKED_UP` and advance. If ready → pick up
    immediately.
  - **DROP:** mark the order `DELIVERED`; pop its stops; if stops remain continue, else go `IDLE`
    and return home (today's behavior).
- **JIT hold (tick Phase 2), the "when" of dispatch.** There's an apparent chicken-and-egg: to know
  the departure time you need a travel time, but travel time depends on *which* rider — and no rider
  is committed during prep. It resolves because the engine can **estimate** travel without
  **committing**: on **every 1 s tick**, for each pending order it runs a *throwaway* evaluation —
  geo-filter + score to find the *current* provisional best candidate, estimate that candidate's
  travel time to the restaurant with `haversine ÷ RIDER_SPEED_KMH` (same formula ETAR uses), and
  compute `departBy = prepReadyAt − travelTime − order.jitGrace_s`. If `now < departBy`, **hold**
  (discard the estimate, do nothing this tick). The instant a tick finds `now ≥ departBy`, **commit
  that rider**, who departs immediately. Recomputed every tick, so the winner can change between
  ticks (a rider drifts, goes busy, a closer one comes online) → dispatch always uses a rider
  available *now*. The estimate is straight-line; the road-snapped `getRoute` is fetched only
  *after* assignment, and the per-order random `jitGrace_s` absorbs the error, biased so the rider
  arrives slightly *early* (brief `WAITING`) rather than late.
  - **Held, not pre-assigned:** during prep the order stays `PENDING`, candidate riders stay `IDLE`
    and fully reservable — commit only at the departure window. No "reserved, not departed" state.
  - **Edge case:** if even the best rider leaving now would arrive after `prepReadyAt` (`departBy`
    already in the past) → assign immediately, best-effort; the food waits for the rider.
- **PENDING-order anti-starvation (locked decision #5):** if a PENDING order reaches within
  `AGING_LOCK_S` of its own `promisedBy` (Stage 3 adds `promisedBy`), **force-assign** it onto the
  current best available rider immediately, overriding the JIT hold. (In a Stage-1-only build,
  before `promisedBy` exists, this hook is wired but dormant; it activates once Stage 3 lands the
  deadline field.)
- **TTL fix (must-fix):** the existing `ORDER_TTL_MS` sweep measures from `queuedAt`; a JIT-held
  order must NOT be cancelled for sitting through prep. Measure the TTL wait from when the order
  became **dispatchable** (`max(queuedAt, departBy)` / `prepReadyAt`), so only genuinely unservable
  orders are dropped.
- **Hydrate + orphan healers:** rebuild the in-memory stop-list from `currentOrderId`/`nextOrderId`
  + order statuses on start; reconstruct a `WAITING` rider when `now < prepReadyAt` at a pending
  pickup; teach the orphan/heal paths about `WAITING` + the stop-list. (Highest-care area — mirrors
  today's `hydrate` mid-leg reconstruction pattern.)
- **Telemetry:** include rider `status` (incl. `WAITING`) + prep/wait fields in the
  `simulation:tick` payload and order data; keep emitting `order:status` transitions.

**Frontend:** `components/map/RiderMarker.jsx` renders `WAITING` distinctly (colour/icon); add
`Waiting` to the Rider Map and Order Map legend arrays; consume the new status from
`SimulationContext` tick data (already flows through `riders`).

### STAGE 2 — Geo-index correctness for moving eligible riders (the bridge)
Make "who is near this pickup *right now*" always answerable, for **busy-with-capacity** riders, not
just idle ones. Scope: **index correctness + candidate discoverability only** — the *selection* stays
the existing score until Stage 3 upgrades it to marginal cost.

Background: `H3_CANDIDATE_K = 20` at resolution 7 is a ~30 km ring — larger than the ~20 km Ranchi
bounds — so the H3 filter barely bounds range today; effectively every rider in the city is a
candidate. **Scoring already uses live coords**; only candidate *generation* is stale/coarse. Hence
haversine is the **authority for "in range"**; H3 is only candidate generation.

- **Config** (`config/constants.js`): add `MAX_ALLOCATION_RANGE_KM = 5` and expose it as a
  runtime-tunable `maxRangeKm` field on the mutable H3 config: add `maxRangeKm` to the initial
  `currentH3` object; in `setH3Config`, destructure + validate (finite number `> 0`, else
  `throw new Error('maxRangeKm must be a positive number')`) and set it. `getH3Config()` already
  returns the whole object, so `GET`/`PUT /config/h3` surface it automatically (route already
  forwards the body — update its comments only).
- **Keep busy-with-a-free-slot riders in the index:** stop unconditionally removing a rider from
  `h3Buckets` at assignment (`:538`). A rider stays indexed while `activeOrders < CLUBBING_CAP` (a
  free slot remains); remove **only** when they hit capacity, re-add when a slot frees on delivery.
- **Re-bucket every tick (load-bearing hook):** track `rider.bucketCell` (the cell the rider is
  currently indexed under; add `bucketCell: null` to `_buildEntry`). Refactor the bucket helpers to
  take the rider *entry* and maintain `bucketCell`:
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
  Update the **four call sites** to pass the rider entry: hydrate (`:352`), `syncManualAllocation`
  (`:134`), tick assignment (`:538`), delivered (`:815`). In tick Phase 1, immediately after
  `rider.h3Index = latLngToCell(...)` (`:442`), call `_reindexIfBucketed(riderId, rider)`.
- **Capacity-based eligibility:** the tick fetch (`:494-502`) collects a rider if `IDLE` **or**
  (busy under `CLUBBING_CAP` with a free slot). `computeEtar` already scores busy riders via
  `timeToFree` (`allocationEngine.js:76-94`).
- **Live-distance gate (both paths):** after gathering candidates, keep a rider only if
  `haversine(livePos, restaurant) <= maxRangeKm`. Apply in the tick candidate build **and** in the
  manual path (`routes/allocation.js:35`, importing `getH3Config`).

> **Why the re-bucket hook is a no-op today but load-bearing tomorrow:** under IDLE-only
> eligibility, only IDLE riders are bucketed and IDLE riders never move (the tick skips them), so
> `bucketCell` always equals `h3Index` and `_reindexIfBucketed` never relocates anyone. The moment
> busy-with-capacity riders become eligible+bucketed (this stage), the hook keeps their index live
> automatically — correct-by-construction. With selection still on the plain existing score, Stage 2
> yields a *crude* club (nearest busy rider can win a 2nd order) — correct but not yet marginal-cost
> optimal. Stage 3 replaces the ranking without touching the (now-correct) candidate discovery.

### STAGE 3 — Marginal-cost clubbing + anti-starvation (Model A)
Now that the candidate pool is real and correct, make the *decision* smart. True **interleaved
clubbing**: a rider carries multiple orders and can pick up B while still carrying A, when it's
geographically sensible and breaks nobody's promise. B is placed at its **cheapest feasible
insertion** by **marginal cost**, with hard anti-starvation.

- **Config** (`config/constants.js`): `CLUBBING_CAP = 2` (N-general ceiling),
  `CLUBBING_RESTAURANT_RADIUS_KM = 1.5`, `CLUBBING_DROP_RADIUS_KM = 2`, bearing tolerance `45°`,
  `ORDER_DEADLINE_SLACK_S = 600`, `HEAD_FREEZE_S = 120`, `FIRST_MILE_NOMINAL_S = 300`,
  `AGING_LOCK_S = 300`.
- **Order model** (`models/Order.js`): `promisedBy` (Date), set at creation and **fixed for life** =
  `createdAt + FIRST_MILE_NOMINAL_S + prepTime_s + lastMile(haversine drop ÷ RIDER_SPEED_KMH) +
  ORDER_DEADLINE_SLACK_S` (locked decision #2 — first-mile is the nominal constant since no rider
  exists yet). This is the absolute deadline.
- **Marginal-cost machinery** (`services/allocationEngine.js`):
  - `routeTime(stops, startPos)` — total time to traverse a stop-list from `startPos`, **charging
    wait at each pickup** as `max(arrival, prepReadyAt)` (prep-aware, from Stage 1).
  - `cheapestInsertion(stops, orderB)` — try inserting B's pickup + drop at each valid position
    (**pickup before drop**, nothing before a completed stop, **existing stops never reordered**),
    score each with `routeTime`, return the cheapest feasible ordering + its cost. O(stops²),
    N-general. *(The non-reordering is exactly what keeps this Model A and avoids the factorial VRP
    blow-up of Model B.)*
  - `marginalCost = cheapestNewCost − baseCost` (base = current stop-list cost). **An idle rider's
    marginal cost is a fresh trip inserted into an empty list ≈ ETAR** — this is the unified
    ranking currency (locked decision #1). Blend with rating/load via the existing `getWeights`.
  - `deadlineOk(ordering)` — every onboard order **and** B finish before their `promisedBy` in the
    resulting ordering; otherwise the insertion is illegal.
- **Allocation loop** (`services/simulationEngine.js`, tick Phase 2):
  - **Candidate pool** = Stage 2's correctly-indexed idle **+** busy-under-cap riders, further gated
    by the **clubbing rule**: B's restaurant within `CLUBBING_RESTAURANT_RADIUS_KM` of the rider's
    path/next stop, B's drop within `CLUBBING_DROP_RADIUS_KM` of an existing drop, and a
    **compatible direction** — bearing of B's drop within `45°` of an existing drop's bearing from a
    shared origin (locked decision #3).
  - Per candidate: `cheapestInsertion → marginalCost`; **reject** on `deadlineOk` failure, the
    **head-of-route freeze** (rider within `HEAD_FREEZE_S = 120` s of its next drop → no inserting
    ahead of that drop; append after), or **aging** (an onboard order within `AGING_LOCK_S = 300` s
    of its `promisedBy` is immovable) — locked decision #4. **Winner = lowest marginal cost.**
  - **Commit:** insert B's stops into the winner's stop-list, update `activeOrders` + the onboard set,
    DB writes, `getRoute` for new/affected legs (reuse Stage 1 leg wiring). **Respects the Stage 1
    JIT hold** — clubbing decides *who* and *where in the route*, the hold decides *when* (B still
    held until its `departBy`, computed against when the chosen rider would reach B's restaurant in
    the resulting itinerary). The PENDING force-assign (decision #5) still applies as the
    anti-starvation backstop.
- **Persistence/telemetry:** persist the full **onboard-order set** (not just `currentOrderId`/
  `nextOrderId`) so `hydrate` rebuilds an N-order stop-list; extend orphan healers for multi-order
  riders; emit carrying-count + onboard order ids in `simulation:tick` (no viz yet).

**Why the cap isn't baked in (N-general):** the stop-list already holds arbitrary stops (Stage 1);
cheapest-insertion is O(stops²) and never reorders; `CLUBBING_CAP` is just the candidate-filter
ceiling — raise it and everything else works unchanged.

---

## THE LAYERED DECISION PIPELINE (how the pieces compose per pending order)

```
1. FETCH        H3 candidate cells around restaurant → pull riders from h3Buckets
                (Stage 2: idle + busy-with-free-slot, indexed at LIVE position)
2. RANGE GATE   drop anyone with haversine(livePos, restaurant) > maxRangeKm   (authority)
3. ELIGIBILITY  IDLE, or busy under CLUBBING_CAP                                (Stage 2/3)
4. CLUBBING     busy candidates must pass restaurant-near-path + drop-near-drop
   FEASIBILITY  + compatible-direction (45°) + deadlineOk + head-freeze + aging (Stage 3)
5. RANK         marginal insertion cost for everyone (idle = insert into empty
                list ≈ ETAR); blend rating/load via getWeights                 (Stage 3)
6. HOLD         commit the winner only once now ≥ departBy (JIT) — UNLESS the
                order is within AGING_LOCK_S of promisedBy → force-assign now   (Stage 1/3)
```

Stage 2 guarantees step 1 actually contains the right riders; Stage 3 makes steps 4–5 smart;
Stage 1 governs step 6. Skipping Stage 2 makes steps 4–5 operate on a pool that's missing exactly
the moving riders clubbing wants.

---

## WHY MODEL A (not B or C)

Three ways to carry multiple orders, all built on the same stop-list:

| | **A — Capped Interleaved** ⭐ | **B — True N / VRP** | **C — N-Deep Queue** |
|---|---|---|---|
| Orders/rider | 2–3 (capped) | N (unbounded) | N (queued) |
| Interleave pickup/drop? | Yes, rule-gated | Yes, fully re-optimised | No |
| Rider model | Stop-list | Stop-list + re-optimiser | FIFO queue |
| Ranking becomes | Marginal insertion cost | Full route cost | Sum of queued legs |
| Realism vs Swiggy | High | Highest | Low |
| Build complexity | Medium | High | Low |
| Demo risk | Low–Medium | High | Low |

**Model A** is the only option that both *behaves* like real food delivery (clubbing nearby orders,
interleaved pickups/drops) and stays *explainable* because of the small cap. Structuring the rider
as a stop-list from day one means **C is "A with the clubbing rule off"** and **B is "A with the cap
raised + a re-optimiser added"** — one data model, three behaviours.

---

## MAP-RENDERING CONSEQUENCES (data emitted now, viz later — out of scope)

The maps today assume *one rider = one order = one leg*. Model A breaks that. The engine must emit
the data a future viz needs (this plan emits, doesn't render):
- **Rider Map** — a rider dot needs a **×N carrying badge**; status colour reflects the itinerary.
- **Order Map** — per-order leg drawing (`OrdersMap.jsx:145,162`) still works *per order*, but one
  rider now shows **multiple drop-lines fanning out**, and can be visibly heading to B's restaurant
  while already carrying A — the clubbing is legible.
- Optionally the rider's **stitched path** (current → next stop) as its own thin line.

`simulation:tick` therefore carries each rider's carrying-count + onboard order ids (Stage 3).

---

## FILES AT A GLANCE
- `config/constants.js` — prep range (S1); `MAX_ALLOCATION_RANGE_KM` + `maxRangeKm` runtime knob
  (S2); `CLUBBING_CAP`, clubbing radii + bearing tol, deadline slack, head-freeze, first-mile
  nominal, aging lock (S3).
- `models/Order.js` — `prepTime_s`/`prepReadyAt`/`jitGrace_s`/`actualWait_s?` (S1); `promisedBy` (S3).
- `models/Rider.js` — `WAITING` status (S1).
- `controllers/orderController.js` + `services/orderGenerator.js` — prep + jitGrace on create (S1).
- **`services/simulationEngine.js`** — stop-list, WAITING, JIT hold, PENDING force-assign, TTL fix,
  hydrate (S1); keep-in-index + re-bucket hook + capacity eligibility + range gate (S2); clubbing
  candidate pool, insertion commit, N-order persistence, telemetry (S3). *(Main work throughout.)*
- `services/allocationEngine.js` — `routeTime`, `cheapestInsertion`, `marginalCost`, `deadlineOk`
  (S3); range-gate reuse.
- `routes/allocation.js` — capacity eligibility + range gate on the manual path (S2).
- `routes/config.js` — doc-only note for `maxRangeKm` (route already forwards the body).
- Frontend — `components/map/RiderMarker.jsx` + legends for `WAITING` (S1). Clubbing viz (×N badge,
  stitched path) is **out of scope**.

**Reuse:** `_advanceAlongPolyline` / `_preAdvancePolyline` / `_positionFromPolyline`, `getRoute`,
the haversine travel-time calc, `computeEtar` (`timeToFree` already handles busy riders), the
existing `hydrate` mid-leg reconstruction, `_addToH3`/`_removeFromH3`, and `getWeights` — all in
`simulationEngine.js`/`allocationEngine.js`; `RIDER_SPEED_KMH`/`ORDER_TTL_MS`/`getH3Config` in
`constants.js`.

---

## VERIFICATION (end-to-end, per stage)

**Stage 1 —** new orders (single, bulk, auto) get `prepTime_s` in range, `prepReadyAt`, and a
`jitGrace_s ∈ [1,20]`; a rider is *held* (not dispatched instantly) until ~`prepReadyAt −
travelTime − jitGrace`; forcing short-travel/long-prep drives a rider into `WAITING` (renders
distinctly), then pickup at `prepReadyAt`; a JIT-held order is **not** TTL-cancelled; restart
mid-leg/`WAITING` re-hydrates correctly.

**Stage 2 —** `GET /config/h3` includes `maxRangeKm: 5`; `PUT` it to `1` → orders with no rider
within 1 km live-distance stay PENDING (invalid values → 400); a **busy** rider under cap appears
in candidate logs for a pending order near its **current** position (proving live re-indexing), and
its stale start cell no longer determines eligibility; at capacity the rider drops out of the index;
no regression to normal idle allocation/pickup/delivery (the re-bucket hook is a no-op under
IDLE-only).

**Stage 3 —** helper unit fixtures for `routeTime`/`cheapestInsertion`/`marginalCost`/`deadlineOk`
(incl. prep/wait charging + pickup-before-drop); with clustered orders a busy rider with a nearby
drop **beats a farther idle rider** on marginal cost; anti-starvation holds — the oldest onboard
order is never pushed past `promisedBy` (deadline-validated insertion + `HEAD_FREEZE_S` +
`AGING_LOCK_S` reject starving inserts), and a starving **PENDING** order is force-assigned within
`AGING_LOCK_S` of its `promisedBy`; raise `CLUBBING_CAP` to 3+ → generalizes with no code change;
restart rebuilds an N-order stop-list; branch runs standalone with clean backend imports and a
passing frontend `npm run build`.

---

## HOW THIS COMPARES TO PRODUCTION SCALE

The *concepts* are production-accurate; the *mechanics* are a deliberate single-node, deterministic,
explainable stand-in. Honest breakdown:
- **Authentic at scale:** held / just-in-time assignment; shortlisting via a spatial index (H3/S2);
  multi-signal ranking (ETA + load + rating).
- **Diverges — matching:** we re-evaluate every 1 s tick and greedily pick the best rider for *each
  pending order one at a time*. Production accumulates orders + riders over a short **batching
  window** and solves a **global assignment optimization** (bipartite / min-cost-flow / VRP) across
  many at once. Ours is simpler and fully explainable, not globally optimal.
- **Diverges — estimates:** straight-line haversine ÷ fixed speed + random prep, vs production **ML
  ETA models** on live traffic/weather/road network, **real road-network routing**, and **ML
  prep-time prediction**. `jitGrace` papers over our cruder estimate.
- **Diverges — runtime:** a single 1 s `setInterval` over an in-memory `Map` in one process, vs a
  distributed, event-driven pipeline (Kafka streams, shared spatial index, sharded workers).

One-liner: **the skeleton (held dispatch + spatial-index shortlist + multi-signal marginal-cost
ranking) is real; the per-order greedy tick, haversine/random estimates, and single-process loop are
the intentional simplifications.** A future "batched global optimization" phase is the natural next
step.

---

## OUT OF SCOPE (future)
- **Model B / VRP** — full route re-optimization (reordering all stops) + continuous per-tick
  re-insertion. This plan keeps cheapest-insertion (no reorder) = Model A.
- **Clubbing map visualization** — ×N badge, stitched path, multi-drop lines (emit the data now,
  render later).
- **Decomposed First-Mile/Wait/Last-Mile ETA display** — dropped as user-facing; timings stay
  internal (already produced by Stage 1).
- **Batched global optimization** (bipartite / min-cost-flow across many orders at once), ML
  ETA/prep models, real road-network routing, distributed event-driven runtime.
- Per-restaurant / backlog-driven prep time (random-range only for now).

## RELATED DOCS (optional deeper background — not required to build)
`PHASE4_PLAN.md`, `PHASE6_PLAN.md` (original per-stage specs) · `ALLOCATION_LOGIC_MODEL.md` (Model A
vs B vs C rationale + map rendering) · `PLAN.md` (the H3 geo-filter sub-plan, now absorbed into
Stage 2) · `NEXT_PHASES.md`, `ZOMATO.md` §5–8, `SCALE.md`.
