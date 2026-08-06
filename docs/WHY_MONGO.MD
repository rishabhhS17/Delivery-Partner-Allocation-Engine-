# Why MongoDB? An Honest Assessment

This document records a real engineering decision: for storing the dispatch data in
this project we had two serious candidates — **PostgreSQL** (SQL) and **MongoDB**
(NoSQL, document). PostgreSQL is the choice that scales better in production. We
still shipped this project on MongoDB, on purpose.

This is not a rationalisation after the fact. It explains **what the two options
were**, **why Postgres is the production-correct answer and what actually *needs*
it**, **why MongoDB was nonetheless the right tool for this particular demo**, and
**why presenting a Swiggy/Zomato-style ecosystem on MongoDB is defensible.**

> The senior-engineer point this whole document is really making: *the "right"
> database depends on what you are optimising for. Production optimises for
> correctness, consistency and scale. A portfolio demo optimises for iteration
> speed and clearly showing the interesting ideas. Different goals, different
> answers.*

---

## 1. The two options we weighed

| | **PostgreSQL** (SQL) | **MongoDB** (NoSQL / document) |
|---|---|---|
| Data model | Relational tables, foreign keys | JSON/BSON documents |
| Consistency | ACID by default | Tunable; multi-doc transactions available but not the default idiom |
| Relationships | Native `JOIN`, referential integrity | `ref` + `populate` (application-level joins) |
| Geospatial | PostGIS extension (exact geometry) | `2dsphere` indexes (GeoJSON) |
| Analytics | Window functions, `GROUP BY`, rich SQL | Aggregation pipeline, or compute in app |
| Schema changes | Migration files | Add a field, keep going |
| Best when | Data is relational & transactional; correctness is paramount | Data is document-shaped; schema is still moving; iteration speed matters |

That's the honest shortlist. (Redis, Cassandra, Elasticsearch etc. are real parts
of a production stack too, but they are *supporting* stores around a primary DB —
they were never candidates to be *the* system of record. See §5.)

---

## 2. Why Postgres is the better production choice — and what actually *needs* it

Orders and payments are the classic case where the database's guarantees matter as
much as its storage. Here is the concrete *need*, not just "SQL is more serious":

### 2.1 ACID transactions — because money and assignments must be atomic
An order changing state touches multiple rows: the order, the assigned rider, maybe
a payment, maybe a wallet balance. These must all succeed or all fail together.

```sql
BEGIN;
  UPDATE riders  SET status = 'BUSY'        WHERE id = $rider AND status = 'IDLE';
  UPDATE orders  SET rider_id = $rider,
                     status  = 'ASSIGNED'   WHERE id = $order;
COMMIT;
```

If the process dies between the two updates, Postgres rolls back — no rider left
marked busy for an order that never got assigned. This is *default* behaviour, not
something you bolt on.

### 2.2 Concurrency control — preventing two orders grabbing the same rider
At real volume, many allocations run at once. Postgres row-level locking
(`SELECT ... FOR UPDATE`) lets you claim a rider so no concurrent allocation can
double-book them. This is exactly the hard part of a dispatch engine, and it is a
solved, first-class feature in a relational DB.

### 2.3 Referential integrity — no orphaned data
Foreign keys guarantee an order can't point at a rider or restaurant that doesn't
exist. In this project we *sidestepped* that by copying `restaurantName`,
`customerLat/Lng`, etc. onto each order (the "snapshot" pattern). That works — but
it's a deliberate trade of integrity for convenience, and in a real system that
denormalisation drift (stale copied data) becomes a maintenance problem Postgres
would prevent structurally.

### 2.4 SQL analytics — push the work to the engine
Dispatch dashboards ask relational questions: average pickup time, throughput per
zone, per-rider fairness. In SQL those are one query:

```sql
SELECT rider_id, AVG(delivered_at - assigned_at) AS avg_delivery,
       RANK() OVER (PARTITION BY zone ORDER BY COUNT(*) DESC)
FROM orders GROUP BY rider_id, zone;
```

In our Mongo version this work happens in JavaScript, pulling documents into Node
and aggregating in memory. Fine at demo scale; wrong place for it at production
scale.

### 2.5 Exact geospatial with PostGIS — where hexagons aren't enough
PostGIS gives true geometry: `ST_DWithin`, `ST_Contains`, exact nearest-neighbour.
Real serviceability zones are irregular ops-drawn polygons, not perfect hexagons,
so a boundary decision ("is this address *actually* inside zone 47?") wants exact
geometry, and it can run *inside* the database so non-candidate riders never cross
the wire.

> **Important nuance (see §4):** PostGIS does **not** replace H3, and needing exact
> geometry does not mean the whole geo layer moves into Postgres. The two are
> complementary layers.

### 2.6 Ecosystem maturity
Decades of tooling: replication, PITR backups, connection pooling, query planners,
migration frameworks, monitoring. For a system handling money and SLAs, that
operational maturity is itself a feature.

**This is why the production dispatch core at a Swiggy/Zomato scale belongs on a
relational store.** It's not fashion — it's ACID, concurrency control, integrity,
and analytics being native rather than emulated.

---

## 3. Why we still used MongoDB for *this* project

A portfolio/demo project is optimising for something different: **showing the
interesting ideas quickly and clearly.** Against that goal, Mongo was the right
tool.

### 3.1 The data here is genuinely document-shaped
Look at what an `Order` actually holds:

- `leg1Coords: [[Number]]`, `leg2Coords`, `polyline` — arrays of coordinate pairs,
  stored natively. In SQL these become a PostGIS `LINESTRING` or a `JSONB` array —
  more ceremony either way.
- `breakdown: Mixed` in allocation history — an arbitrary nested scoring blob that
  maps straight to BSON. In Postgres it's a `JSONB` column (works, less natural).
