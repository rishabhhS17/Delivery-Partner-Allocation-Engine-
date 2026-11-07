# 🚀 Delivery Partner Allocation Engine

A full-stack, real-time logistics platform that automatically assigns the most suitable delivery rider to each incoming order — inspired by food-delivery dispatch systems like Swiggy and Zomato.

The core is a **deterministic, rule-based allocation engine**: it geo-shortlists nearby riders with an **H3 hexagonal spatial index**, scores each on a weighted combination of **predicted time-to-arrival (ETAR), rating, and recent workload**, and assigns the best one. On top sits a **live simulation layer** that animates a fleet of riders along **real road-snapped routes** and generates order traffic, so the system is fully demonstrable without any GPS hardware.

> **Design philosophy:** every allocation is predictable, reproducible, and fully explainable — each decision stores its complete numeric score breakdown. There is **no AI/ML in the decision loop**; the value is in transparent, inspectable scoring.

---

## ✨ Key Features

| Area | Highlights |
|------|-----------|
| **Geo-aware Allocation** | H3 res-7 hexagonal grid shortlists riders near the restaurant, then weighted scoring picks the winner |
| **ETAR scoring** | Ranks by *estimated time to availability + travel*, not raw distance — a near-but-busy rider isn't actually faster |
| **Live Simulation** | ~32 simulated riders animate across a Ranchi map; new orders auto-generate every 10 minutes |
| **Road-snapped Routing** | Two-leg journeys (rider→restaurant→customer) follow real driving routes via the Mapbox Directions API, with a straight-line fallback |
| **Real-time Map** | Rider markers color-coded by state, restaurant pins, live route lines, positions streamed over Server-Sent Events (server is the single source of truth) |
| **Explainable Decisions** | Every assignment records a per-factor score breakdown in an append-only allocation history |
| **Order Queue + TTL** | Unserved orders queue and auto-assign when a rider frees up; orders that wait too long are dropped as `CANCELLED` |
| **Batching-lite** | A busy rider can hold a queued next order and chain straight into it after delivering |
| **Analytics Dashboard** | Throughput, avg pickup/delivery time, per-rider fairness distribution |
| **Auth & Roles** | JWT-based auth (+ optional Google OAuth); admin fleet management |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                          Frontend                            │
│   React 18 · Vite · Material UI · Mapbox GL                    │
└─────────────────────────────┬────────────────────────────────┘
                              │  REST + SSE stream (JWT-authed)
┌─────────────────────────────▼────────────────────────────────┐
│                          Backend                             │
│   Node.js · Express · Mongoose · h3-js                       │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────┐ │
│  │ Allocation  │  │ Simulation  │  │   Order     │  │ Route│ │
│  │  Engine     │  │  Loop (1s)  │  │  Generator  │  │ Svc  │ │
│  │ (H3 + ETAR) │  │             │  │             │  │      │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └───┬──┘ │
└──────────────────────────┬──────────────────────────────┼────┘
                           │                               │
