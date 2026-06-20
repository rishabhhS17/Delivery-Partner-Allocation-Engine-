# Delivery Partner Allocation Engine — Backend Build Phases

A sequenced plan for the backend, ordered by what to set up first. Each phase has
concrete tasks and a "done when" check. Build top to bottom — later phases depend on
earlier ones. Some modules already exist as drafts (noted inline); your job is to wire
them into a running server.

---

## Phase 1 — Project setup & foundation

**Goal:** an Express server that boots and connects to MongoDB.

Tasks:
- `npm init`, set up the repo and `.gitignore`
- Install dependencies:
  `express`, `mongoose`, `socket.io`, `node-cron`, `cors`, `dotenv`, `h3-js`
  (dev: `nodemon`)
- Create the folder structure:
  ```
  /src
    config.js          # bbox, H3 resolution, weights store, ETAR params, timings (draft ready)
    db.js              # mongoose connection
    models.js          # schemas (draft ready)
    /routes            # express routers
    /services          # allocation, simulation, order generation (drafts ready)
    server.js          # app entry: express + socket.io
  .env                 # MONGO_URI, PORT
  seed.js              # seed script
  ```
- `.env` with `MONGO_URI` (MongoDB Atlas) and `PORT`
- Connect Mongoose in `db.js`; add a `GET /health` route

**Done when:** the server starts, connects to Atlas, and `GET /health` returns 200.

---

## Phase 2 — Data models & seed

**Goal:** all collections defined and the database seeded.

Tasks:
- Finalize schemas: `Rider`, `Restaurant`, `Customer`, `Order`, `AllocationHistory`
  *(draft in `models.js`)*
- Add indexes:
  - riders: `{ availabilityStatus: 1, status: 1 }`
  - orders: `{ status: 1, createdAt: 1 }` and `{ assignedRiderId: 1, deliveredAt: 1 }`
  - restaurants / customers: `{ isActive: 1 }`
- Write `seed.js`: insert 5–10 restaurants, a set of customers, and ~20 `ONLINE`/`IDLE`
  riders, all with coordinates inside the Ranchi bounding box
- Verify that seeded locations produce valid H3 hexagons at resolution 7 (sanity
  check: `h3.latLngToCell(lat, lng, 7)` for a few entries)

**Done when:** running `node seed.js` populates all collections and you can see the
documents in Atlas.

---

## Phase 3 — CRUD APIs

**Goal:** the admin can manage all reference data and create orders over HTTP.

Tasks — implement and test each router:
- **Riders:** `POST /riders`, `GET /riders`, `GET /riders/:id`,
  `PUT /riders/:id/location`, `PUT /riders/:id/status`
- **Restaurants:** `POST /restaurants`, `GET /restaurants`, `DELETE /restaurants/:id` (soft delete)
- **Customers:** `POST /customers`, `GET /customers`, `DELETE /customers/:id` (soft delete)
- **Orders:** `POST /orders` (single), `POST /orders/bulk` (N at once),
  `GET /orders`, `GET /orders/:id`
- Add a central error-handling middleware and basic input validation

**Done when:** every endpoint works in Postman/Thunder Client — you can create a
restaurant, a customer, and an order end to end.

---

## Phase 4 — Allocation engine (H3 + ETAR)

**Goal:** given an order, the system picks the best rider using H3 geo-filtering
and ETAR-based scoring.

Tasks:
- Finalize `allocationEngine.js` *(draft ready)* with the v2 pipeline:
  1. **H3 geo-filter** — compute the restaurant's H3 hex (resolution 7), build a
     k=2 ring (~4–5 km), keep only `ONLINE` riders whose hex falls in the ring.
     Include riders in `ACCEPTED` and `PICKED_UP` status (not just `IDLE`).
  2. **ETAR computation** — for each geo-candidate, compute
     `ETAR = time_to_free + travel_time_to_restaurant`:
     - `IDLE` → `time_to_free = 0`
     - `PICKED_UP` → `(1 - progress) × AVG_LEG_DURATION`
     - `ACCEPTED` → `(1 - progress) × AVG_LEG_DURATION × 2`
     - `travel_time = haversine_km / AVG_SPEED_KM_PER_SEC`
  3. **Weighted scoring** — normalize ETAR, Rating, Load to 0–1, apply configurable
     weights (defaults: ETAR 0.50, Rating 0.30, Load 0.20), select highest score
  4. **Reason generation** — deterministic template + optional AI rewrite
- `POST /allocate-order` — allocate a specific order, write an `AllocationHistory` record
- `GET /allocation-history` — return the audit trail
- Weights config: `GET /config/weights`, `PUT /config/weights` (normalized to sum 1,
  backed by the live store in `config.js`)
