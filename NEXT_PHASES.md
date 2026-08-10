# Next Phases — Roadmap of Upcoming Work

Planned work after the current `enhancements` branch. Phase 1 carries over the one item
from `ENHANCEMENTS.md` that was marked future work (RBAC + Audit Log); the remaining phases
are the realistic, map-visible improvements identified in `ZOMATO.md` §10, including the
food-prep / wait-time dispatch logic.

For every phase: **What we're doing** states the goal; **Implementation** explains how, at a
design level (no code). Phases are ordered so cheaper, foundational work comes before the
features that build on it.

> Note on the wait-time phases (Phase 4–5): adding food-prep time deliberately **supersedes**
> the earlier "restaurants list orders only when they're ready" simplification. We're choosing
> to model preparation explicitly because dispatch *timing* — deciding *when* to assign — is
> one of the most sophisticated parts of a real engine and worth demonstrating. Once we model
> prep, the rider can genuinely arrive before the food, so a wait becomes real and meaningful.

---

## Phase 1 — RBAC (roles + owner approval) + Audit Log

**What we're doing.** Give authentication real teeth. Today login is decorative: anyone can
register, everyone lands on the same admin view, everyone sees the same data. We introduce a
two-role model (Guest, Admin/owner), an owner-gated approval flow so registration is a
*request* rather than an automatic grant, and an append-only audit trail of who created or
deleted riders, customers, and restaurants.

**Implementation.**
- **Roles.** Add a `role` field to the user model (`'guest' | 'admin'`, default `guest`).
  Enforcement is layered: the backend is the real authority via a `requireRole('admin')`
  middleware on all mutating and admin-only routes; the frontend gate is cosmetic — a
  role-aware route guard and nav that only renders the five Guest-allowed pages (Dashboard,
  Rider Map, Order Map, Orders, Customers) and redirects direct-URL access to anything else.
  Guests are read-only and specifically cannot delete customers; only Admins can.
- **Approval flow.** One or more admins exist (the first account, or an env-designated email,
  is seeded as admin). When a non-admin registers, the account is created in a **pending**
  state and cannot log in yet; an access request is raised and shown to all owners. An owner
  **grants** (pending → guest, activated) or **denies** it. The frontend offers "Enter as
  Admin" / "Enter as Guest," and a Guest can raise a "Request Admin Access."
- **Audit log.** A new append-only `AuditLog` collection, written from the create/delete
  controllers through a small shared helper so every mutation logs consistently. Each entry
  records timestamp, actor (id/name + role), action (`CREATE`/`DELETE`), entity type
  (`RIDER`/`CUSTOMER`/`RESTAURANT`), entity id, and a short readable label. An admin-only
  Audit Log page shows a reverse-chronological table, filterable by entity type and action.
- **Out of scope:** no per-page permission matrix beyond the two roles, no audit logging for
  reads or order/allocation events, no email/push on approval (in-app owner view is enough).

---

## Phase 2 — Draw the H3 candidate zone on the map

**What we're doing.** Make the geo-filtering step *visible*. The engine already narrows the
whole fleet down to the riders inside a small ring of H3 hexagons around the restaurant, but
that step is invisible today. We render that ring on the Order/Rider map so a viewer can see
the engine shortlist candidates before scoring them. Highest visual payoff, lowest effort,
and it doesn't touch any allocation logic.

**Implementation.**
- The engine already computes the candidate cells (`getCandidateCells` in
  `allocationEngine.js` returns the k=2 disk — 19 cells at H3 resolution 7 — around the
  restaurant). Each H3 cell has a fixed hexagonal boundary that H3 can return as a ring of
  lat/lng vertices.
- When an order is being allocated, convert its candidate cells into those boundary polygons
  and emit them to the frontend over the existing Socket.IO channel alongside the order.
- On the frontend, draw the polygons as a hexagon overlay layer on Mapbox and highlight which
  rider pins fall inside the zone. Purely additive rendering on data we already produce.

---

## Phase 3 — Demand heatmap / surge zones

**What we're doing.** Colour the map by where unserved demand is concentrated — a live
heatmap of pending-order density per H3 cell — so clustering and pressure are visible. This
is the reactive precursor to the predictive surge/pre-positioning idea in `ZOMATO.md` §9.

**Implementation.**
- Reuses the hexagon-rendering mechanism built in Phase 2. Instead of drawing one order's
  candidate ring, aggregate the live `pendingQueue`: bucket every pending order by the H3 cell
  it sits in and count orders per cell.
