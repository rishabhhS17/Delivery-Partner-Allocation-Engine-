
# Delivery Partner Allocation Engine — Allocation Logic (v2)

How the engine decides which rider gets an order.

The logic is **deterministic and rule-based** — the same inputs always produce the
same assignment. AI is used only to phrase the explanation afterward, never to make
the choice.

This version implements the **H3 hexagonal geo-indexing + ETAR-based assignment**
model used by real food delivery platforms like Swiggy and Zomato.

---

## 1. The Pipeline

```
new / pending order
        │
        ▼
1. GEO-FILTER    compute restaurant's H3 hexagon            → geo-candidates
                 keep only ONLINE riders within k=2 ring
        │
        ▼
2. ETAR          compute Estimated Time to Arrive at         → scored candidates
                 Restaurant for each geo-candidate
        │
        ▼
3. SCORE         combine ETAR + Rating + Load into           → ranked candidates
                 a weighted 0–1 score
        │
        ▼
4. SELECT        pick the highest final score                → winner
        │
        ▼
5. EXPLAIN       generate a human-readable reason            → assignment + reason
```

If step 1 yields **no geo-candidates**, the order stays `PENDING` in the FIFO queue
and is retried on the next tick.

---

## 2. Step 1 — H3 Hexagonal Geo-Filter

### What is H3?

H3 is Uber's open-source hexagonal hierarchical geospatial indexing system (the
`h3-js` npm package). It divides the entire Earth's surface into a hierarchy of
hexagonal cells at 16 resolution levels. Swiggy, Zomato, and Uber all use this
system for delivery zone management.

**Why hexagons over circles?**
A hexagon tessellates perfectly — every hexagon has exactly 6 neighbors all at
the same distance from its center. Circles overlap and leave gaps. Hexagons give
uniform coverage with zero ambiguity about which zone a point belongs to.

### Resolution

The engine uses **resolution 7**.

| Metric | Value |
|--------|-------|
| Average hexagon area | ~5.16 km² |
| Average edge length | ~1.2 km |
| k=1 ring (hex + neighbors) | 7 hexagons, ~3 km radius |
| k=2 ring | 19 hexagons, ~4–5 km radius |
| k=5 ring | 91 hexagons, ~8–10 km radius |

For a city like Ranchi (~15×15 km urban area), resolution 7 gives roughly 40–60
hexagons covering the city — granular enough to be meaningful, coarse enough that
each zone has multiple riders.

### Delivery Partner Candidate Pool

When an order arrives for a restaurant:

```
restaurantHex  = h3.latLngToCell(restaurant.lat, restaurant.lng, 7)
candidateZone  = h3.gridDisk(restaurantHex, 2)          // 19 hexagons, ~4–5 km
```

A rider is in the **geo-candidate pool** if:
- Their pre-computed `h3Index` (stored on the Rider document at resolution 7) is contained in `candidateZone`
- `availabilityStatus === 'ONLINE'`

> **Key change from v1:** Riders with status `ACCEPTED` or `PICKED_UP` are now
> included — not just `IDLE`. A rider finishing a nearby delivery is a real
> candidate. Their availability is handled by ETAR (they have a non-zero
> time-to-free).

**This lookup is performed against the in-memory H3 bucket map, not a MongoDB
query.** See §2.1 below for the in-memory index architecture.

### Order Generation Service Area Constraint

The auto-order generator must not pair a customer with a restaurant they are too
far from. Before creating an order:

```
restaurantHex  = h3.latLngToCell(restaurant.lat, restaurant.lng, 7)
serviceArea    = h3.gridDisk(restaurantHex, 5)          // ~8–10 km delivery radius
customerHex    = h3.latLngToCell(customer.lat, customer.lng, 7)

if (!serviceArea.includes(customerHex)) → skip this pair, try another restaurant
```

This prevents Lucknow-to-Allahabad style pairings at the data generation level.

### 2.1 In-Memory H3 Bucket Map

Computing each rider's H3 cell on every tick and scanning all riders per order
produces an O(P × R) operation per tick (P pending orders × R total riders). For a
small demo fleet this is invisible, but the pattern is wrong. The correct approach:

