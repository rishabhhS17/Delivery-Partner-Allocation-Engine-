
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
- `h3.latLngToCell(rider.lat, rider.lng, 7)` is contained in `candidateZone`
- `availabilityStatus === 'ONLINE'`

> **Key change from v1:** Riders with status `ACCEPTED` or `PICKED_UP` are now
> included — not just `IDLE`. A rider finishing a nearby delivery is a real
> candidate. Their availability is handled by ETAR (they have a non-zero
> time-to-free).

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

> **H3 cell indices are computed on the fly from existing lat/lng fields.** No
> schema changes are needed — riders and restaurants already store coordinates.

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
| `IDLE` | 0 |
| `PICKED_UP` (delivering to customer) | `(1 - order.progress) × AVG_LEG_DURATION` |
| `ACCEPTED` (heading to pick up) | `(1 - order.progress) × AVG_LEG_DURATION × 2` |

`AVG_LEG_DURATION` is the average time for one leg of a delivery (configurable,
default 120 seconds based on the simulation tick rate).

Why the ×2 multiplier for `ACCEPTED`? A rider who has just picked up the assignment
still has two legs left — reaching the restaurant and then delivering to the
customer. Multiplying by 2 is a first-order approximation. A rider at 50% of leg 1
has approximately one full leg remaining on their current delivery.

### travel_time_to_restaurant

```
distance_km = haversine(rider.lat, rider.lng, restaurant.lat, restaurant.lng)
travel_time = distance_km / AVG_SPEED_KM_PER_SEC
```

`AVG_SPEED_KM_PER_SEC` is configurable (default ~0.005 km/s = 18 km/h, a
realistic urban two-wheeler speed).

### Result

Every geo-candidate gets an ETAR in seconds. An idle rider 0.5 km away might
have ETAR = 100s. A busy rider 100m away who is 90% done with delivery might
have ETAR = 24 + 20 = 44s — and wins.

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

---

## 5. Worked Example

An order comes in at Restaurant R. The k=2 ring around R contains two ONLINE
riders:

| Rider | Status | Progress | Dist to R | ETAR |
|-------|--------|----------|-----------|------|
| A | IDLE | — | 2.0 km | 0 + 400s = **400s** |
| B | PICKED_UP | 0.85 | 0.3 km | (0.15 × 120) + 60s = **78s** |

Rider B is still on a delivery, but only 15% of a leg left and just 300m from R.

Normalize (maxETAR = 400):

| Rider | ETARScore | RatingScore (A=4.8, B=4.2) | LoadScore (A=0, B=1 recent) |
|-------|-----------|-----------------------------|-----------------------------|
| A | 1 − 400/400 = **0.00** | 4.8/5 = **0.96** | 1 − 0/1 = **1.00** |
| B | 1 − 78/400 = **0.805** | 4.2/5 = **0.84** | 1 − 1/1 = **0.00** |

**With default weights (0.50 / 0.30 / 0.20):**

```
A = 0.50×0.00 + 0.30×0.96 + 0.20×1.00 = 0.488
B = 0.50×0.805 + 0.30×0.84 + 0.20×0.00 = 0.655   ← winner
```

Rider B wins — even though busy, they will arrive at the restaurant far sooner.
Under the old v1 system, Rider A (idle, farther away) would have won because
IDLE was the hard filter. This is the core improvement.

---

## 6. Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| No ONLINE riders in k=2 ring | Order stays `PENDING` in FIFO queue, retried next tick |
| Single candidate | maxETAR = that candidate's ETAR; ETARScore = 1.0 |
| All candidates tie | First in iteration order wins (stable query order) |
| All-zero weights supplied | Engine falls back to default weights |
| No valid restaurant-customer pair in service area | Order generator retries with a different restaurant (max 10 attempts) |

---

## 7. Step 5 — AI Explanation (decision stays deterministic)

After the winner is chosen, a plain-language reason is generated, e.g.:

> *"Rider B was selected: will arrive at the restaurant in ~78 seconds — faster
> than all other candidates despite currently completing a delivery. Rated 4.2/5."*

A deterministic template always generates this from the score breakdown. An AI
model (OpenAI / Gemini) can optionally rewrite it more naturally. The AI never
selects the rider — if the AI call fails, the template reason is used and the
assignment is unaffected.

---

## 8. Configuration Reference

| Parameter | Default | Description |
|-----------|---------|-------------|
| `H3_RESOLUTION` | 7 | Hexagon zoom level |
| `CANDIDATE_RING_SIZE` | 2 | k-ring around restaurant for rider pool |
| `SERVICE_AREA_RING_SIZE` | 5 | k-ring for customer-restaurant pairing |
| `AVG_LEG_DURATION` | 120s | Estimated seconds per delivery leg |
| `AVG_SPEED_KM_PER_SEC` | 0.005 | ~18 km/h for ETAR travel time |
| `w_etar` | 0.50 | Weight for ETAR score |
| `w_rating` | 0.30 | Weight for rating score |
| `w_load` | 0.20 | Weight for load score |
| `LOAD_WINDOW_MINUTES` | 60 | Rolling window for recent-load counting |

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
works. An AI model (OpenAI / Gemini) can optionally rewrite it more naturally, but
**the AI never selects the rider** — if the AI call fails, the template reason is
used and the assignment is unaffected. This keeps the system predictable, debuggable,
and fully reproducible.
 
---
-->
