# Delivery Partner Allocation Engine — Application Flow

How the system behaves end to end — from startup, through the continuous simulation
loop, to the lifecycle of a single order.

---

## 1. Startup & seeding

Before anything runs, the database is populated by a seed script:

1. **Restaurants** — 5–10 fixed pickup points placed at coordinates inside the Ranchi bounding box.
2. **Customers** — a set of drop-off points, also inside the box (admin-managed thereafter).
3. **Riders** — 30–35 riders with random coordinates in the box, each `ONLINE` and `IDLE`, with `h3Index` pre-computed from their starting position.

On server start, `simulation.js` loads all riders from MongoDB and builds two
in-memory structures:
- `riderState` — `Map<riderId → rider object>` for O(1) rider lookups
- `h3Buckets` — `Map<h3Cell → Set<riderId>>` for O(1) geo-candidate lookup

These are the authoritative live state for allocation. MongoDB is not queried
on the tick hot path.

The admin can add or soft-delete restaurants and customers at any time afterward.

---

## 2. Waking the world up

The simulation is designed to run **only while someone is watching**, to save resources:

- When the **first client connects** over WebSockets, the backend starts the
  **movement tick** and the **auto-order job**.
- When the **last client disconnects**, both stop.

This is why the app is never a dead screen — the moment it's opened, riders move and
orders flow.

---

## 3. How an order is created

An order is created in one of three ways:

- **Auto** — a scheduled job creates one order roughly every 10 minutes.
- **Single** — the admin clicks "create order".
- **Bulk** — the admin creates N orders at once.

In every case the system:

1. Picks a **random active restaurant** from the `restaurants` collection.
2. **Validates the service area** — computes the restaurant's H3 hexagon (resolution 7)
   and builds a k=5 ring (~8–10 km radius). Picks a **random active customer** whose
   H3 hex falls inside that ring. If no valid customer is found after 10 attempts,
   the order is not created. This prevents unrealistic cross-city pairings.
3. **Snapshots** both names and coordinates onto the new order.
4. Saves the order with status **`PENDING`**.

---

## 4. How a rider is allocated

On each tick, the engine processes the **PENDING queue** in FIFO order. For each pending order:

1. **H3 geo-filter** — compute the restaurant's H3 hexagon (resolution 7) and build a
   k=2 ring (~4–5 km radius, 19 cells). Look up each cell in the in-memory
   `h3Buckets` map and union the results — O(19 + C). Keep only `ONLINE` riders.
   This includes riders in `IDLE`, `ACCEPTED`, and `PICKED_UP` status — not just
   idle ones. No MongoDB query is made during this step.
2. If **no geo-candidates**, the order stays queued and is retried next tick (backpressure).
3. If candidates exist, compute **ETAR** (Estimated Time to Arrive at Restaurant) for
   each: `time_to_free + travel_time_to_restaurant`. Idle riders have time_to_free = 0;
   busy riders estimate it from their current delivery progress.
4. **Score** each candidate using normalized ETAR, Rating, and Load (weighted) and
   **select** the highest score.
5. **If the winner is IDLE:** mark the order `ASSIGNED`, transition the rider to
   `ACCEPTED`, build the route and leg durations, flush to MongoDB (lifecycle event
   write), and write an allocation history record with the score and AI/template reason.
   **If the winner is BUSY (ACCEPTED / PICKED_UP):** mark the order `ASSIGNED`, set
   `rider.nextOrderId`; the rider does not change state. Leg durations and route are
   computed and stored on the order now but `legStartedAt` is set when the rider
   actually starts the next delivery (on completing the current one).

---

## 5. How a delivery plays out (the state machine)

Once assigned, the rider moves along its route at a **constant 40 km/h**.
Leg duration is computed from the actual route distance at assignment time
and stored on the order (`leg1Duration_s`, `leg2Duration_s`). Progress is
derived from wall-clock time — not a fixed step per tick:

```
IDLE  ──assigned──►  ACCEPTED  ──reaches restaurant──►  PICKED_UP  ──reaches customer──►  delivered
  ▲                  (moving to                          (moving to                         │
  │                   restaurant)                         customer)                         │
  │   nextOrderId?                                                                          │
  └── auto-start ◄── skip IDLE ◄───────────────── returns to IDLE ◄───────────────────────┘
```

- **ACCEPTED** → rider animates toward the restaurant (positions updated in-memory
  every tick, no DB writes during movement). On arrival, the order becomes
  **`PICKED_UP`**, a new route is drawn to the customer, progress resets, and the
  rider's position + `h3Index` + status are **flushed to MongoDB** (lifecycle event).