┌──────────────────────────▼─────────┐        ┌────────────▼──────────┐
│        MongoDB Atlas (Mongoose)     │        │ Mapbox Directions API  │
│  riders · restaurants · customers · │        │ (road-snapped routes)  │
│  orders · allocationhistory · users │        └───────────────────────┘
└─────────────────────────────────────┘
```

### Backend Modules

| Module | Responsibility |
|--------|---------------|
| `config/constants.js` | H3 resolution, scoring weights, tick timing, order TTL, rider speed, bounds |
| `models/*.js` | Mongoose schemas — Rider, Restaurant, Customer, Order, AllocationHistory, User |
| `services/allocationEngine.js` | H3 candidate cells, ETAR computation, normalized weighted scoring |
| `engine/` | The dispatch engine — live state, dispatch tick, TTL cancel, stop transitions, restart recovery, broadcast. Everything else uses only `engine/index.js` |
| `sim/` | The bots: rider bots move riders and report arrivals, the customer bot places orders. They may only call the engine's public commands (a test enforces this) |
| `services/orderGenerator.js` | Random + bulk order creation |
| `services/routingService.js` | Mapbox Directions calls with a route cache, concurrency limit, and timeout |

---

## 🎯 How the Allocation Engine Works

```
new / pending order
        │
        ▼
1. GEO-FILTER → H3 res-7 hexagon disk around the restaurant → nearby riders
        │
        ▼
2. SHORTLIST  → keep ONLINE + IDLE riders in those cells      → candidates
        │
        ▼
3. SCORE      → ETAR + rating + load, normalized 0–1,          → scored list
               combined with runtime-configurable weights
        │
        ▼
4. SELECT     → highest final score wins                       → assignment
        │       (records full breakdown in allocation history)
        ▼
No rider in range? → order waits in the queue (and is CANCELLED after the TTL)
```

### Scoring Model

| Factor | Default Weight | Score (normalized 0–1) |
|--------|:--------------:|------------------------|
| **ETAR** | 0.50 | `1 − etar / maxEtar` — lower estimated time-to-arrival scores higher |
| **Rating** | 0.30 | `rating / 5` |
| **Load** | 0.20 | `1 − recentLoad / maxLoad` — fewer deliveries in the last 60 min scores higher (fairness/fatigue) |

```
ETAR = time-until-rider-is-free  +  travel-time-to-restaurant
Final Score = w_etar × EtarScore + w_rating × RatingScore + w_load × LoadScore
```

Weights are **runtime-configurable** (`PUT /api/config/weights`) and **auto-normalized to sum to 1**. ETAR and load are scored **relative to the candidate pool**, so ranking adapts to whoever is actually nearby.

> **Why ETAR over raw distance?** The nearest rider may already be mid-delivery. ETAR folds in the time to finish their current trip *plus* travel to the restaurant, so "closest" never beats "soonest actually available."

---

## 🔄 State Machines

**Rider:**
```
IDLE ──assigned──▶ ACCEPTED ──reaches restaurant──▶ PICKED_UP ──reaches customer──▶ (deliver)
 ▲                 (leg 1 →                          (leg 2 →                          │
 │                  restaurant)                        customer)                        │
 └──────────── returns to IDLE  ◀── or chains into a queued next order ◀────────────────┘
```
`availabilityStatus` (`ONLINE` / `OFFLINE`) is separate from movement `status` (`IDLE` / `ACCEPTED` / `PICKED_UP`).

**Order:**
```
PENDING ─▶ ASSIGNED ─▶ PICKED_UP ─▶ DELIVERED
   │
   └─▶ CANCELLED   (waited past ORDER_TTL_MS with no serviceable rider)
```

Each **1-second tick**, riders advance along their road-snapped polyline at `RIDER_SPEED_KMH`; leg completions trigger the next transition. Positions are computed **server-side** and streamed to every client — no client-side drift. On restart, the engine **rehydrates in-memory state from MongoDB**. Who carries an order is stored only on the order itself, so each rider's itinerary is rebuilt from the orders and there is nothing to heal.

---

## 🛠️ Tech Stack

### Frontend
- **React 18** + **Vite** — UI and build tooling
- **Material UI** — component library & styling
- **Mapbox GL** (`react-map-gl`) — map rendering, markers, route lines
- **Fetch stream reader** — reads the Server-Sent Events live feed with the JWT in the header
- **Axios** · **React Router v6**

### Backend
- **Node.js** + **Express** — REST API
- **Server-Sent Events** — one-way live feed at `GET /api/stream` (JWT-authenticated)
- **Mongoose** — MongoDB ODM
- **h3-js** — H3 hexagonal spatial index (candidate filtering, service areas)
- **Mapbox Directions API** — road-snapped two-leg routing
- **JWT** + **Passport** (optional Google OAuth) — auth
- **helmet** · **express-rate-limit** · **express-mongo-sanitize** — hardening

### Database
- **MongoDB Atlas** — riders, restaurants, customers, orders, allocation history, users

### Deployment
- **Frontend:** Vercel · **Backend:** Render · **Database:** MongoDB Atlas

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** ≥ 18 and **npm** ≥ 9
- A **MongoDB** connection string (Atlas or local)
- A **Mapbox** access token (used by **both** the frontend map and the backend routing service)

### 1. Clone
```bash
git clone https://github.com/rishabhhS17/Delivery-Partner-Allocation-Engine-.git
cd Delivery-Partner-Allocation-Engine-
```

### 2. Backend
```bash
cd backend
npm install
cp .env.example .env
```
Fill in `.env`:
```env
MONGODB_URI=your_mongodb_connection_string   # required
JWT_SECRET=your_jwt_secret                    # required
ADMIN_PASSWORD=your_admin_password            # required
MAPBOX_TOKEN=your_mapbox_token                # required for road-snapped routing
MAPBOX_DAILY_BUDGET=3000                      # optional — Mapbox calls per UTC day before straight-line fallback
ORDER_SERVICE_KEY=your_service_key            # optional — enables POST /api/intake/orders for an upstream order service
SIMULATION_ENABLED=true                       # optional — enables the presenter panel's simulated database outage
SESSION_SECRET=your_session_secret            # required when NODE_ENV=production
PORT=5000                                     # optional (default 5000)
FRONTEND_URL=http://localhost:5173            # optional — needed in production for CORS
# Optional: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL (Google login)
# Optional: SMTP_* (unset → OTP/reset codes are logged to the server console)
```
Run:
```bash
npm run dev        # development (nodemon)
npm start          # production
```
The simulation **auto-starts on boot** — seed some riders/restaurants/customers first so the map isn't empty.

### 3. Frontend
```bash
cd frontend
npm install
cp .env.example .env
```
Fill in `.env`:
```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_MAPBOX_ACCESS_TOKEN=your_mapbox_access_token
```
Run:
```bash
npm run dev        # http://localhost:5173
```

---

## 📡 API Reference

All routes are prefixed with `/api`. Everything except `/auth`, `/health` and `/intake` (which uses its own service key) requires a **Bearer JWT**.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/health` | Engine health: event-loop delay, dispatch/broadcast/rider-bot tick times, queue sizes, time to assign, DB ping (no login needed) |
| `POST` | `/auth/register` · `/auth/login` | Auth (+ `/auth/google` OAuth flow) |
| `GET` | `/analytics` | Dashboard metrics |
| `POST` `GET` | `/riders` | Create / list riders |
| `GET` | `/riders/:id` | Rider details |
| `PUT` | `/riders/:id/location` · `/riders/:id/status` | Update location / availability |
| `POST` `GET` `DELETE` | `/restaurants` · `/customers` | Create / list / soft-delete |
| `POST` | `/orders` · `/orders/bulk` | Create one / N orders |
| `GET` | `/orders` · `/orders/:id` | List / order details |
| `POST` | `/allocation/allocate` | Manually allocate a PENDING order |
| `GET` | `/allocation/history` | Paginated allocation audit trail |
| `GET` `PUT` | `/config/weights` | Read / update scoring weights (`PUT /config/weights/reset` restores defaults) |
| `GET` | `/simulation/status` | Simulation status (it always runs while the server runs) |
| `GET` | `/stream` | Live feed (Server-Sent Events): a snapshot, then the fleet every second and each order event |
| `GET` `POST` | `/presenter` · `/presenter/riders/:action` · `/presenter/kitchens/:action` · `/presenter/database-outage` · `/presenter/crash-engine` | Presenter panel: force the next edge case (rider reject / ignore / cancel, restaurant reject / delay / early, 60 s DB outage when `SIMULATION_ENABLED=true`), or crash the engine and watch it recover from the database |
| `POST` | `/intake/orders` | Upstream order service intake (`X-Service-Key` header, no login). Same `externalOrderId` → the existing order is returned, never a duplicate |

### Live stream events (`GET /api/stream`, server → client)
`snapshot` (sent first on every connection: fleet, queue depth, route lines, recent assignments) · `simulation:tick` (every rider, every second) · `simulation:status` · `order:assigned` · `order:route` · `order:status` · `order:delivered` · `order:cancelled`. A reconnecting browser gets a fresh `snapshot`; missed events are not replayed.

---

## 📁 Project Structure

```
Delivery-Partner-Allocation-Engine-/
├── backend/
│   └── src/
│       ├── config/          # constants (weights, H3, TTL), db, env, passport
│       ├── controllers/     # route handlers
│       ├── middleware/       # auth, error handling
│       ├── models/          # Mongoose schemas
│       ├── routes/          # Express route definitions
│       ├── engine/          # dispatch engine (public commands in engine/index.js)
│       ├── sim/             # rider + customer bots (use only the engine's public commands)
│       ├── services/        # allocationEngine, orderGenerator, routingService
│       ├── utils/           # haversine, helpers
│       ├── validators/      # request validation
│       ├── tests/           # test suites
│       ├── app.js           # Express app (CORS, helmet, rate limit)
│       └── server.js        # HTTP entry point, startup and graceful shutdown
├── frontend/
│   └── src/
│       ├── api/             # Axios layer + endpoints
│       ├── components/      # common · map · navigation
│       ├── config/          # navigation config
│       ├── context/         # Auth + Simulation (live stream) providers
│       ├── layouts/         # app layout
│       ├── pages/           # route-level pages (maps, dashboard, tables)
│       ├── routes/          # route definitions + guards
│       ├── theme/           # MUI theme
│       └── utils/           # helpers
└── README.md
```

---

## ⚖️ Design Decisions

| Decision | Rationale |
|----------|-----------|
| **H3 hexagonal geo-filter** | Shortlist riders near the restaurant in ~O(1) instead of scanning the whole fleet — the same spatial-index idea real dispatchers use (chosen over Redis GEO because uniform hexagons double as demand/surge zones) |
| **ETAR instead of raw distance** | "Closest" ≠ "soonest available" — ETAR adds the time to finish a current delivery, so busy-but-near riders don't win falsely |
| **Relative normalization** | ETAR and load are scored against the live candidate pool, so ranking adapts to whoever is actually nearby |
| **Deterministic, explainable core** | Every allocation stores its full numeric breakdown; decisions are reproducible with no black-box model |
| **Server-authoritative movement** | Positions computed on the backend and streamed — one source of truth, no client drift |
| **Road-snapped routing with fallback** | Mapbox Directions for realism; a straight-line lerp covers the gap until the route resolves, so movement never stalls |
| **TTL cancellation** | Never-servable orders are dropped as `CANCELLED` instead of retrying forever |
| **Snapshot pattern for orders** | Restaurant/customer name + coords are copied onto the order so history survives deletions |

---

## 🗺️ Roadmap

**Done**
- [x] H3 hexagonal geo-filtering for candidate selection
- [x] Road-distance routing (Mapbox Directions, replacing straight-line)
- [x] Order TTL cancellation
- [x] ETAR-based predictive scoring
- [x] Order clubbing: one rider carries up to 2 orders with interleaved stops
- [x] Food-prep-aware **just-in-time** dispatch (the rider leaves so they arrive as the food is ready)

**In progress:** five planned builds (foundation, robustness, rider lifecycle, restaurant &
customer, presenter panel). Every choice behind them is recorded in [DECISIONS_MADE.md](DECISIONS_MADE.md); features held back are in [LATER.md](LATER.md).

**Next Steps: deliberately left for later**

*Scaling*
- [ ] **Stage B: split into stateless API processes + one dispatcher process, connected by
  Redis Streams.** The API stays up while the dispatcher restarts, and orders wait in Redis
  meanwhile. Trigger: build it when the event-loop delay stays above 100 ms (p99) on one
  process. Until then, one Node process serves one city.
- [ ] Send only changed riders on the live fleet stream once the fleet passes ~2,000 riders
- [ ] **Batch matching**: assign many orders against many riders at once instead of one order at a time
- [ ] Move to **Postgres + PostGIS** (transactions, SQL analytics) if the data model outgrows Mongo

*Access & security*
- [ ] **Admin-only controls** (everyone else read-only), then a full RBAC approval flow + audit log

*Engine & data*
- [ ] A **Trip model** that stores the rider's itinerary as its own record
- [ ] Duration-paced rider movement: a rider covers each leg in Mapbox's real duration instead of at a fixed 40 km/h, so the animation matches what ETAR assumes
- [ ] Use a rider's **acceptance rate** in scoring
- [ ] **Delivery OTP** at the door

*Observability & tooling*
- [ ] A Prometheus `/metrics` endpoint + Grafana dashboards
- [ ] Convert the backend to **TypeScript**

*Product*
- [ ] **Demand/surge heatmap** over the H3 grid
- [ ] Weight-tuning sliders on the live map · candidate comparison (why the winner beat the runner-up)

---

## 📄 License

This project is for educational and portfolio purposes.
