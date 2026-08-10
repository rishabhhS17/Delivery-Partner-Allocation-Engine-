# Scaling — How This System Grows From One Process to Many

How the Delivery Partner Allocation Engine scales from the single-process system it is
today toward a production-grade, Zomato/Swiggy-style dispatch system. This is a
**scaling playbook**: for every capability it answers the same four questions —

1. **What we can do** — the scaling move itself.
2. **How we implement it locally** — how to build and prove it on a dev machine (usually `docker-compose`).
3. **How we implement it deployed** — what changes when it runs on real hosting.
4. **What problem it solves** — the specific pain in *this* codebase it removes.

> Guiding principle: every technology below maps to a real problem in *this* code.
> Nothing is added because "big systems have it." If a component can't be justified
> against a line of our own code, it doesn't belong here.

---

## 1. The one thing that gates scaling

All hot-path state lives in **in-memory `Map`s inside a single Node process**
(`backend/src/services/simulationEngine.js`): `riderState` (live rider entries),
`h3Buckets` (the geo-index), `pendingQueue` (orders awaiting a rider), `activeRoutes`
(road-snapped polylines), and `recentAssignments` (a ring buffer of recent decisions).

This is fast and simple, but it is **the** reason we cannot scale yet:

- **Cannot scale horizontally** — a second instance has its own empty `Map`s; two servers
  would double-assign the same rider.
- **No fault tolerance** — a crash loses live state; we lean on `hydrate()` + orphan
  healers to rebuild from Mongo on restart.
- **Single point of failure** — one process *is* the whole dispatcher.

So the entire scaling story reduces to one architectural move, and everything below is a
consequence of it:

> **Make the services stateless by pushing shared state into external stores, and make
> dispatch event-driven.**

---

## 2. Where we are and where we're going

**Today:** React + Vite + Mapbox · Node/Express · Socket.IO · MongoDB (Mongoose) · H3
geo-grid · Mapbox Directions routing · JWT/passport auth. **One process** does API +
websockets + the simulation loop, holding all live state in memory.

**Already sound (keep as-is):** H3 hexagonal geo-filtering, multi-signal ETAR/rating/load
scoring, the PENDING → ASSIGNED → PICKED_UP → DELIVERED → CANCELLED state machine, and the
resilience already present (orphan sweeps, TTL cancellation, hydrate-on-start).

**Target:** N stateless app instances behind a load balancer, sharing state through Redis,
with dispatch driven by an event bus — so killing any instance is survivable and adding
instances is a deployment change, not a rewrite.

---

## 3. The scaling capabilities, one at a time

Each capability below follows the same four-part shape: **what → how locally → how deployed → problem solved.**

---

### 3.1 Externalize shared state into Redis

**What we can do.** Move the in-memory `Map`s (geo-index, pending queue, assignment guard,
recent decisions) out of the Node process and into Redis, so state lives *outside* any one
instance.

| In-memory today | Redis primitive | Role |
|---|---|---|
| `h3Buckets` (cell → riderIds) | `SADD h3:{cell} {riderId}` or Redis `GEOADD`/`GEOSEARCH` | Shared geo-index any instance can query |
| `pendingQueue` | Redis **Stream** or sorted set scored by `queuedAt` | Durable work queue; the TTL sweep reads the score |
| double-assign guard (`status !== 'IDLE'` recheck) | `SET rider:{id}:lock 1 NX PX 5000` | **Atomic** cross-instance claim of a rider |
| `recentAssignments` | `LPUSH` + `LTRIM` | Shared recent-decisions feed |

**How we implement it locally.** Add a Redis container to `docker-compose` and point the
app at it via an env var. Swap the `Map` reads/writes in `simulationEngine.js` for Redis
calls behind a small data-access layer, so the tick loop talks to Redis instead of local
memory. You can prove correctness on a single instance first — behaviour is identical, the
state just lives in Redis.

