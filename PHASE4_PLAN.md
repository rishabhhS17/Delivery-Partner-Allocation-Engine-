# Phase 4 — Food-prep time + Just-in-time dispatch + `WAITING` state

Branch: **`feature/multi-order-engine`** (off `enhancements`), built standalone. Phase 4 is the
foundation for Phases 5–6 on the same branch.

## Context

Today the engine assigns a rider the instant an order is pending, and a rider is a rigid
two-leg machine (leg1 rider→restaurant, leg2 restaurant→customer) with no notion of the food
not being ready. Phase 4 makes dispatch *timing* real: model food-prep time, hold the
assignment so a rider arrives roughly as the food is ready ("just-in-time"), and add a genuine
`WAITING` state for a rider who reaches the restaurant early. It also replaces the fixed two-leg
machine with a **rider stop-list** so Phase 6 clubbing drops in without a second rewrite. This
**supersedes** the old "restaurants list orders only when they're ready" simplification.

### Decisions locked (from the user)
1. **Stop-list itinerary now** — rider carries an ordered list of PICKUP/DROP stops; `WAITING`
   is a stop state. Movement model is reworked once.
2. **Random prep time per order** — a duration drawn from a configurable range in `constants.js`.
3. **Just-in-time hold + WAITING fallback** — delay assignment so the rider departs to arrive as
   food is ready; if prep overruns (or the rider is released a touch early), they WAIT at the
   restaurant.
4. **Distinct WAITING on the map + telemetry** — WAITING riders render distinctly and prep/wait
   timing is exposed in the tick + order data (also feeds Phase 5).

---

## Backend changes (`backend/src`)

### 1. Config — `config/constants.js`
Add (single source of truth, per project convention): `PREP_TIME_MIN_S`, `PREP_TIME_MAX_S`
(e.g. 300–900 s), and `JIT_GRACE_S` (small margin so riders arrive just before ready, not late).

### 2. Order model — `models/Order.js`
Add `prepTime_s` (Number) and `prepReadyAt` (Date). Prep starts when the order is placed, so
`prepReadyAt = createdAt + prepTime_s`. (No new order *status* — `WAITING` is a rider state; an
order stays `ASSIGNED` until picked up.) Optionally `actualWait_s` for Phase 5 telemetry.

### 3. Rider model — `models/Rider.js`
Add `'WAITING'` to the `status` enum. Persistence stays order-centric (`currentOrderId` /
`nextOrderId`); the stop-list is an **in-memory runtime** construct rebuilt on hydrate.

### 4. Set prep time at order creation — `controllers/orderController.js` + `services/orderGenerator.js`
When any order is created (single, bulk, auto-generated), assign a random `prepTime_s` in range
and derive `prepReadyAt`. One shared helper so all creation paths stay consistent.

### 5. Simulation engine rework — `services/simulationEngine.js` (the bulk of Phase 4)
- **Runtime stop-list:** replace the per-rider two-leg fields with `rider.stops = [{ type:
  'PICKUP'|'DROP', orderId, lat, lng, prepReadyAt? }, …]`. For a single order that's
  `[PICKUP@restaurant, DROP@customer]`; a queued next order appends its two stops after the
  current DROP (preserves today's `nextOrderId` chaining without interleaving — interleaving is
  Phase 6). The rider always moves toward `stops[0]`; each leg is `getRoute` between consecutive
  stops (map the existing leg1/leg2 polylines onto the first two legs).
- **Derived statuses:** rider status = `ACCEPTED` while heading to a PICKUP, `WAITING` while
  parked at a not-ready PICKUP, `PICKED_UP` while heading to a DROP, `IDLE` with no stops. Order
  status derived: `ASSIGNED` until its PICKUP clears, `PICKED_UP` until its DROP clears, then
  `DELIVERED`.