- **PICKED_UP** → rider animates toward the customer. On arrival, the order becomes
  **`DELIVERED`** (with a `deliveredAt` timestamp) and the rider's final position +
  `h3Index` + status are **flushed to MongoDB**.
- **On delivery:** the simulation checks `rider.nextOrderId`. If set, the rider
  transitions directly back to `ACCEPTED` for the pre-assigned order (no idle
  pause). `legStartedAt` is set now, leg durations were stored at pre-assignment time.
  If no `nextOrderId`, the rider returns to **`IDLE`** and is available for the queue.

---

## 6. Real-time streaming

Every tick, after the queue and movement are processed, the backend broadcasts the
updated rider positions and order statuses to **all connected clients over WebSockets**.

The backend is the **single source of truth** — clients only render what they receive,
so two people watching the same map see identical, synchronized state.

---

## 7. Completion, history & analytics

- Each delivered order carries its full timeline: created → assigned → picked up → delivered.
- These timestamps feed the **analytics**: average pickup time, average delivery time,
  throughput, and the **per-rider fairness distribution**.
- Every allocation decision is preserved in **allocation history** for audit and review.

---

## 8. Queue behavior and failure flows

### Phase 1 — Core

**No rider available in geo zone:**
Order stays `PENDING` in the in-memory FIFO queue. On every tick, the allocation
engine retries pending orders in order. The moment a rider enters the zone or a
busy rider's ETAR improves enough to win, the order is assigned. Nothing is dropped.

**In-memory queue structure:**
```
pendingQueue: [{ orderId, queuedAt, priority }]
// sorted: priority DESC, then queuedAt ASC
// priority 1 = re-queued after rider drop (customer already waiting)
// priority 0 = new order or normal re-queue
```
Rebuilt from `Order.find({ status: 'PENDING' }).sort({ queuedAt: 1 })` on restart.
All orders restored at priority 0 — runtime priority is not persisted.

**ACCEPTED rider goes OFFLINE:**
1. Order: `status → PENDING`, `assignedRiderId → null`, `assignedAt → null`, `queuedAt → now`
2. Rider: `status → OFFLINE`, `currentOrderId → null`, `activeOrders → 0`
3. Both flushed to MongoDB.
4. Order re-inserted at **front of queue** at priority 1 — customer was already waiting.

**Pre-assigned rider auto-starts on delivery:**
When a rider completes a delivery and goes `IDLE`, the simulation immediately
checks `rider.nextOrderId`. If set:
- Rider transitions directly to `ACCEPTED` for the next order
- New leg computed from rider's current position to that order's restaurant
- `rider.nextOrderId` cleared; `rider.currentOrderId` updated
- Never actually idles — transition is instant within the same tick.

### Enhancements

- **Stale order backoff** *(enhancement)* — after `MAX_ALLOCATION_RETRIES` (10)
  consecutive failed ticks, an order is moved to the back of the queue
  (`queuedAt = now`, priority reset to 0). Prevents a single order in a dead zone
  from blocking all orders behind it.
- **Pre-assigned rider (`nextOrderId`) goes OFFLINE** *(enhancement)* — order
  reset to `PENDING` at normal priority; rider's `nextOrderId` cleared.
- **Order waiting too long** *(enhancement)* — flagged as an SLA breach for
  operator attention.

### Out of scope

**`PICKED_UP` rider goes OFFLINE** — not handled. Order remains `ASSIGNED` and
does not re-queue. Operator intervention required.

---

## 9. End-to-end walkthrough

A single trip through the whole system:

1. Seed script loads restaurants, customers, and 30–35 idle riders.
2. A client opens the app → the simulation and auto-order job start.
3. An order is created (auto, single, or bulk) → random restaurant + random customer, status `PENDING`.
4. On the next tick, the engine runs the H3 geo-filter and computes ETAR for all candidates.
5. The best rider is selected (or the order is queued if no riders are in the geo zone).
6. The order goes `ASSIGNED`, the rider goes `ACCEPTED`, a route to the restaurant is built.
7. An allocation history record is written with the score and reason.
8. The rider animates to the restaurant → `PICKED_UP` → animates to the customer → `DELIVERED`.
9. Positions and statuses stream to every client live; the Rider Map and Order Map both update in real time.
10. The rider returns to `IDLE`; the dashboard, history, and analytics update.

---

## 10. Roles in the flow

- **Admin** — manages restaurants/customers/riders, creates orders (single + bulk),
  triggers and monitors allocation, views history and analytics, tunes scoring weights.
- **Delivery Partner** *(minimal)* — logs in, updates availability/location, accepts an
  assigned order, and views their assigned delivery.
- **Simulator** — stands in for real rider phones: drives movement, picks up and delivers,
  and keeps the system alive while clients are connected.