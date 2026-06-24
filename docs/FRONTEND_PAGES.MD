# Delivery Partner Allocation Engine — Build Phases

The pages and supporting work, split into three tiers: a working **MVP**, then
**depth** that makes it credible, then **enhancements** for polish and wow.


## Phase 1 — MVP (the core loop must run end-to-end)

**Goal:** admin logs in, seeds data, creates an order, and watches a rider get
allocated and move across the map to deliver. This is the minimum demonstrable product.

**Pages:**

1. **Login Page** — admin only
2. **Restaurant Management** — add / list / soft-delete (needed to seed pickup points)
3. **Customer Management** — add / list / soft-delete (needed to seed drop-offs)
4. **Rider Management (basic)** — list riders with details, availability, rating, location
5. **Order Management (basic)** — create order, bulk-create, list orders, status, assigned rider
6. **Dashboard (basic)** — counters: total riders, available riders, active orders, completed orders
7. **Rider Map** — fleet overview: all rider positions color-coded by state (IDLE / ACCEPTED / PICKED_UP), restaurant pins, allocation happening live
8. **Order Map** — order detail: restaurant + customer pins, assigned rider's live position, two-leg delivery route (rider → restaurant → customer)

**Outcome:** a complete, demonstrable allocation loop. Everything below makes this
better — but this alone is a working product.

---

## Phase 2 — Make it better (depth and credibility)

**Goal:** turn the working toy into something that looks like a real operations tool
and shows you handle more than the happy path.

**New pages:**

9. **Allocation History** — audit trail: order, chosen rider, score, AI reason,
   per-factor breakdown, candidates considered, timestamp
   *(may be folded into Order Management instead)*

10. **Delivery Partner View (minimal)** — behind a partner login: view assigned order,
    accept, update availability, update location

**Extend existing pages:**

- **Dashboard** → add analytics: avg pickup time, avg delivery time, throughput,
  per-rider fairness distribution
- **Rider Management** → add movement state (IDLE/ACCEPTED/PICKED_UP), current
  assigned order, recent workload
- **Order Management** → add pending/queued orders view, allocation reason + score,
  lifecycle timestamps
- **Rider Map** → add pending/unassigned order markers, confirm three rider-state colors
- **Order Map** → add explicit two-leg route annotation (rider → restaurant → customer), allocation reason on selection

**Outcome:** the system is transparent, observable, and clearly more than CRUD.

---

## Phase 3 — Enhancements (polish and wow)

**Goal:** the standout features. Optional, but each one raises the ceiling.

- **Weight-tuning sliders on the Rider Map** — tune ETAR / Rating / Load scoring weights live and watch allocations change *(highest-value enhancement — pull forward if time allows)*
- **Re-queue visibility on Rider Map** — surface re-queue events visually (flash order back to pending state on the map, show re-assigned rider taking over). The re-queue logic itself is Phase 1 core (ACCEPTED rider drop); this is the UI polish around it *(impressive and visible)*
- **SLA / stale-order flagging** — highlight delayed orders in red on the Rider Map and dashboard
- **Candidate comparison** — show why the chosen rider beat the runner-up (in Order Map or Allocation History)
- **Queue-depth-over-time chart** on the Dashboard
- **Order cancellation**
- Optional refactor: combine Restaurant + Customer into one "Locations" page with tabs

**Outcome:** the failure-handling and interactivity that separate "looks good" from
"this person understands how the system actually works."

---

## Summary

| Phase | Pages | What you get |
|-------|-------|--------------|
| 0 — Foundation | (backend, no pages) | Models, engine, simulation, server, seed |
| 1 — MVP | Login, Restaurant Mgmt, Customer Mgmt, Rider Mgmt, Order Mgmt, Dashboard, Rider Map, Order Map | A working, demonstrable allocation loop |
| 2 — Better | + Allocation History (9), Partner View (10) (+ extend MVP pages) | Transparency, analytics, more than CRUD |
| 3 — Enhancements | (mostly additions to existing pages) | Live tuning, fault tolerance, polish |

> If you only finish Phase 1, you have a real product. Phase 2 makes it credible.
> Phase 3 makes it memorable. The two enhancements worth pulling forward into Phase 2
> if you have time are the **weight sliders** and **reassignment-on-failure**.