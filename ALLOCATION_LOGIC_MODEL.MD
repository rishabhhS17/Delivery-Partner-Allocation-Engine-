# Allocation Logic Models — Multi-Order Delivery

Design-comparison doc. We currently allow **one active order + one queued order** per
rider. This explores how to move to **multiple orders per rider**, and — critically —
how each option would **look on the Rider Map and the Order Map**, because if we can't
show it in the simulation, it doesn't count.

> Status: brainstorming / approaches. No code changed. Pick a model, then we write a
> real spec + implementation plan.

---

## 0. What we have today (the baseline)

Each rider is a **strict two-leg state machine** (`simulationEngine.js`):
```
IDLE ──assign──▶ ACCEPTED ──arrive restaurant──▶ PICKED_UP ──arrive customer──▶ DELIVERED
                 (leg 1: rider→restaurant)        (leg 2: restaurant→customer)
```

- A rider carries **exactly one** active order (`currentOrderId`) and may hold **one**
  pre-assigned order (`nextOrderId`, `Rider.js:15`).
- The queued order does **not** start until the current one is fully `DELIVERED` — then
  `_transitionToDelivered` chains it in (`simulationEngine.js:720`).
- **ETAR** = time to finish the current leg(s) + straight-line travel to the new pickup
  (`allocationEngine.js:85`).

**How the maps render it today:**
- **Order Map** draws routes **per order**: the `leg1Coords` line while the order is
  `ASSIGNED` (`OrdersMap.jsx:145`) and the `leg2Coords` line while `PICKED_UP`
  (`OrdersMap.jsx:162`). One rider marker sits on exactly one of those legs.
- **Rider Map** shows the whole fleet; a rider is a single dot with a status colour.

👉 **The key assumption baked into the maps:** *one rider = one order = one leg at a
time.* Every multi-order model below has to deal with breaking that assumption.

---

## The structural pivot (shared by all real multi-order models)

To carry multiple orders, a rider stops being a two-leg machine and becomes an
**ordered stop-list (itinerary)**:

```
rider.stops = [
  { type: 'PICKUP', orderId: A, lat, lng },
  { type: 'PICKUP', orderId: B, lat, lng },
  { type: 'DROP',   orderId: A, lat, lng },
  { type: 'DROP',   orderId: B, lat, lng },
]
```

The rider walks the list top to bottom. Each **leg** is now "current position → next
stop," and completing a stop just advances the pointer. Order status is derived:
an order is `ASSIGNED` until its PICKUP stop is done, `PICKED_UP` until its DROP stop is
done, then `DELIVERED`. The three models below differ only in **how many orders may be
on the list** and **how the list is allowed to be ordered**.

---

## Model A — Capped Interleaved (realistic "clubbing")  ⭐ recommended

**Concept.** A rider holds **at most 2–3 orders**, and may pick up order B while still
carrying A — but only when it's geographically sensible (B's restaurant is near the
rider's path and B's drop is near A's drop). This is exactly how Swiggy/Zomato order
*clubbing* works. The cap keeps it understandable.

**Delivery pipeline.** Interleaved stop-list, e.g.:

```
[A pickup] ──▶ [B pickup] ──▶ [A drop] ──▶ [B drop]
```

A second order is only *inserted* when a **clubbing rule** passes, e.g.:
- rider currently has < CAP orders, and
- B's restaurant is within X km of the rider's current position / next stop, and
- B's drop is within Y km of an existing drop (same direction).

**Data model.** Replace the single `nextOrderId` with `rider.stops[]` (the itinerary).
`activeOrders` already exists (`Rider.js:13`) and becomes the live count.

**Allocation & ETAR.** ETAR stops being "time to become free." It becomes **marginal
insertion cost**: "how many extra minutes does adding B to my current route cost?" A
rider with two nearby drops can *beat* an idle rider that's farther away — which is the
whole point of clubbing.

**Simulation & maps.** This is the visually richest option:
- **Rider Map** — a rider dot now needs a **badge for how many orders it carries**
  (e.g. "×2"). Status colour reflects the itinerary (carrying ≥1 picked-up order).
- **Order Map** — the per-order leg drawing (`OrdersMap.jsx:145,162`) still works
  *per order*, but multiple orders now share one rider. You'd see **two drop-lines
  fanning out from the same rider dot**, and a rider that has "picked up" A but is
  visibly moving *toward B's restaurant first* — the clubbing is legible on screen.
- We can render the rider's actual **stitched path** (current → next stop) as its own
  thin line so viewers see the real route, with each order's legs still colour-coded.

