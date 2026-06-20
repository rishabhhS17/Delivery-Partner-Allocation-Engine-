# 🚀 Delivery Partner Allocation Engine

A full-stack logistics platform that automatically assigns the most suitable delivery rider to each incoming order — inspired by food-delivery systems like Swiggy and Zomato.

The core of the system is a **deterministic, rule-based allocation engine** that scores every eligible rider against an order and selects the best one. On top of that sits a **live simulation layer** that keeps the app populated with realistic rider movement and order traffic, and an **AI explainability layer** that produces a plain-language reason for every allocation decision.

> **Design philosophy:** The allocation logic is fully predictable and reproducible. AI is used *only* to explain decisions — never to make them. The simulation removes the need for real GPS hardware, making the system demonstrable out of the box.

---

## ✨ Key Features

| Area | Highlights |
|------|-----------|
| **Smart Allocation** | Weighted scoring across distance, rating & workload — each normalized to 0–1, combined with runtime-configurable weights |
| **Live Simulation** | ~20 simulated riders animate across a Ranchi map with automatic order generation every 10 min |
| **Real-time Map** | Rider markers (color-coded by state), restaurant pins, two-leg delivery routes, live position streaming via WebSockets |
| **AI Explanations** | Every assignment includes a human-readable reason (Gemini API with deterministic template fallback) |
| **Order Queue** | FIFO backpressure — unserved orders queue up and auto-assign the moment a rider frees up |
| **Analytics Dashboard** | Counters, avg pickup/delivery time, throughput, per-rider fairness distribution |
| **Allocation History** | Full audit trail with per-factor score breakdowns |
| **Admin & Partner Roles** | Admin manages the fleet; delivery partners can log in, update availability, and view assignments |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                       Frontend                          │
│  React 18 · Vite · Material UI · Mapbox · Socket.IO    │
└────────────────────────┬────────────────────────────────┘
                         │  REST + WebSocket
┌────────────────────────▼────────────────────────────────┐
│                       Backend                           │
│  Node.js · Express · Socket.IO · node-cron · Mongoose   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Allocation  │  │  Simulation  │  │    Order     │  │
│  │   Engine     │  │    Loop      │  │  Generator   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│              MongoDB Atlas (Mongoose)                    │
│  riders · restaurants · customers · orders ·             │
│  allocationhistory                                      │
└─────────────────────────────────────────────────────────┘
```

### Backend Modules

| Module | Responsibility |
|--------|---------------|
| `config.js` | Bounding box, scoring weights, tick/cron timing |
| `models.js` | Mongoose schemas — Rider, Restaurant, Order, Customer, AllocationHistory |
| `allocationEngine.js` | Haversine distance, normalized weighted scoring, reason generation |
| `orderGenerator.js` | Random order creation (single + bulk) and the auto-order cron |
| `simulation.js` | Tick loop — queue processing, movement, state machine, WebSocket broadcast |

---

## 🎯 How the Allocation Engine Works

```
new / pending order
        │
        ▼
1. FILTER     → keep only ONLINE + IDLE riders       → candidates
        │
        ▼
2. SCORE      → score each candidate 0–1 per factor, → scored list
               combine with configurable weights
        │
        ▼
3. SELECT     → pick the highest final score          → winner
        │
        ▼
4. EXPLAIN    → generate a human-readable reason      → assignment + reason
```

### Scoring Model

| Factor | Default Weight | Score (normalized 0–1) |
|--------|:--------------:|------------------------|
| **Distance** | 0.45 | Closer to restaurant → higher (`1 − dist/maxDist`, Haversine) |
| **Rating** | 0.30 | `rating / 5` |
| **Load** | 0.25 | Fewer recent deliveries → higher (fairness/fatigue signal) |

```
Final Score = w_distance × DistanceScore + w_rating × RatingScore + w_load × LoadScore
```

Weights are **runtime-configurable** by the admin and **normalized to sum to 1** before scoring. No rider available? The order waits in a FIFO queue and is assigned on the next tick.

> See [`docs/ALLOCATION_LOGIC.MD`](docs/ALLOCATION_LOGIC.MD) for worked examples and edge-case handling.

---

## 🔄 Rider State Machine

```
IDLE ──assigned──▶ ACCEPTED ──reaches restaurant──▶ PICKED_UP ──reaches customer──▶ DELIVERED
 ▲                 (moving to                       (moving to                        │
 │                  restaurant)                      customer)                        │
 └─────────────────────────── returns to IDLE ◀──────────────────────────────────────┘