**The simulation module maintains two in-memory structures:**

```js
riderState  // Map<riderId → full rider object (includes h3Index)>
h3Buckets   // Map<h3Cell → Set<riderId>>
```

**On startup:** load all riders from MongoDB, compute `h3Index` for each from their
stored coordinates, populate both maps.

**On every tick (position update):** update lat/lng and `h3Index` in `riderState`;
move the riderId between cells in `h3Buckets`. Cost: O(1) per rider move. **No
MongoDB write.**

**On lifecycle events only** (state transitions that matter for persistence):
flush the rider's updated position and `h3Index` to MongoDB. These events are:
- Rider assigned → `ACCEPTED`
- Rider reaches restaurant → `PICKED_UP`
- Rider delivers → back to `IDLE`
- Rider toggles `ONLINE` / `OFFLINE`

This is 3–4 DB writes per delivery cycle instead of one per tick (~20× reduction).

**The geo-filter hot path becomes:**

```js
candidateZone = h3.gridDisk(restaurantCell, 2)           // 19 cells
candidates    = ∪ h3Buckets.get(cell) for each cell      // O(19 + C)
```

Total cost per order: **O(19 + C)** where C = riders currently in the zone.
No MongoDB query on the allocation hot path.

**Why not Redis?** An in-process Map is sufficient for a single-server demo.
The seam to move `h3Buckets` into Redis exists if the system ever scales
horizontally — the interface is the same.

---

## 3. Step 2 — ETAR: Estimated Time to Arrive at Restaurant

ETAR replaces raw distance as the primary ranking signal. It answers the real
question: **which candidate will physically be at the restaurant soonest?**

```
ETAR = time_to_free + travel_time_to_restaurant
```

### time_to_free

How long until the rider can leave for the new restaurant.

| Rider Status | time_to_free |
|---|---|
| `IDLE` | `0` |
| `PICKED_UP` (delivering to customer) | `(1 − progress) × order.leg2Duration_s` |
| `ACCEPTED` (heading to pick up) | `(1 − progress) × order.leg1Duration_s + order.leg2Duration_s` |

`leg1Duration_s` and `leg2Duration_s` are computed at order assignment time from
actual route distances and stored on the order:

```
leg1Duration_s = haversine(rider, restaurant) / RIDER_SPEED_KMH × 3600
leg2Duration_s = haversine(restaurant, customer) / RIDER_SPEED_KMH × 3600
```

**ACCEPTED formula explained:** an ACCEPTED rider has the remaining fraction of
leg 1 plus the entire leg 2 still ahead. At 50% progress on leg 1:
`0.5 × leg1Duration_s + leg2Duration_s`. The previous formula
`(1 − progress) × AVG_LEG_DURATION × 2` collapsed leg 2 into the progress
fraction, yielding near-zero estimates for riders deep into leg 1 — a significant
ETAR underestimate corrected here.

### travel_time_to_restaurant

```
distance_km  = haversine(rider.lat, rider.lng, restaurant.lat, restaurant.lng)
travel_time_s = distance_km / RIDER_SPEED_KMH × 3600
```

All riders travel at a constant `RIDER_SPEED_KMH = 40` (configurable). This is
used for both ETAR calculation and actual movement simulation — keeping scoring
and movement consistent.

### Result

Every geo-candidate gets an ETAR in seconds. At 40 km/h:

- Idle rider **2.0 km** from restaurant: `0 + (2.0/40)×3600 = **180s**`
- PICKED_UP rider **0.3 km** from restaurant, 85% done with a leg of
  `leg2Duration_s = 27s`: `(0.15 × 27) + (0.3/40×3600) = 4 + 27 = **31s** — wins`

Rider B wins despite being mid-delivery because their remaining time to the
restaurant is far shorter than Rider A's travel time from idle.

---

## 4. Step 3 — Weighted Scoring

Three factors are scored and combined, each normalized to 0–1 (1 = best).