**Pros:** authentic food-delivery behaviour; great interview story; cap keeps it
reasonable; reuses the existing per-order leg rendering.
**Cons:** need a clubbing rule + marginal-cost ETAR; the maps need a "carrying N" badge
and slightly smarter route drawing.

---

## Model B — True N-Order Route Engine (VRP-lite)

**Concept.** No fixed cap. A rider can hold N orders, and every time an order is added
the **entire route is re-optimised** across all pickups and drops — a live, tiny
Vehicle-Routing Problem.

**Delivery pipeline.** Fully dynamic stop-list, re-ordered on every assignment:

```
[C pickup] ──▶ [A pickup] ──▶ [C drop] ──▶ [B pickup] ──▶ [A drop] ──▶ [B drop]
```

**Data model.** Same `rider.stops[]`, but with a re-optimiser (insertion heuristic, or
nearest-stop, or 2-opt) that can reorder existing stops, not just append.

**Allocation & ETAR.** Full route cost with a **pickup-before-drop constraint** per
order (can't drop what you haven't picked up). This is where it gets mathematically
heavy.

**Simulation & maps.** Impressive but potentially confusing:
- **Rider Map** — a single rider could carry 4–5 orders; the "×N" badge grows, and the
  fleet view gets dense.
- **Order Map** — many overlapping legs on one rider; the stitched path can zig-zag and
  **re-order mid-flight** as new orders arrive, which looks chaotic and is hard to
  narrate to a viewer.

**Pros:** maximum efficiency; genuinely "production routing."
**Cons:** hardest to build *and* to explain; on-screen it can look like noise; easy to
introduce bugs (constraint violations, route thrash). High risk for a student demo.

---

## Model C — N-Deep Sequential Queue (no interleaving)

**Concept.** The smallest change. Keep the strict "finish the current order **completely**
before starting the next" rule, but let **more than one** order queue behind the active
one. `nextOrderId` becomes a queue of length N.

**Delivery pipeline.** No interleaving — orders are done back-to-back:

```
[A pickup] ──▶ [A drop] ──▶ [B pickup] ──▶ [B drop] ──▶ [C pickup] ──▶ [C drop]
```

**Data model.** Replace `nextOrderId` (single) with `nextOrderIds[]` (a FIFO queue).
The existing chain-in logic (`simulationEngine.js:720`) just pops the next id instead of
reading one slot.

**Allocation & ETAR.** ETAR extends naturally: a queued rider's "time to become free" =
finish current order + sum of all queued orders' leg times. No new algorithm.

**Simulation & maps.** Almost nothing changes visually, which is both the strength and
the weakness:
- **Rider Map** — a "queued: N" badge is the only real addition.
- **Order Map** — unchanged: still one active leg per rider at a time; queued orders
  simply wait as `PENDING`/reserved and light up when their turn comes. The existing
  rendering (`OrdersMap.jsx`) works as-is.

**Pros:** tiny, safe change; reuses everything; easy to explain.
**Cons:** **no real batching benefit** — the rider still zig-zags one order at a time,
so it doesn't look or behave like Swiggy/Zomato clubbing. It's "a longer to-do list,"
not smarter delivery.

---

## Side-by-side

| | **A — Capped Interleaved** ⭐ | **B — True N / VRP** | **C — N-Deep Queue** |
|---|---|---|---|
| Orders per rider | 2–3 (capped) | N (unbounded) | N (queued) |
| Interleave pickup/drop? | Yes, rule-gated | Yes, fully re-optimised | No |
| Rider model | Stop-list | Stop-list + re-optimiser | FIFO queue |
| ETAR becomes | Marginal insertion cost | Full route cost | Sum of queued legs |
| Realism (vs Swiggy) | High | Highest | Low |
| Build complexity | Medium | High | Low |
| Understandable? | Yes (cap helps) | Hard | Very |
| Map work needed | "×N" badge + smarter route line | Same, but denser/chaotic | "queued: N" badge only |
| Demo risk | Low–Medium | High | Low |

---

## Recommendation

**Model A (Capped Interleaved).** It's the only option that both *behaves* like real
food delivery (clubbing nearby orders, interleaved pickups/drops) and stays
*explainable* because of the small cap. It reuses the existing per-order leg rendering,
and the new visuals (a "carrying ×2" rider badge, two drop-lines from one rider,
clubbing visibly happening) are exactly the kind of thing that makes the simulation
impressive to watch and easy to narrate.

Model C is a safe fallback if we want a small, low-risk step first. Model B is the
"someday, if we want to show off routing" option — powerful but risky for a demo and
hard to keep legible on the map.

**Suggested path:** build **A**, but structure the rider as a stop-list from day one so
that C is just "A with the clubbing rule turned off" and B is "A with the cap raised and
a re-optimiser added." One data model, three behaviours.