```

Each tick advances the rider **5 %** of the current leg (completing in ~20 ticks). Positions are updated server-side and streamed to all clients via WebSockets — the backend is the single source of truth.

---

## 🛠️ Tech Stack

### Frontend
- **React 18** — component UI
- **Vite** — dev server & build
- **Material UI** — component library & styling
- **Mapbox** — map rendering, markers, routes
- **Axios** — HTTP client
- **Socket.IO Client** — real-time position/state updates
- **React Router v6** — client-side routing

### Backend
- **Node.js** + **Express** — REST API
- **Socket.IO** — WebSocket streaming
- **Mongoose** — MongoDB ODM
- **node-cron** — scheduled order generation & simulation tick
- **JWT** — authentication
- **dotenv** — environment config

### Database
- **MongoDB Atlas** — riders, restaurants, customers, orders, allocation history

### AI
- **Gemini API** — natural-language allocation explanations (deterministic template fallback)

### Deployment
- **Frontend:** Vercel
- **Backend:** Render
- **Database:** MongoDB Atlas

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- A **MongoDB Atlas** connection string (or local MongoDB)
- A **Mapbox** access token
- *(Optional)* A **Gemini API** key for AI-powered allocation explanations

### 1. Clone the repository

```bash
git clone https://github.com/rishabhhS17/Delivery-Partner-Allocation-Engine-.git
cd Delivery-Partner-Allocation-Engine-
```

### 2. Backend setup

```bash
cd backend
npm install
```

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Fill in your values:

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
GEMINI_API_KEY=your_gemini_api_key        # optional
```

Start the server:

```bash
npm run dev        # development (nodemon)
npm start          # production
```

### 3. Frontend setup

```bash
cd frontend
npm install
```

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Fill in your values:

```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_MAPBOX_ACCESS_TOKEN=your_mapbox_access_token_here
```

Start the dev server:

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

---

## 📡 API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/riders` | Register a rider |
| `GET` | `/riders` | List riders |
| `GET` | `/riders/:id` | Rider details |
| `PUT` | `/riders/:id/location` | Update rider location |
| `PUT` | `/riders/:id/status` | Update availability / status |
| `POST` | `/restaurants` | Add a restaurant |
| `GET` | `/restaurants` | List restaurants |
| `DELETE` | `/restaurants/:id` | Soft-delete a restaurant |
| `POST` | `/customers` | Add a customer |
| `GET` | `/customers` | List customers |
| `DELETE` | `/customers/:id` | Soft-delete a customer |
| `POST` | `/orders` | Create an order |
| `POST` | `/orders/bulk` | Create N orders at once |
| `GET` | `/orders` | List orders |
| `GET` | `/orders/:id` | Order details |
| `POST` | `/allocate-order` | Trigger allocation for an order |
| `GET` | `/allocation-history` | Allocation audit trail |
| `GET` | `/config/weights` | Get current scoring weights |
| `PUT` | `/config/weights` | Update scoring weights |

> Live map updates are pushed over a **WebSocket** channel, not polled.

---

## 📁 Project Structure