- Add H3/ETAR config to `config.js`:
  - `H3_RESOLUTION` (default 7)
  - `CANDIDATE_RING_SIZE` (default 2)
  - `SERVICE_AREA_RING_SIZE` (default 5)
  - `AVG_LEG_DURATION` (default 120s)
  - `AVG_SPEED_KM_PER_SEC` (default 0.005, ~18 km/h)
- Write one quick test with fixed inputs to confirm the score math (see the worked
  example in `ALLOCATION_LOGIC.md`)

**Done when:** posting an order returns a chosen rider + score + reason, a history
record is written, changing weights changes the choice, and busy riders near the
restaurant can beat idle riders farther away.

---

## Phase 5 — Order generation (with service area validation)

**Goal:** orders appear automatically and in bulk, with H3 service area checks.

Tasks:
- Finalize `orderGenerator.js` *(draft ready)*:
  - Pick a random active restaurant + random active customer
  - **Validate service area** — compute restaurant's H3 hex, build a k=5 ring
    (~8–10 km), check the customer's hex is in the ring. If not, retry with a
    different restaurant (max 10 attempts)
  - Snapshot both onto the order
- Auto-order job (`node-cron` or `setInterval`) creating one order every ~10 min,
  with start/stop controls

**Done when:** the bulk endpoint creates N pending orders (all within service area),
and the auto-job creates one on schedule. Invalid restaurant–customer pairings are
rejected and retried.

---

## Phase 6 — Simulation & real-time (the heart)

**Goal:** riders move, orders flow through the queue, and clients see it live.

Tasks:
- Set up **Socket.IO** on the server
- Finalize `simulation.js` *(draft ready)*:
  - **Queue processor** — FIFO assign pending orders to eligible riders using the
    H3 + ETAR allocation engine (uses live weights). Busy riders near the restaurant
    are valid candidates — their ETAR determines ranking.
  - **Movement** — advance each ACCEPTED/PICKED_UP rider 5% per tick along its leg
  - **State machine** — ACCEPTED → (reach restaurant) → PICKED_UP → (reach customer) → DELIVERED → IDLE
  - **Broadcast** — emit rider positions + order statuses every tick
- Wire lifecycle: start the tick + auto-orders on **first client connect**, stop on
  **last disconnect**
- (Recommended) use an **atomic `findOneAndUpdate`** to claim a rider so two orders
  can never double-book one

**Done when:** with the frontend (or a socket test client) connected, orders get
assigned (including to finishing-up riders), riders animate restaurant→customer,
and updates stream in real time.

---

## Phase 7 — Analytics & auth

**Goal:** the dashboard has data and the app has logins.

Tasks:
- Analytics endpoints: counters (total/available riders, active/completed orders),
  average pickup time, average delivery time, throughput, per-rider fairness distribution
- **Admin auth** — login + protected routes (JWT or a simple session)
- **Minimal partner auth** — login mapping to a rider record

**Done when:** analytics endpoints return correct aggregates and protected routes
reject unauthenticated requests.

---

## Phase 8 — Enhancements *(optional, high value)*

- **Reassignment on rider failure** — if an assigned rider goes OFFLINE mid-delivery,
  re-queue the order and reassign *(single most impressive addition)*
- **SLA flagging** — mark orders that wait in the queue too long
- **Candidate comparison** — store/return the top 3 candidates per decision

---

## Phase 9 — Testing & deployment

- Add CORS config for the frontend origin
- Environment variables for all secrets/URLs
- Deploy backend to **Render**, database on **MongoDB Atlas**
- Smoke-test the full flow against the deployed URL

**Done when:** the deployed backend serves the API and WebSocket stream to the
deployed frontend.

---

## Quick order of attack

| # | Phase | One-line outcome |
|---|-------|------------------|
| 1 | Setup | Server boots, DB connected, `h3-js` installed |
| 2 | Models & seed | Collections defined, DB seeded, H3 hexes verified |
| 3 | CRUD APIs | Manage riders/restaurants/customers/orders |
| 4 | Allocation | H3 geo-filter + ETAR scoring + history + weights |
| 5 | Order gen | Auto + bulk orders with service area validation |
| 6 | Simulation | Live movement, queue (assigns busy riders too), WebSockets |
| 7 | Analytics & auth | Dashboard data + logins |
| 8 | Enhancements | Reassignment, SLA, comparison |
| 9 | Deploy | Live on Render + Atlas |

> Phases 1–6 are the backend MVP — after Phase 6 the system genuinely works.
> 7 makes it credible, 8 makes it stand out, 9 ships it.
