# PLAN — Branch Strategy

Two **independent** feature branches, both cut from `enhancements`. Each must be built to work
**standalone** — do not assume the other branch's code exists. **No merging** is done as part of
building; merging is the owner's job, later, on a dedicated merge branch.

## Branches

| Branch | Phases | Scope |
|---|---|---|
| `feature/allocation-viz` | 2 + 3 | Dedicated Allocation view: H3 candidate zones + click-to-score (Phase 2), demand heatmap toggle + H3 config centralization (Phase 3). Additive, read-only visualization — does not touch the simulation engine. |
| `feature/multi-order-engine` | 4 → 6 | Engine rework: stop-list + food-prep + just-in-time (held) dispatch + `WAITING` (Phase 4); Model A capped-interleaved clubbing (N-general) with marginal-cost ETAR + full anti-starvation (Phase 6), engine-only. **Phase 5 is internal-only** — the decomposed First-Mile/Wait/Last-Mile timings stay internal (already produced by Phase 4); there is no user-facing ETA display. |

## Rules
1. **Build each branch fully independent of the other.** Each branch, on its own, must run and be
   verifiable end-to-end without any code from the other branch.
2. **No cross-branch assumptions.** If both branches happen to need a similar helper (e.g. a
   candidate-ranking or H3-polygon helper in `allocationEngine.js`, or routes in
   `routes/allocation.js`), each branch introduces its own — duplication is acceptable here.
3. **Do not merge the branches.** No merging `allocation-viz` and `multi-order-engine` together
   as part of this work. The owner will reconcile them later on a separate **merge branch**
   (that is where any duplicated helpers / overlapping edits to `allocationEngine.js` and
   `routes/allocation.js` get de-duplicated).
4. Each branch may be merged back to `enhancements` independently by the owner, or left for the
   merge branch — owner's call.

## Detailed per-phase plans (all written)
- `PHASE2_PLAN.md` — Allocation view (candidate zones + click-to-score).
- `PHASE3_PLAN.md` — demand heatmap + H3 config centralization.
- `PHASE4_PLAN.md` — stop-list + food-prep + just-in-time (held) dispatch + `WAITING`.
- Phase 5 — no separate doc; **dropped as user-facing**, decomposed timings stay internal (from Phase 4).
- `PHASE6_PLAN.md` — Model A capped-interleaved clubbing (N-general) + anti-starvation.
- Background: `NEXT_PHASES.md`, `ALLOCATION_LOGIC_MODEL.md` (Model A).

## Key locked decisions

**`feature/allocation-viz` (2 + 3)**
- Dedicated, **guest-visible** Allocation view (not a layer on the Order Map).
- Phase 2: **merged-outline** candidate zones, **always-on for pending orders**; click a pending
  order → read-only scored candidates (E/R/L breakdown, winner highlighted). Backend read-only
  endpoints (`/allocation/candidate-zone`, `/allocation/preview`).
- Phase 3: demand = **live pending-order count** bucketed by **restaurant cell** at **res 7**,
  **hex choropleth**, from a backend `/allocation/demand` endpoint. **Toggle** between heatmap and
  candidate zones (ambient-heatmap-with-zone-on-click is future).
- H3 resolution/k **centralized** in `constants.js` and exposed via `GET /config/h3`.

**`feature/multi-order-engine` (4 → 6)**
- Phase 4: rider becomes an **N-general stop-list**; **random prep time per order** (from
  `constants.js`); **held (delayed) just-in-time** dispatch (order stays PENDING during prep;
  rider committed only at the departure window — not pre-assigned) with **`WAITING`** as the
  fallback; `WAITING` shown distinctly on the map + prep/wait telemetry. TTL must not cancel an
  order while it's legitimately held for prep.
- Phase 6: **Model A** interleaved clubbing; **cap tunable (start 2), architecture general for any
  N**; **cheapest-insertion** (no reordering existing stops — full re-optimization is future
  Model B); clubs **same- and nearby-different-restaurant** orders; **marginal-cost** selection;
  **full anti-starvation** (absolute deadline + deadline-validated insertion + head-of-route
  freeze + aging); **engine-only** (no clubbing viz yet, but telemetry emits carrying count +
  onboard order ids).

## Status
- Branch strategy + all per-phase plans: **decided and documented**.
- Build order preference: `feature/allocation-viz` (2→3) first, then `feature/multi-order-engine`
  (4→6) — but each is standalone, so either order works.
- **Not started building yet.**
- Follow-up (docs): reflect the Phase 5 "internal-only" decision in `NEXT_PHASES.md`.