- Emit those per-cell counts to the frontend and colour each hexagon by intensity (light where
  quiet, hot where dense).
- Optional extension: a simple rule that nudges idle riders toward the hottest nearby cell,
  standing in for real demand pre-positioning — noted as a stretch, not required.

---

## Phase 4 — Food-prep time + just-in-time dispatch + `WAITING` state

**What we're doing.** Model that food takes time to cook, and time the assignment so the rider
arrives roughly *as the food is ready* instead of the instant the order appears. This adds the
single biggest realism jump — the "deciding *when* to assign" lever real systems use — and
introduces a genuine `WAITING` state for a rider who reaches the restaurant early.

**Implementation.**
- **Model prep time.** Give each order an estimated food-prep duration when it's created
  (a randomised range, or a per-restaurant value), and derive a `prepReadyAt` timestamp
  (creation time + prep duration).
- **Just-in-time hold.** In the tick's allocation loop, for each pending order find the best
  candidate and estimate their travel time to the restaurant (the leg-1 duration we already
  compute). If assigning now would make the rider arrive well *before* `prepReadyAt`, **hold**
  the assignment for this tick rather than assigning immediately — release it only once the
  window `prepReadyAt − travelTime` is reached, so the rider leaves at the right moment. A
  small grace margin keeps riders from arriving late.
- **`WAITING` state.** Add `WAITING` to the rider state machine. If a rider still reaches the
  restaurant before the food is ready (prep ran long, or they were released a touch early),
  completing leg 1 transitions them to `WAITING` at the restaurant instead of straight to
  `PICKED_UP`. Each tick, a `WAITING` rider checks whether `now ≥ prepReadyAt`; once true, they
  transition to `PICKED_UP` and start leg 2. This means the map shows a rider parked at the
  restaurant, which is exactly the real behaviour.
- **Consequence to document:** this replaces the "listed only when ready" assumption. It also
  changes efficiency dynamics (riders may be held briefly before dispatch), which is the point
  — it minimises both restaurant wait and rider idle time, and it's invisible to the customer.

---

## Phase 5 — Decomposed ETA on order popups

**What we're doing.** Show the delivery-time estimate as its component legs — First Mile
(rider → restaurant), Wait (at the restaurant), Last Mile (restaurant → customer) — instead of
one opaque number, mirroring Swiggy's multi-leg ETA model (`ZOMATO.md` §8).

**Implementation.**
- Mostly a display of data we already compute: `leg1Duration_s` is the First-Mile time and
  `leg2Duration_s` is the Last-Mile time, so an order popup can show that split with almost no
  new backend logic.
- The Wait slot becomes meaningful **because of Phase 4**: it's the modelled prep/wait time
  (`prepReadyAt` minus arrival, or the time actually spent in `WAITING`). Built before Phase 4,
  this slot would simply be zero; after Phase 4 it carries a real number.
- Frontend change only: extend the order popup component to render the three legs and their sum.

---

## Phase 6 — Model A: Capped Interleaved Clubbing (marginal-cost ETAR + anti-starvation)

**What we're doing.** Replace single-order `nextOrderId` chaining with true order *clubbing* —
a rider carries up to a small cap of orders (start at 2, allow 3) and may interleave pickups
and drops when it's geographically sensible, chosen by **marginal insertion cost**, with hard
**fairness guarantees so no order starves**. This is Model A from `ALLOCATION_LOGIC_MODEL.md`
and the engine that makes real batching (`ZOMATO.md` §7) both authentic and explainable.

**Implementation.**

*Foundation — the rider is a stop-list (laid in Phase 4).*
- A rider stops being a two-leg machine and becomes an **ordered itinerary** `stops[]`, each
  stop a `PICKUP` or `DROP` tagged with its order id, coordinates, and (for pickups) the
  `prepReadyAt` from Phase 4. `activeOrders` is the live distinct-order count. The rider always
  moves toward `stops[0]`; each leg is `getRoute` between consecutive stops. Order status is
  *derived*: `ASSIGNED` until its pickup clears, `PICKED_UP` until its drop clears, then
  `DELIVERED`. A pickup whose food isn't ready parks the rider in `WAITING` (Phase 4) until
  `prepReadyAt`.

*Candidate gathering (reuses Phase 2's H3 ring).*
- For a new order B, candidates are the idle riders in B's restaurant candidate cells (as
  today) **plus** busy riders that are under the cap, sit near B's restaurant, and already have
  a drop within Y km of B's drop heading the same general direction. The H3 ring is the cheap
  first filter; marginal cost is the expensive second.