| Factor | Raw Input | Score (0–1, higher = better) |
|--------|-----------|------------------------------|
| ETAR | Seconds until at restaurant | `1 − (ETAR / maxETAR)` among candidates |
| Rating | Rider rating 1–5 | `rating / 5` |
| Load | Deliveries in last 60 min | `1 − (recentLoad / maxLoad)` among candidates |

**ETAR replaces Distance** as the primary factor. Distance was a proxy for speed
of arrival; ETAR is a direct measure of it and is strictly more accurate because
it accounts for riders who are currently mid-delivery.

### Weighted Final Score

```
Final Score = (w_etar   × ETARScore)
            + (w_rating × RatingScore)
            + (w_load   × LoadScore)
```

**Default weights:**

| Factor | Default weight |
|--------|---------------|
| ETAR | 0.50 |
| Rating | 0.30 |
| Load | 0.20 |

Weights are **runtime-configurable** by the admin and normalized to sum to 1
before scoring. The rider with the highest final score is selected.

**Edge case — maxLoad = 0:** If every candidate has zero deliveries in the past
60 minutes, `LoadScore = 1.0` for all of them — no differentiation on load.

**Edge case — maxETAR = 0:** If every candidate is IDLE and at zero distance
(degenerate), `ETARScore = 1.0` for all. In practice this cannot occur.

---

## 5. Worked Example

An order comes in at Restaurant R. The k=2 ring around R contains two ONLINE
riders. RIDER_SPEED_KMH = 40.

| Rider | Status | Progress | Dist to R | leg2Duration_s | ETAR |
|-------|--------|----------|-----------|----------------|------|
| A | IDLE | — | 2.0 km | — | 0 + (2.0/40)×3600 = **180s** |
| B | PICKED_UP | 0.85 | 0.3 km | 27s (0.3 km leg) | (0.15×27) + (0.3/40)×3600 = 4 + 27 = **31s** |

Rider B is still delivering, but 85% through a short final leg and only 300m from R.

Normalize (maxETAR = 180):

| Rider | ETARScore | RatingScore (A=4.8, B=4.2) | LoadScore (A=0, B=1 recent) |
|-------|-----------|-----------------------------|-----------------------------|
| A | 1 − 180/180 = **0.00** | 4.8/5 = **0.96** | 1 − 0/1 = **1.00** |
| B | 1 − 31/180 = **0.828** | 4.2/5 = **0.84** | 1 − 1/1 = **0.00** |

**With default weights (0.50 / 0.30 / 0.20):**

```
A = 0.50×0.00 + 0.30×0.96 + 0.20×1.00 = 0.488
B = 0.50×0.828 + 0.30×0.84 + 0.20×0.00 = 0.666   ← winner
```

Rider B wins — arriving in 31s vs Rider A's 180s. Under v1, Rider A (idle) would
have won because IDLE was a hard filter. This is the core improvement.

---

## 6. Edge Cases

| Scenario | Phase | Behaviour |
|----------|-------|-----------|
| No ONLINE riders in k=2 ring | Core | Order stays `PENDING` in FIFO queue, retried next tick |
| Assigned (`ACCEPTED`) rider goes `OFFLINE` | Core | Order reset to `PENDING`, `queuedAt = now`, pushed to **front** of queue at priority 1; rider cleared |
| Pre-assigned rider (`nextOrderId`) goes `OFFLINE` | Enhancement | Order reset to `PENDING`, re-queued at back at normal priority |
| Order still unassigned after `MAX_ALLOCATION_RETRIES` ticks | Enhancement | Order moved to back of queue (`queuedAt = now`) to unblock newer orders |
| Single candidate | Core | maxETAR = that candidate's ETAR; ETARScore = 1.0 |
| All candidates tie | Core | First in iteration order wins (stable query order) |
| All-zero weights supplied | Core | Engine falls back to default weights |
| No valid restaurant-customer pair in service area | Core | Order generator retries with a different restaurant (max 10 attempts) |

> **Out of scope:** `PICKED_UP` rider going offline mid-delivery is not handled.
> The order remains `ASSIGNED` and does not re-queue.

---

## 7. Step 5 — AI Explanation (decision stays deterministic)

After the winner is chosen, a plain-language reason is generated, e.g.:

> *"Rider B was selected: will arrive at the restaurant in ~78 seconds — faster
> than all other candidates despite currently completing a delivery. Rated 4.2/5."*

A deterministic template always generates this from the score breakdown. An AI
model (Gemini *(enhancement)*) can optionally rewrite it more naturally. The AI never
selects the rider — if the AI call fails, the template reason is used and the
assignment is unaffected.

---

## 8. Configuration Reference

| Parameter | Default | Description |
|-----------|---------|-------------|
| `H3_RESOLUTION` | 7 | Hexagon zoom level — used for both rider index and service area |
| `CANDIDATE_RING_SIZE` | 2 | k-ring around restaurant for rider candidate pool (~4–5 km radius) |
| `SERVICE_AREA_RING_SIZE` | 5 | k-ring for customer-restaurant pairing (~8–10 km radius) |
| `RIDER_SEED_COUNT` | 30–35 | Recommended fleet size — gives ~6–8 candidates per order with res 7 k=2 |
| `RIDER_SPEED_KMH` | 40 | Constant speed for all riders — used for both ETAR and movement |
| `TICK_INTERVAL_MS` | 1000 | Heartbeat interval; riders broadcast position every tick |
| `MAX_ALLOCATION_RETRIES` | 10 | *(Enhancement)* Failed allocation ticks before an order is moved to back of queue |
| `w_etar` | 0.50 | Weight for ETAR score |
| `w_rating` | 0.30 | Weight for rating score |
| `w_load` | 0.20 | Weight for load score |
| `LOAD_WINDOW_MINUTES` | 60 | Rolling window for recent-load counting |

**Why res 7 k=2 for candidates?** At res 7 (edge ~1.22 km), k=2 covers ~4–5 km —
a 6–7 minute motorbike ride at 40 km/h. This matches the real-world assignment
radius used by Swiggy and Zomato. A tighter zone (e.g. res 8 k=2, ~1.5 km) causes
frequent "no candidates" events with a 30-rider fleet spread across a city.

**Why res 7 k=5 for service area?** The service area check runs once at order
creation (not per tick) and needs ~8–10 km coverage to match realistic delivery
range. Res 7 k=5 gives exactly that with 91 hexagons — efficient and correct.

---

<!--
## ARCHIVED — v1 Allocation Logic
The original allocation logic is preserved below for reference.
It has been superseded by the H3 + ETAR model above.

Allocation logic · MD
# Delivery Partner Allocation Engine — Allocation Logic
 
How the engine decides which rider gets an order. The logic is **deterministic and
rule-based** — the same inputs always produce the same assignment. AI is used only to
phrase the explanation afterward, never to make the choice.
 
---
 
## 1. The pipeline
 
```
new / pending order
        │
        ▼
1. FILTER     keep only ONLINE + IDLE riders          → candidates
        │
        ▼
2. SCORE      score each candidate 0–1 per factor,     → scored candidates
              combine with configurable weights
        │
        ▼
3. SELECT     pick the highest final score             → winner
        │
        ▼
4. EXPLAIN    generate a human-readable reason         → assignment + reason
```
 
If step 1 yields **no candidates**, the order is not dropped — it stays `PENDING`
in a FIFO queue and is retried on the next tick when a rider frees up.
 
---
 
## 2. Step 1 — Eligibility filter
 
Only riders that are **`availabilityStatus === 'ONLINE'`** *and*
**`status === 'IDLE'`** are considered.
 
Availability is a **hard filter, not a scored factor.** Since every candidate that
reaches scoring is already available, an "availability score" would be identical
(1.0) for all of them and contribute nothing to the ranking. Filtering instead of
weighting removes that dead weight.
 
---
 
## 3. Step 2 — The factors
 
Three factors are scored. Each is **normalized to a 0–1 range** (1 = best) so values
in different units can be compared and combined.
 
| Factor   | Raw input                          | Score (0–1, higher = better)                   |
|----------|------------------------------------|------------------------------------------------|
| Distance | km from rider to restaurant        | `1 − (distance / maxDistance)` among candidates |
| Rating   | rider rating, 1–5                  | `rating / 5`                                   |
| Load     | deliveries in the last 60 min      | `1 − (recentLoad / maxLoad)` among candidates  |
 