**How we implement it deployed.** Use a managed Redis (Upstash free tier, or Render/ElastiCache
paid). Only the connection string changes; the code is the same. On free hosting you can
wire this up on the single instance — it proves the *integration* works, though the
*scaling* payoff only shows once there's more than one instance.

**What problem it solves.** It removes the single-process constraint at its root. Once state
is in Redis, an instance holds nothing local, so it can crash and be replaced without losing
live dispatch state, and — critically — a second instance can now see the same riders and
queue instead of starting blank.

---

### 3.2 Distributed assignment lock (concurrency safety)

**What we can do.** Guarantee that when two instances consider the same idle rider at the
same moment, only one can claim them — using an atomic Redis lock (`SET NX`) instead of the
in-process `status !== 'IDLE'` recheck that only works within one process.

**How we implement it locally.** With Redis in `docker-compose`, run **two** app instances
and deliberately race them on the same order. Before assigning, each instance must win
`SET rider:{id}:lock 1 NX PX 5000`; the loser skips the rider. You can watch in the logs
that exactly one wins.

**How we implement it deployed.** Identical logic against managed Redis. This is one of the
capabilities you **cannot** meaningfully demonstrate on free single-instance hosting,
because a single process can't double-assign itself — it only matters across instances.

**What problem it solves.** Cross-instance double-assignment — the correctness bug that would
appear the instant you ran a second server. It's the core concurrency guarantee that makes
horizontal scaling *safe*, not just possible.

---

### 3.3 Horizontal scaling + Socket.IO Redis adapter

**What we can do.** Run 2..N identical app instances instead of one, and make WebSocket
broadcasts fan out across all of them so a client connected to instance #2 still receives a
tick emitted by instance #1.

**How we implement it locally.** In `docker-compose`, scale the app service to two replicas
and add the **Socket.IO Redis adapter** (backed by the same Redis) so pub/sub carries
broadcasts between instances. Connect two browser tabs and confirm both see live updates
regardless of which instance served them.

**How we implement it deployed.** Bump the instance count on a paid tier (Render scaling,
or containers behind a cloud load balancer) and point the Socket.IO adapter at managed
Redis. **Free hosting caps you at one instance**, so this is a local-only demonstration
there.

**What problem it solves.** Two things: capacity (more instances share the request and
websocket load) and the specific WebSocket fan-out problem — without the adapter, a
broadcast only reaches clients on the emitting instance, so live maps would silently go
stale for anyone connected elsewhere.

---

### 3.4 Load balancing

**What we can do.** Put a reverse proxy / load balancer (Nginx or Traefik) in front of the
app instances to spread incoming traffic across them, terminate TLS, and route WebSocket
upgrades (with sticky sessions if needed).

**How we implement it locally.** Add an Nginx container to `docker-compose` configured to
round-robin across the two app replicas, and send all browser traffic through it instead of
hitting an instance directly. You can kill one backend and watch traffic continue through
the survivor.