*Marginal-cost ETAR (the ranking change).*
- For each candidate compute a **base cost** = time to traverse its current `stops[]` from its
  current position, charging wait time at each pickup as `max(arrival, prepReadyAt)`.
- Try inserting B's pickup+drop into the itinerary. Because the cap is ≤3 (≤6 stops), **brute-
  force every valid ordering** (pickup before drop, nothing before an already-completed stop),
  compute each total, and keep the cheapest → **new cost**.
- **Marginal cost = new cost − base cost** = the extra minutes B adds. An idle rider's marginal
  cost is just a fresh two-leg trip. Lowest marginal cost (blended with rating/load as
  `allocateOrder` does today) wins — so a rider already passing B's restaurant with a nearby
  drop can rightly beat a closer idle rider.

*Anti-starvation guarantees (why the greedy cost function can't defer an order forever).*
- **The cap bounds instantaneous load, not cumulative deferral.** As orders complete, freed
  slots reopen and new orders can keep leapfrogging the oldest one. The cap alone does **not**
  fix this — the following do:
- **Absolute deadline per order.** At creation, stamp `promisedBy = createdAt + estimate(first-
  mile + prep + last-mile) + slack`, stored on the order and fixed for life so it can't drift.
- **Deadline-validated insertion.** An insertion is legal only if, in the *resulting*
  itinerary, **every** onboard order still finishes before its `promisedBy` — not just the new
  one. Any ordering that breaches any deadline is rejected. This caps each order's total
  detour absolutely: it can be delayed only up to its own deadline, never past it.
- **Head-of-route freeze.** Once the rider is en route to a drop and that order is within a
  small time/distance of completion, forbid inserting any stop *ahead* of it — new stops may
  only append after that drop. Guarantees forward progress on the leading order.
- **Aging.** An onboard order's urgency rises as it nears its deadline; near-deadline orders
  become effectively immovable, so the itinerary locks tighter the longer an order waits.
- **(Optional, stricter) picked-up protection.** Never insert a stop before the drop of an
  already-*picked-up* order — club only affects not-yet-collected orders. Reach for this only
  if the deadline guard + head-freeze prove insufficient in simulation.
- Note this is distinct from the existing TTL→CANCELLED (`ENHANCEMENTS.md` §1), which only
  protects orders while still `PENDING`; the deadline guard covers the *post-assignment* window
  the TTL doesn't. Both can share the one `promisedBy` value.

*Persistence & visualization (folds in the old batching-visual work).*
- Store `stops[]` and each order's `promisedBy`; derive order status from stop completion.
- **Rider Map** — a rider dot gains a **"×N" carrying badge**, coloured by whether it holds a
  picked-up order. **Order Map** — per-order leg colours are preserved, but two drop-lines now
  fan from one rider pin, and the rider's **stitched current→next-stop path** renders as a thin
  line so the clubbing is legible on screen.

*Tuning via Phase 3.* Inside hot heatmap cells, loosen the clubbing thresholds / raise the cap
(batch harder at peak, like real systems); tighten them where demand is quiet.

*Build note.* Structure the stop-list from day one (in Phase 4) so Model C is "this with
clubbing off" and Model B is "this with the cap raised + a re-optimiser" — one data model,
three behaviours (`ALLOCATION_LOGIC_MODEL.md`).

---

## Suggested build order & rationale

| Phase | Depends on | Why here |
|---|---|---|
| 1 — RBAC + Audit | — | Carries over from `ENHANCEMENTS.md`; independent of the map work |
| 2 — Draw H3 zone | — | Cheap, foundational; the hexagon renderer is reused by Phase 3 |
| 3 — Demand heatmap | Phase 2 | Reuses the hexagon overlay |
| 4 — Prep + just-in-time + `WAITING` | — | Biggest realism jump; makes Phase 5's Wait leg real |
| 5 — Decomposed ETA | Phase 4 | Wait slot only meaningful once prep is modelled |
| 6 — Model A clubbing (marginal-cost + anti-starvation) | Phases 2, 3, 4 | Needs the Phase 4 stop-list; reuses the Phase 2 ring for candidates and the Phase 3 heatmap for tuning |

---

## Related docs

- `ENHANCEMENTS.md` — the current branch's work; §4 (RBAC + Audit) becomes Phase 1 here.
- `ZOMATO.md` — how real dispatch works; §10 lists the addable items realised as Phases 2–6.
- `SCALE.md` — the horizontal-scaling roadmap (orthogonal to these feature phases).
