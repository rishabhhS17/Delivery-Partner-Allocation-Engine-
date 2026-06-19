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

- Order creation — a random active restaurant and a random active customer are
  selected, and their details are snapshotted onto the order
- Restaurant location storage (snapshot on the order)
- Customer location storage (snapshot on the order)
- Order status tracking — `PENDING` / `ASSIGNED` / `PICKED_UP` / `DELIVERED` / `CANCELLED`
- Rider assignment tracking
- Lifecycle timestamps (created → assigned → picked up → delivered) for analytics
- Bulk order creation — admin can create any number of orders at once
- Automatic order generation — a scheduled job creates an order roughly every
  10 minutes (while clients are connected) so the system is never idle
- Order reassignment when an assigned rider drops mid-delivery *(enhancement)*
- Order cancellation *(enhancement)*

## 5. Allocation & Queue

The system should support:

- Weighted scoring allocation across distance, rating, and load, each normalized to 0–1
- Eligibility filtering — only `ONLINE` and `IDLE` riders are considered
- Deterministic rider selection (reproducible and debuggable)
- A FIFO pending-order queue that holds orders when no rider is free (graceful backpressure)
- Automatic assignment of queued orders as riders become available
- Allocation history / audit trail, including the per-factor score breakdown
- AI-generated allocation explanations, with a deterministic template fallback
- Reassignment on rider failure — self-healing delivery *(enhancement)*
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

**Enhancements (add value, not required):** reassignment on rider failure, candidate
comparison, SLA flagging, order cancellation, live weight-tuning sliders, queue-depth
charting, and the richer map overlays.