**How we implement it deployed.** Either a managed load balancer (cloud provider LB, or the
platform's built-in routing) or a self-hosted Nginx/Traefik in front of your containers,
with real TLS certificates. On free single-instance hosting there's nothing to balance
*across*, so the balancer is a local/paid-tier concern.

**What problem it solves.** It gives one stable entry point in front of many
interchangeable backends, so no single instance is a bottleneck or a hard failure point —
and it's the piece that makes "add another instance" transparent to clients.

---

### 3.5 Event-driven dispatch (message bus)

**What we can do.** Decouple order intake from allocation by putting a message bus between
them: an **Order Service** produces an `order.created` event, a **Dispatch Service**
consumes it and runs allocation, and state transitions (`order.assigned`, `order.picked_up`,
`order.delivered`) become events a Tracking/Gateway relays to clients.

**How we implement it locally.** Start with **Redis Streams** (reusing the Redis you already
have — one fewer system to run). Producers `XADD` to a stream; dispatch workers read via a
consumer group so multiple workers share the load and get at-least-once delivery. In
`docker-compose` you can run one order producer and two dispatch consumers and watch work
distribute.

**How we implement it deployed.** Same Redis Streams design against managed Redis for the
demo. Document the exact threshold at which **Kafka** becomes worth its heavier operational
weight — sustained high throughput, multi-consumer replay, long retention — and treat that
as a future migration, not a day-one requirement.

**What problem it solves.** It lets dispatch scale and fail **independently** of order
intake — an intake spike or a dispatch crash no longer takes the other down — and it gives
durable, replayable, at-least-once event delivery instead of an in-process function call
that vanishes if the process dies. This is exactly how real Swiggy/Zomato decouple these
services (see `ZOMATO.md` §2).

---

### 3.6 Rate limiting

**What we can do.** Cap how many requests a single client or user can make in a window, to
protect the system from abuse, brute-force, and DoS. (A per-instance version is **already
implemented** in `app.js` via `express-rate-limit` — a general limiter and a stricter login
limiter.)

**How we implement it locally.** The current in-process limiter works today. To make it
correct across instances, move the counter into Redis (token-bucket or sliding window keyed
by IP/user) so the limit is shared, and test it in `docker-compose` by hammering through the
load balancer and confirming the cap holds regardless of which instance answers.

**How we implement it deployed.** Enforce it at the gateway/load-balancer layer or via the
Redis-backed limiter against managed Redis, so limits are global. The in-process version
already runs fine on free single-instance hosting.

**What problem it solves.** On one instance, an in-memory counter is enough. Across
instances it isn't — each would keep its own count and a client could get N times the
intended limit by spreading requests. A shared Redis counter fixes that and gives one true
global quota.

---

### 3.7 Health, readiness & graceful lifecycle

**What we can do.** Expose health/readiness/liveness endpoints and handle shutdown
gracefully, so an orchestrator or load balancer can route around a sick instance and drain a
dying one cleanly. (A `/health` endpoint and graceful `SIGTERM`/`SIGINT` shutdown already
exist in `server.js`.)

**How we implement it locally.** In `docker-compose`, add health checks that hit the
endpoint and a readiness probe that only reports ready once Redis and Mongo connections are
live. Confirm the load balancer stops sending traffic to an instance you deliberately make
unhealthy.

**How we implement it deployed.** Wire the same probes into the platform (Render health
checks, or Kubernetes liveness/readiness later) so unhealthy instances are restarted and new
ones only receive traffic once ready. Graceful shutdown lets in-flight requests finish
before an instance exits during a deploy.

**What problem it solves.** It turns a crash or a bad deploy from a user-visible outage into
a silent, automatic reroute — the operability layer that makes running many instances
practical rather than fragile.

---

### 3.8 Data-layer scaling & observability

**What we can do.** Scale the database and gain visibility: a MongoDB `2dsphere` geo-index
on coordinates, **read replicas** for read-heavy `/orders` and analytics endpoints,
**sharding by city** for multi-city, plus structured logs and **Prometheus** metrics (queue
depth, allocation latency, assignment success rate).

**How we implement it locally.** Add the `2dsphere` index in the Mongoose schema and verify
geo-queries use it. Run a Prometheus + Grafana pair in `docker-compose` scraping a `/metrics`
endpoint to watch queue depth and allocation latency live. Replicas/sharding can be
simulated with a local replica set.

**How we implement it deployed.** MongoDB Atlas provides replicas and sharding as
configuration on paid tiers (Atlas M0 free tier is single-node, so replicas/sharding are a
paid/local concern). Point Prometheus at the deployed `/metrics` endpoint, or use a hosted
metrics backend.

**What problem it solves.** The geo-index keeps "riders near this restaurant" fast as data
grows; replicas keep read-heavy endpoints from competing with dispatch writes; sharding lets
each city's data live and scale independently. Observability turns "it feels slow" into a
number you can watch and alert on.

---

## 4. What we deliberately are NOT doing (and why)

Judgment matters as much as tooling:

- **No Kubernetes / service mesh for the demo.** `docker-compose` (app ×2 + Redis + Nginx +
  Mongo) demonstrates the *same* stateless/horizontal-scale property without the operational
  tax. K8s is a deployment detail, not a scaling insight.
- **No trained ML for ETA/demand.** The engine is **deterministic and explainable** by
  design — every allocation stores its score breakdown. ML is future work, not a gap.
- **No real rider/customer apps, payments, or POS.** Those are integration surface, not the
  algorithmic core; the **simulation engine** stands in for real GPS feeds.

The anti-goal is bolting Kafka + K8s + a mesh onto a single-city demo we can't justify.
Depth on Redis + event-driven dispatch — and a clear account of why *not* the rest — beats
breadth.

---

## 5. The single-instance boundary (free hosting)

The project is deployed for demos on **free tiers** (Vercel frontend + Render backend +
MongoDB Atlas M0 — full setup in `DEPLOYMENT.md`), which impose one hard limit:

> **Free hosting gives you exactly one backend instance.** Render's free web service is a
> single 512 MB process, so anything whose value *only* appears across multiple instances
> can only be shown locally via `docker-compose`.

**Runs perfectly on the free single instance:** full H3 + ETAR/rating/load allocation, the
simulation loop and live Mapbox maps over WebSocket, the order state machine + TTL
cancellation + orphan healing, the already-implemented rate limiting and Helmet CSP, Mongo
Atlas persistence, and JWT auth. Optionally, Redis (Upstash) can be wired on the single
instance to prove the *integration*.

**Needs ≥ 2 instances, so `docker-compose`-only:** horizontal scaling (§3.3), Socket.IO
Redis adapter fan-out (§3.3), the distributed assignment lock (§3.2), load balancing (§3.4),
and independent scaling of Order vs Dispatch (§3.5).

**The honest framing (use verbatim in an interview):**

> "The live demo runs single-instance on free hosting — a perfectly valid design for one
> node. The system is *architected* to scale horizontally: state is designed to move into
> Redis (geo-index, queue, atomic assignment locks) and dispatch to become event-driven, so
> adding instances behind a load balancer is a deployment change, not a rewrite. I
> demonstrate that multi-instance version locally with docker-compose, because free tiers cap
> you at a single instance."

---

## 6. Roadmap summary

| Phase | Deliverable | Proves |
|---|---|---|
| **1** | Redis: geo-index, pending queue, `SET NX` assignment locks (§3.1–3.2) | Stateless services, concurrency safety |
| **2** | Socket.IO Redis adapter + 2 instances behind Nginx (§3.3–3.4) | Horizontal scalability + load balancing |
| **3** | Event-driven split via Redis Streams: Order → Dispatch (§3.5) | Decoupled, event-driven dispatch |
| **4** | Redis-backed rate limiting + health/readiness + graceful shutdown (§3.6–3.7) | Edge hardening, operability |
| **5** | Mongo 2dsphere / replicas + Prometheus metrics (§3.8) | Data-layer scale + observability |
| **6** (design-only) | Kafka, service split by process, shard-by-city | Awareness of the next scaling step |

**Demo target:** Phases 1–4 running locally via `docker-compose` is a genuine,
horizontally-scalable, event-driven dispatch system — enough to *show*, not just claim,
production-grade design. Phases 5–6 are documented with explicit tradeoffs.

---

## 7. Success criteria

We call the scaling design proven when:

1. Any app instance can be killed mid-run and dispatch continues (state is in Redis).
2. Two app instances never double-assign a rider (atomic locks hold).
3. Order intake and dispatch scale and fail independently (event bus).
4. Every scaling choice has a one-line justification tied to our code **and** a stated
   tradeoff — including the ones we chose *not* to adopt.

---

## Related docs

- `ZOMATO.md` — how real Zomato/Swiggy dispatch works underneath (the reference model).
- `DEPLOYMENT.md` — free-tier hosting (Vercel + Render + Atlas), env vars, warm-up checklist.
- `ENHANCEMENTS.md` — product/behavior enhancements to the allocation engine.