- **Tick movement + stop completion:** reuse `_advanceAlongPolyline` / lerp. On reaching a stop:
  - **PICKUP:** if `now < prepReadyAt` → enter `WAITING` (stay put) until `now ≥ prepReadyAt`,
    then mark the order `PICKED_UP`, advance to the DROP leg. If ready → pick up immediately.
    Record `actualWait_s`.
  - **DROP:** mark the order `DELIVERED`; pop its stops; if more stops remain continue, else go
    `IDLE` and return to home base (today's behavior).
- **Just-in-time hold (allocation, tick Phase 2):** for each pending order, find the best
  candidate and its travel time to the restaurant (existing haversine/speed calc). Compute
  `departBy = prepReadyAt − travelTime − JIT_GRACE`. If `now < departBy`, **hold** (skip
  assigning this tick); assign once `now ≥ departBy`. WAITING remains the fallback for prep
  overrun / early arrival.
  - **Held, not pre-assigned (confirmed decision).** During prep the order stays `PENDING` and
    unassigned, and candidate riders stay `IDLE` and fully reservable — the engine commits the
    best rider only at the departure window, then they head out immediately. It does **not**
    assign a rider up front and have them wait for a scheduled departure (that would commit the
    rider early and need an extra "reserved, not departed" state). This keeps the fleet flexible,
    matching real dispatch.
- **TTL interaction (must-fix):** the existing `ORDER_TTL_MS` sweep measures time from
  `queuedAt`; a JIT-held order must NOT be cancelled for sitting through prep. Measure the TTL
  wait from when the order became **dispatchable** (`max(queuedAt, departBy)` or from
  `prepReadyAt`), so only genuinely unservable orders are dropped.
- **Hydrate + orphan healers:** rebuild the in-memory stop-list from `currentOrderId` /
  `nextOrderId` + order statuses on start; reconstruct a `WAITING` rider when
  `now < prepReadyAt` at a pending pickup; extend the orphan/heal paths to understand `WAITING`
  and the stop-list. (Highest-care area — mirrors today's `hydrate` mid-leg reconstruction.)
- **Telemetry:** include rider `status` (incl. `WAITING`) and prep/wait fields in the
  `simulation:tick` payload and order data; keep emitting `order:status` transitions.

---

## How the hold decides *when* to dispatch (mechanism)

There's an apparent chicken-and-egg here: to know the departure time you need a travel time,
but travel time depends on *which* rider — and in the held model no rider is committed during
prep. It resolves because the engine can **estimate** a travel time without **committing** a
rider:

- The engine knows every idle rider's live position (in-memory `riderState`). So on **every
  tick** (1 s), for each pending order it runs a throwaway evaluation: geo-filter + score to find
  the *current* best candidate (provisional, not committed), estimate that candidate's travel
  time to the restaurant with the **same haversine ÷ `RIDER_SPEED_KMH`** formula already used for
  ETAR, and compute `departBy = prepReadyAt − travelTime − JIT_GRACE`.
- If `now < departBy`, it **holds** (discards the estimate and does nothing this tick). The
  instant a tick finds `now ≥ departBy`, it **commits that rider**, who departs immediately.
- Because it recomputes every tick, the "best candidate" can change between ticks (a rider drifts,
  goes busy, or a closer one comes online) — so dispatch always uses a rider actually available
  *right now*. Distance drives the timing per candidate: a closer rider (shorter travel → later
  `departBy`) lets the engine wait longer; a farther one (earlier `departBy`) makes it leave
  sooner.
- The estimate is **straight-line**; the road-snapped route (`getRoute`) is fetched only *after*
  assignment, so the pre-dispatch number is approximate. `JIT_GRACE` absorbs that error, biased so
  the rider arrives slightly *early* (brief `WAITING`) rather than late.
- **Edge case:** if even the best rider leaving now would arrive after `prepReadyAt` (`departBy`
  is already in the past), assign immediately — best effort — and the food waits for the rider.

---

## Frontend changes (`frontend/src`)
- **`components/map/RiderMarker.jsx`** — render `WAITING` distinctly (colour/icon), separate
  from ACCEPTED/PICKED_UP/IDLE.
- **Map legends** — add a `Waiting` entry on the Rider Map and Order Map legend arrays.
- **Consume telemetry** — read the new rider `status` from `SimulationContext` tick data (already
  flows through `riders`); optionally surface a rider's prep/wait in tooltips. (The decomposed
  First-Mile/Wait/Last-Mile ETA display is **Phase 5**, not here.)

---

## Files at a glance
- **Backend:** `config/constants.js` (prep range + grace), `models/Order.js` (prep fields),
  `models/Rider.js` (`WAITING` status), `controllers/orderController.js` +
  `services/orderGenerator.js` (set prep on create), **`services/simulationEngine.js`**
  (stop-list, WAITING, JIT hold, TTL fix, hydrate/orphan, telemetry — the main work).
- **Frontend:** `components/map/RiderMarker.jsx`, Rider/Order map legend arrays, tick consumption.

Reuse: `_advanceAlongPolyline` / `_preAdvancePolyline` / `_positionFromPolyline`, `getRoute`,
the haversine travel-time calc, and the existing `hydrate` mid-leg reconstruction pattern — all
in `simulationEngine.js`; `RIDER_SPEED_KMH` / `ORDER_TTL_MS` in `constants.js`.

---

## Verification (end-to-end)
1. **Prep on create:** new orders have `prepTime_s` in range and `prepReadyAt = createdAt +
   prepTime_s` (single, bulk, and auto-generated paths).
2. **Just-in-time:** a rider is not dispatched the instant an order appears — assignment is held
   until near `prepReadyAt − travelTime`; watch logs/timeline that the rider departs late enough
   to arrive ~as food is ready.
3. **WAITING:** force a short travel + long prep (or vice-versa) so a rider reaches the
   restaurant early → rider enters `WAITING`, stays put, then picks up at `prepReadyAt` and
   proceeds to the customer. The map shows the WAITING state distinctly.
4. **TTL safety:** an order held through prep is NOT cancelled by the TTL sweep; only orders with
   no serviceable rider after becoming dispatchable are cancelled.
5. **Restart:** stop/kill mid-run and re-hydrate — a rider mid-leg or WAITING is reconstructed
   correctly (position + state), orders aren't orphaned.
6. **Standalone:** the branch runs and is fully verifiable without any code from
   `feature/allocation-viz`; backend imports clean; frontend `npm run build` passes.

## How this compares to production scale

The *concepts* here are production-accurate; the *mechanics* are a deliberate single-node,
deterministic, explainable stand-in. Honest breakdown:

- **Authentic at scale:** held / just-in-time assignment (defer dispatch until near food-ready is
  a real, major efficiency lever — `ZOMATO.md` §5); shortlisting via a spatial index (H3/S2 grids
  — Uber created H3); multi-signal ranking (ETA + load + rating + more).
- **Diverges — matching mechanism:** we re-evaluate every 1 s tick and greedily pick the best
  rider for *each pending order one at a time*. At scale, dispatch accumulates orders + available
  riders over a short **batching window** (seconds to ~a minute) and solves a **global assignment
  optimization** across many orders and riders at once (bipartite / min-cost-flow / VRP), which
  beats greedy per-order matching. Ours is simpler and fully explainable, not globally optimal.
- **Diverges — the estimates:** we use straight-line haversine ÷ fixed speed for travel and a
  random range for prep. Production uses **ML ETA models** on live traffic/weather/road network
  (Swiggy's four-leg ETA — `ZOMATO.md` §8), **real road-network routing**, and an **ML prep-time
  prediction** from restaurant history + current kitchen backlog. `JIT_GRACE` exists to paper over
  our cruder estimate.
- **Diverges — the runtime:** a single 1 s `setInterval` over an in-memory `Map` in one process
  is the opposite of scale. Production dispatch is distributed and event-driven — streaming
  order/rider events (Kafka), a shared spatial index (Redis/geo-service), many dispatch workers,
  sharded by city/region. This is exactly the "one thing that gates production" in `SCALE.md`.

One-liner: **the skeleton (held dispatch + spatial-index shortlist + multi-signal ranking) is
real; the per-order greedy tick, haversine/random estimates, and single-process loop are the
intentional simplifications.** A future "batched global optimization" phase would be the natural,
impressive step toward the production matching model.

---

## Out of scope (later on this branch / future)
- Decomposed First-Mile / Wait / Last-Mile ETA display → **Phase 5**.
- Interleaved multi-order clubbing + marginal-cost ETAR + anti-starvation → **Phase 6** (builds
  on this stop-list).
- Per-restaurant / backlog-driven prep time (random-range only for now).

## Related docs
- `NEXT_PHASES.md` §4 — Phase 4 in the roadmap.  `ALLOCATION_LOGIC_MODEL.md` — the stop-list /
  Model A rationale.  `ZOMATO.md` §5, §8 — just-in-time dispatch + the Wait-time leg.
- `PLAN.md` — branch strategy (this is the first step of `feature/multi-order-engine`).
