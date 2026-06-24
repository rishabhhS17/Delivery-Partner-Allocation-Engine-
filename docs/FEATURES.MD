# Delivery Partner Allocation Engine — Core Features

This document defines **what the system should support**. Items marked
*(enhancement)* are stretch features that add value but are not required for the
core product to function.

---

## 1. Rider Management

The system should support:

- Rider registration
- Availability tracking — `ONLINE` / `OFFLINE` (shift state a human partner toggles)
- Rider movement state machine — `IDLE` → `ACCEPTED` → `PICKED_UP` → back to `IDLE`
- Rating management (1–5)
- Workload monitoring — active orders and recent-delivery load
- Rider location updates
- Viewing a rider's current/assigned order
- Partner self-service — update availability, update location, accept assigned order, view assigned deliveries

## 2. Restaurant Management (admin)

The system should support:

- Adding a restaurant (name, phone, location)
- Listing restaurants
- Soft-deleting a restaurant (`isActive: false`, so historical orders stay intact)

## 3. Customer Management (admin)

The system should support:

- Adding a customer (name, phone, address, drop-off location)
- Listing customers
- Soft-deleting a customer (`isActive: false`)

## 4. Order Management

The system should support:

- Order creation — a random active restaurant is selected; a random active customer
  within the restaurant's H3 service area (k=5 ring, ~8–10 km) is selected; both
  are snapshotted onto the order. Invalid cross-city pairings are rejected.
- Restaurant location storage (snapshot on the order)
- Customer location storage (snapshot on the order)
- Order status tracking — `PENDING` / `ASSIGNED` / `PICKED_UP` / `DELIVERED` / `CANCELLED`
- Rider assignment tracking
- Lifecycle timestamps (created → assigned → picked up → delivered) for analytics
- Bulk order creation — admin can create any number of orders at once
- Automatic order generation — a scheduled job creates an order roughly every
  10 minutes (while clients are connected) so the system is never idle
- Order cancellation *(enhancement)*

## 5. Allocation & Queue

The system should support:

- **H3 hexagonal geo-filtering** — only `ONLINE` riders within a k=2 ring (~4–5 km) of
  the restaurant's H3 hexagon (resolution 7) are candidates; uses `h3-js`
- **Expanded candidate pool** — includes riders in `ACCEPTED` and `PICKED_UP` status,
  not just `IDLE`; a rider finishing a nearby delivery is a valid candidate
- **ETAR-based scoring** — Estimated Time to Arrive at Restaurant (`time_to_free +
  travel_time`) replaces raw distance; normalized alongside Rating and Load (0–1 each)
- Weighted scoring allocation across ETAR, rating, and load, with configurable weights
  (defaults: ETAR 0.50, Rating 0.30, Load 0.20)
- Deterministic rider selection (reproducible and debuggable)
- A FIFO pending-order queue that holds orders when no rider is free (graceful backpressure)
- Automatic assignment of queued orders as riders become available
- **Pre-assignment** — if a busy rider wins allocation, the order is pre-assigned to
  them (`rider.nextOrderId`); they auto-start it the moment their current delivery completes
- **Re-queue on rider drop** — if an `ACCEPTED` rider goes offline, their order is
  immediately re-queued at high priority (customer was already waiting)
- Allocation history / audit trail, including the per-factor score breakdown
- Deterministic template allocation reason — `"${name} selected: ~${km}km away, ~${mins}min ETAR, rated ${rating}/5, ${load} recent deliveries."`
- AI-generated allocation explanations *(enhancement — Gemini rewrites the template into natural language)*
- Stale order backoff — orders stuck with no candidates moved to back of queue after N retries *(enhancement)*
- Re-queue when pre-assigned rider goes offline *(enhancement)*
- Candidate comparison — why the chosen rider beat the runner-up *(enhancement)*
- SLA / stale-order flagging for orders that wait too long *(enhancement)*

## 6. Rider Map

The application should display:

- Available (idle) riders
- Busy riders
- Three distinct rider states by color (idle / heading to restaurant / carrying order)
- Live rider locations
- Rider assignment status
- Restaurant pins for context

## 7. Order Map

The application should display:

- Restaurant location
- Customer location
- Assigned rider's live location
- Two-leg delivery route (rider → restaurant → customer)
- Pending / unassigned orders
- An order's allocation reason / score breakdown on selection *(enhancement)*
- Delayed (SLA-breached) orders highlighted *(enhancement)*

## 8. Analytics & Monitoring

The system should support:

- Dashboard counters — total riders, available riders, active orders, completed orders
- Average pickup time and average delivery time
- Throughput (orders per hour)
- Per-rider fairness distribution (demonstrates the load-weighting effect)
- Queue depth over time *(enhancement)*

## 9. Scoring Configuration

The system should support:

- Runtime-adjustable scoring weights — not hardcoded, normalized to sum to 1
- An admin UI to tune weights live and observe allocation changes *(enhancement)*

## 10. Authentication & Real-time

The system should support:

- Admin login
- Minimal Delivery Partner login
- Real-time updates — rider positions and order status streamed over WebSockets,
  with the backend as the single source of truth

---

## Scope Summary

**Core (required for the product to work):** Rider, Restaurant, Customer and Order
management; the allocation engine and pending-order queue; allocation history;
AI explanations; both maps; basic dashboard analytics; configurable weights;
authentication; real-time updates.

**Enhancements (add value, not required):** candidate comparison, SLA flagging,
order cancellation, live weight-tuning sliders, queue-depth charting, stale order
backoff, and the richer map overlays. Note: re-queue on `ACCEPTED` rider drop is
Phase 1 core (see §5); `PICKED_UP` rider drops are out of scope.