**Why normalize.** You cannot add kilometers to a 1–5 rating directly — different
units, different scales. Each factor is squashed to 0–1 first, then weighted.
 
**Distance** uses the **Haversine** (great-circle) formula. This is a straight-line
approximation; production dispatch would use road distance and live traffic. The
closest candidate scores 1.0, the farthest scores 0.0.
 
**Load is defined as *recent* workload, not current active orders.** With one order
per rider at a time and only IDLE riders scored, "current active orders" is always 0
for every candidate — another dead weight. Instead, load counts deliveries completed
in a rolling 60-minute window, turning it into a **fatigue / fairness** signal: a
rider who has just done several deliveries is gently deprioritized, so work spreads
across the fleet instead of piling onto a few riders.
 
---
 
## 4. Step 3 — Weighted final score
 
```
Final Score = (w_distance × DistanceScore)
            + (w_rating   × RatingScore)
            + (w_load     × LoadScore)
```
 
The rider with the highest final score is selected.
 
**Weights are runtime-configurable, not hardcoded.** The admin can adjust them
(e.g. via sliders or the API). Whatever values are supplied are **normalized to sum
to 1** before scoring, so any combination stays valid and the final score remains in
the 0–1 range. Default weights:
 
| Factor   | Default weight |
|----------|----------------|
| Distance | 0.45           |
| Rating   | 0.30           |
| Load     | 0.25           |
 
---
 
## 5. Worked example
 
An order comes in. Two eligible riders:
 
| Rider | Distance | Rating | Recent load |
|-------|----------|--------|-------------|
| A     | 1.0 km   | 4.8    | 3 deliveries |
| B     | 2.5 km   | 4.2    | 0 deliveries |
 
Normalize (maxDistance = 2.5, maxLoad = 3):
 
| Rider | DistanceScore        | RatingScore | LoadScore       |
|-------|----------------------|-------------|-----------------|
| A     | 1 − 1.0/2.5 = **0.60** | 4.8/5 = **0.96** | 1 − 3/3 = **0.00** |
| B     | 1 − 2.5/2.5 = **0.00** | 4.2/5 = **0.84** | 1 − 0/3 = **1.00** |
 
**With default weights (0.45 / 0.30 / 0.25):**
 
```
A = 0.45×0.60 + 0.30×0.96 + 0.25×0.00 = 0.558   ← winner
B = 0.45×0.00 + 0.30×0.84 + 0.25×1.00 = 0.502
```
 
Rider A wins — proximity dominates under the default weights.
 
**Now the admin shifts weights to favor fairness (0.20 / 0.30 / 0.50):**
 
```
A = 0.20×0.60 + 0.30×0.96 + 0.50×0.00 = 0.408
B = 0.20×0.00 + 0.30×0.84 + 0.50×1.00 = 0.752   ← winner
```
 
The result **flips to Rider B** — the same data, a different strategy. This is what
the configurable weights make tangible: the speed-vs-fairness tradeoff is a dial.
 
---
 
## 6. Edge cases & tie-breaking
 
- **No eligible riders** → order stays `PENDING` in the FIFO queue, retried next tick.
- **Single candidate** → `maxDistance` / `maxLoad` may be 0; those scores default to
  1.0, and the lone candidate is selected.
- **All candidates identical** → scores tie; the first in iteration order wins
  (deterministic given a stable query order).
- **All-zero weights supplied** → the engine falls back to the default weights rather
  than producing a meaningless all-zero score.
---
 
## 7. Step 4 — AI explanation (decision stays deterministic)
 
After the winner is chosen, the engine produces a plain-language reason, e.g.:
 
> *"Rahul was selected: ~1.2 km away (closest available), rated 4.8/5, no recent deliveries."*
 
A deterministic template generates this from the score breakdown, so it always
works. An AI model (Gemini *(enhancement)*) can optionally rewrite it more naturally, but
**the AI never selects the rider** — if the AI call fails, the template reason is
used and the assignment is unaffected. This keeps the system predictable, debuggable,
and fully reproducible.
 
---
-->
