# Delivery Partner Allocation Engine — Application Flow

How the system behaves end to end — from startup, through the continuous simulation
loop, to the lifecycle of a single order.

---

## 1. Startup & seeding

Before anything runs, the database is populated by a seed script:

1. **Restaurants** — 5–10 fixed pickup points placed at coordinates inside the Ranchi bounding box.
2. **Customers** — a set of drop-off points, also inside the box (admin-managed thereafter).
3. **Riders** — ~20 riders with random coordinates in the box, each `ONLINE` and `IDLE`.

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
   k=2 ring (~4–5 km radius). Keep only `ONLINE` riders whose current position falls
   inside that ring. This includes riders in `IDLE`, `ACCEPTED`, and `PICKED_UP`
   status — not just idle ones.
2. If **no geo-candidates**, the order stays queued and is retried next tick (backpressure).
3. If candidates exist, compute **ETAR** (Estimated Time to Arrive at Restaurant) for
   each: `time_to_free + travel_time_to_restaurant`. Idle riders have time_to_free = 0;
   busy riders estimate it from their current delivery progress.
4. **Score** each candidate using normalized ETAR, Rating, and Load (weighted) and
   **select** the highest score.
5. Mark the order **`ASSIGNED`**, set the rider to **`ACCEPTED`**, build a route from
   the rider to the restaurant, and write an **allocation history** record with the
   score breakdown and AI/template reason.

---

## 5. How a delivery plays out (the state machine)

Once assigned, the rider moves along its route. Each tick advances it **5% of the
current leg** (so a leg completes in 20 ticks):

```
IDLE  ──assigned──►  ACCEPTED  ──reaches restaurant──►  PICKED_UP  ──reaches customer──►  delivered
  ▲                  (moving to                          (moving to                         │
  │                   restaurant)                         customer)                         │
  └──────────────────────────── returns to IDLE ◄──────────────────────────────────────────┘
```

- **ACCEPTED** → rider animates toward the restaurant. On arrival, the order becomes
  **`PICKED_UP`**, a new route is drawn to the customer, and progress resets.
- **PICKED_UP** → rider animates toward the customer. On arrival, the order becomes
  **`DELIVERED`** (with a `deliveredAt` timestamp).
- After a short cooldown the rider returns to **`IDLE`**, becomes available again, and
  can be picked up for the next queued order.

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

## 8. Failure & edge flows

- **No rider available** → order waits in the FIFO queue and is assigned the moment a
  rider frees up. Nothing is dropped.
- **Rider drops mid-delivery** *(enhancement)* → the order is re-queued and reassigned
  to another rider; the delivery self-heals.
- **Order waiting too long** *(enhancement)* → flagged as an SLA breach for operator attention.

---

## 9. End-to-end walkthrough

A single trip through the whole system:

1. Seed script loads restaurants, customers, and ~20 idle riders.
2. A client opens the app → the simulation and auto-order job start.
3. An order is created (auto, single, or bulk) → random restaurant + random customer, status `PENDING`.
4. On the next tick, the engine runs the H3 geo-filter and computes ETAR for all candidates.
5. The best rider is selected (or the order is queued if no riders are in the geo zone).
6. The order goes `ASSIGNED`, the rider goes `ACCEPTED`, a route to the restaurant is built.
7. An allocation history record is written with the score and reason.
8. The rider animates to the restaurant → `PICKED_UP` → animates to the customer → `DELIVERED`.
9. Positions and statuses stream to every client live; the map updates in real time.
10. The rider returns to `IDLE`; the dashboard, history, and analytics update.

---

## 10. Roles in the flow

- **Admin** — manages restaurants/customers/riders, creates orders (single + bulk),
  triggers and monitors allocation, views history and analytics, tunes scoring weights.
- **Delivery Partner** *(minimal)* — logs in, updates availability/location, accepts an
  assigned order, and views their assigned delivery.
- **Simulator** — stands in for real rider phones: drives movement, picks up and delivers,
  and keeps the system alive while clients are connected.