- The **snapshot pattern** — each order carries its own copy of restaurant/customer
  coordinates, so it's self-contained and survives deletions with no foreign-key
  complaints. This is idiomatic document modelling.

The document model fit the shape of the data, so we spent zero time fighting the
ORM.

### 3.2 Schema evolution without migrations
This project's model moved constantly during development — `h3Index`,
`legStartedAt`, `nextOrderId`, `allocationScore`, cancellation timestamps were all
added iteratively. In Mongo that's "add the field." In Postgres each is a migration
file. When the schema is still being discovered, that friction compounds.

### 3.3 Zero-friction deployment
MongoDB Atlas free tier + Render + Vercel is a genuinely free, no-ops deployment
path — which is exactly what a portfolio project needs.

### 3.4 The scale erases the downsides
The production arguments in §2 bite at thousands of concurrent allocations and
millions of orders. At demo scale (hundreds of documents, one simulated city), the
in-memory analytics and application-layer geo-filtering are *milliseconds*. The
theoretical gap never materialises, so paying the Postgres migration/setup tax
would buy nothing observable.

---

## 4. H3 vs PostGIS — they are not competitors

A common misconception: "we already have H3, so we don't need PostGIS / exact geo."
They solve different problems and are normally used *together*.

| | **H3** | **PostGIS / exact geo** |
|---|---|---|
| What it is | Hexagonal **index / coordinate system** (a library) | **Geometry engine** (exact math) |
| Precision | Approximate — world bucketed into hexagons | Exact polygons and distances |
| Best at | Fast bucketing, candidate filtering (`kRing`), sharding, heatmaps | Precise containment / distance, irregular zones |
| Runs | App layer; the cell ID is a plain string in **any** DB (incl. Mongo) | Inside the database |

The production pattern is **H3 to filter, exact geometry to confirm**: use hex cells
to cheaply narrow millions of points to a handful, then run precise checks on that
small set. So exact geo doesn't *replace* H3 — and at these companies H3 usage is
well documented (Zomato has written about it), while the exact-geometry layer isn't
necessarily literally PostGIS (it can be Mongo `2dsphere`, Elasticsearch
`geo_shape`, Redis geo, or a bespoke service). We lean on H3 in this project
precisely because it's the part that scales cheaply; if we ever needed the "confirm"
step, Mongo's own `2dsphere` + `$geoWithin` provides it **without** adding a second
database.

---

## 5. What the full production stack really looks like

MongoDB-alone isn't the production answer — but neither is Postgres-alone. Real
food-delivery dispatch is **polyglot**, with a relational core:

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Dispatch core (orders, payments, riders) | **PostgreSQL** (+ PostGIS selectively) | ACID, concurrency, relational integrity, SQL analytics |
| Hot state | **Redis** | Active rider pool, pending queue, live positions (microsecond reads) |
| Event stream | **Kafka** | Order-lifecycle events, decoupling services |
| Search | **Elasticsearch** | "restaurants near me" |
| Analytics | Warehouse (BigQuery / Redshift / Snowflake) | Reporting at scale |
| Unstructured / logs | Mongo / Cassandra | Chat, audit blobs — *not* the allocation core |

Notice where MongoDB lands in production: at the *edges*, not the transactional
core. The highest-leverage single upgrade toward this shape for our project would be
**adding Redis** as the real-time/hot-state layer — that mirrors real architecture
far more than a Mongo→Postgres swap would, at a fraction of the effort.

---

## 6. Why presenting this ecosystem on MongoDB is alright

The point of this project is to demonstrate the **allocation ecosystem** — H3 geo
filtering, ETAR-based predictive assignment, the live simulation, real-time
tracking, cancellation/reassignment logic. **Every one of those interesting ideas is
database-agnostic.** The storage engine is an implementation detail underneath them;
swapping Mongo for Postgres wouldn't change a single line of the allocation
reasoning that the project exists to show off.

So Mongo let us:
- iterate on the *actual* subject matter (the allocation logic) fast, and
- deploy for free with no ops,

while costing nothing observable at demo scale. That's a good trade for a portfolio
piece.

And crucially — **being able to articulate this trade-off is itself the senior
signal.** "I used MongoDB because the data is document-shaped and I wanted iteration
speed for a demo; in production the dispatch core belongs on PostgreSQL for ACID,
concurrency control and relational integrity, with Redis/Kafka/Elasticsearch around
it" demonstrates exactly the judgment an interviewer is probing for. Choosing Mongo
knowingly, and being able to defend *when* you'd choose otherwise, beats reflexively
reaching for whichever DB is fashionable.

---

## 7. Summary

| Question | Answer |
|----------|--------|
| What were the options? | **PostgreSQL** (SQL) vs **MongoDB** (document NoSQL). |
| Which is better for production? | **PostgreSQL** — ACID, row-level concurrency control, referential integrity, native SQL analytics, PostGIS. |
| Why does production *need* Postgres? | Orders/payments are transactional and relational: money and rider assignments must be atomic and consistent, and two allocations must never double-book a rider. |
| Why did we use MongoDB anyway? | Data is document-shaped (arrays, nested blobs, snapshots), schema was still moving (no migrations), Atlas free tier = zero-ops deploy, and demo scale erases the downsides. |
| Do we need PostGIS since we have H3? | No — they're complementary (H3 filters, exact geo confirms), and Mongo `2dsphere` covers the "confirm" step if ever needed. |
| Is presenting the ecosystem on Mongo alright? | **Yes** — the allocation ideas are DB-agnostic; Mongo maximised iteration speed for showing them, and knowingly defending the trade-off is the senior signal. |
| Should we migrate now? | Not for a demo. The single most authentic upgrade would be **adding Redis** for hot state, not swapping the primary DB. |