```
Delivery-Partner-Allocation-Engine-/
├── backend/
│   ├── src/
│   │   ├── config/          # App config, scoring weights, bounding box
│   │   ├── controllers/     # Route handlers
│   │   ├── middleware/       # Auth, error handling
│   │   ├── models/          # Mongoose schemas
│   │   ├── routes/          # Express route definitions
│   │   ├── services/        # Allocation engine, simulation, order generator
│   │   ├── utils/           # Haversine, helpers
│   │   ├── validators/      # Request validation
│   │   ├── tests/           # Test suites
│   │   ├── app.js           # Express app setup
│   │   └── server.js        # Entry point
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/             # Axios service layer
│   │   ├── assets/          # Static assets
│   │   ├── components/      # Reusable UI components
│   │   ├── config/          # Frontend config
│   │   ├── context/         # React context providers
│   │   ├── hooks/           # Custom hooks
│   │   ├── layouts/         # Page layouts
│   │   ├── pages/           # Route-level page components
│   │   ├── routes/          # Route definitions
│   │   ├── services/        # Socket.IO, business logic
│   │   ├── theme/           # MUI theme customization
│   │   ├── utils/           # Helpers
│   │   ├── App.jsx          # Root component
│   │   └── main.jsx         # Entry point
│   ├── .env.example
│   ├── vite.config.js
│   └── package.json
├── docs/                    # Detailed design documentation
│   ├── ALLOCATION_LOGIC.MD  # Scoring pipeline, worked examples
│   ├── API_ENDPOINTS.MD     # Full API surface
│   ├── APPLICATION_FLOW.MD  # End-to-end system flow
│   ├── DATABASE_DESIGN.MD   # Collections, schemas, indexes
│   ├── FEATURES.MD          # Feature catalogue (core + enhancements)
│   ├── FRONTEND_PAGES.MD    # Build phases & page breakdown
│   └── PROJECT_SPEC.MD      # Full project specification
└── README.md
```

---

## 📚 Documentation

Detailed design docs live in the [`docs/`](docs/) folder:

| Document | What it covers |
|----------|---------------|
| [**PROJECT_SPEC.MD**](docs/PROJECT_SPEC.MD) | Full specification — how the system works, design decisions, architecture |
| [**ALLOCATION_LOGIC.MD**](docs/ALLOCATION_LOGIC.MD) | Scoring pipeline, normalization, worked examples, edge cases |
| [**APPLICATION_FLOW.MD**](docs/APPLICATION_FLOW.MD) | End-to-end flow — startup, simulation loop, order lifecycle |
| [**DATABASE_DESIGN.MD**](docs/DATABASE_DESIGN.MD) | MongoDB collections, schemas, relationships, indexes |
| [**FEATURES.MD**](docs/FEATURES.MD) | Feature catalogue — core requirements + stretch enhancements |
| [**FRONTEND_PAGES.MD**](docs/FRONTEND_PAGES.MD) | Build phases (MVP → depth → polish) and page breakdown |
| [**API_ENDPOINTS.MD**](docs/API_ENDPOINTS.MD) | REST API surface + WebSocket channel |

---

## ⚖️ Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Weighted scoring with normalization** | Different factors (km, 1–5 rating, delivery count) use different scales — normalize to 0–1 first, then weight |
| **Availability as a filter, not a weight** | Every candidate is already available, so an availability score would be constant (1.0) and useless |
| **Load = recent workload** | With one order per rider, current active orders is always 0 for eligible riders — recent deliveries in a rolling window is a meaningful fairness signal |
| **Snapshot pattern for orders** | Restaurant/customer name + coords are copied onto the order so historical data survives deletions |
| **Deterministic core, AI on the edge** | The engine is rule-based and reproducible; AI only rephrases the "why" afterward |
| **Server-side movement** | Positions are computed on the backend (single source of truth) and streamed — no client drift |

---

## 🗺️ Roadmap

- [ ] Weight-tuning sliders on the live map
- [ ] Reassignment on rider failure (self-healing delivery)
- [ ] SLA / stale-order flagging
- [ ] Candidate comparison (why the winner beat the runner-up)
- [ ] Queue-depth-over-time chart
- [ ] Order cancellation
- [ ] Redis-backed order queue (BullMQ) for higher scale
- [ ] Road-distance routing (replace Haversine straight-line)

---

## 📄 License

This project is for educational and portfolio purposes.
