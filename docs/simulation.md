
# Simulation Engine — Architecture & Phased Roadmap

This document is the authoritative reference for the simulation engine design. It covers the in-memory data model, the tick loop, and the three movement phases. Each phase is additive — later phases only modify `simulationEngine.js` and `routingService.js`. Everything else stays identical.

---

## Actual Backend File Structure

```
backend/src/
├── config/
│   └── constants.js          RIDER_SPEED_KMH, H3_RESOLUTION, H3_CANDIDATE_K,
│                             LOAD_WINDOW_MINUTES, AUTO_ORDER_INTERVAL_MS, TICK_INTERVAL_MS
├── models/
│   ├── Rider.js              latitude, longitude, h3Index, status, availabilityStatus,
│   │                         currentOrderId, nextOrderId, rating, deliveryTimestamps
│   └── Order.js              restaurantLat/Lng, customerLat/Lng, status, legStartedAt,
│                             leg1Duration_s, leg2Duration_s,
│                             leg1Coords [[lng,lat]...], leg2Coords [[lng,lat]...]
│                             (leg1Coords/leg2Coords are empty in Phase 1, filled in Phase 2+)
├── services/
│   ├── allocationEngine.js   PURE FUNCTION — takes (order, candidates[], weights), returns winner
│   │                         No DB I/O. Contains diskCache (Map<h3Cell → 19 cells>).
│   ├── simulationEngine.js   Tick loop + in-memory state (see below)
│   ├── orderGenerator.js     startAutoOrderJob() / stopAutoOrderJob() — B7
│   └── routingService.js     getRoute(from, to[], profile) → {leg1Coords, leg2Coords,
│                             leg1Duration_s, leg2Duration_s}  (Phase 2+, created then)
├── routes/
│   ├── index.js              mounts all route files
│   ├── allocation.js         POST /allocation/allocate, GET /allocation/history
│   ├── config.js             GET/PUT /config/weights
│   └── simulation.js         POST /simulation/start, POST /simulation/stop (B9)
└── server.js                 Express + socket.io + MongoDB + initSimulation()
```

---

## In-Memory State (simulationEngine.js module level)

```js
// Rider positions and status — source of truth between DB writes
const riderState = new Map();
// riderId → { lat, lng, status, availabilityStatus, currentOrderId, nextOrderId }

// H3 geo-index — rebuilt from riderState, updated when riders move cells
const h3Buckets = new Map();
// h3Cell → Set<riderId>

// Orders waiting for a rider
const pendingQueue = [];
// Order documents (PENDING status)
```

These three Maps are the only in-memory state. No separate `activeTripsStore.js` file is needed.

---

## Hydration on Server Restart

`initSimulation()` is called once on server boot. It re-hydrates all three Maps from MongoDB so the simulation resumes exactly where it left off:

```
initSimulation():
  1. Rider.find({}) → build riderState Map + h3Buckets Map
  2. Order.find({ status: 'PENDING' }) → fill pendingQueue
  3. For ACCEPTED/PICKED_UP riders: their currentOrderId has legStartedAt + leg1/2Duration_s
     stored in DB — the tick loop uses these to recompute progress on the first tick
  4. Start setInterval(tick, TICK_INTERVAL_MS)
```

DB writes only happen on **state transitions** (IDLE→ACCEPTED, ACCEPTED→PICKED_UP, PICKED_UP→IDLE), not every tick. This keeps write volume at ~3 writes per delivery regardless of tick rate.

---

## Tick Loop (every TICK_INTERVAL_MS = 1000ms)

```
tick():
  1. For each ACCEPTED/PICKED_UP rider in riderState:
     a. Compute progress = (now - legStartedAt) / leg_duration_s
     b. If progress >= 1: leg complete → handle transition (see below)
     c. Else: interpolate new lat/lng (Phase 1: lerp; Phase 2+: walk polyline)
     d. Update riderState lat/lng
     e. If rider crossed an H3 cell boundary: update h3Buckets

  2. Leg-complete transitions:
     - ACCEPTED → restaurant reached:
         rider.status = PICKED_UP
         order.status = PICKED_UP
         order.legStartedAt = now
         Rider.lat/lng = restaurant lat/lng (exact snap)
         Write Rider + Order to DB
         emit order:status { orderId, status: 'PICKED_UP' }
     - PICKED_UP → customer reached:
         order.status = DELIVERED
         rider.status = IDLE
         rider.currentOrderId = null
         If rider.nextOrderId: immediately start that order (ACCEPTED)
         Rider.lat/lng = customer lat/lng (exact snap)
         Write Rider + Order to DB
         emit order:delivered { orderId, riderId }
         rider.deliveryTimestamps.push(now) — write to DB

  3. Drain pendingQueue:
     For each PENDING order, call getCandidateCells() → query h3Buckets for ONLINE/IDLE riders
     → allocateOrder() → if winner found:
         Assign order (write DB), move to riderState as ACCEPTED
         Remove from pendingQueue
         emit order:assigned { orderId, riderId, score, breakdown }

  4. Emit simulation:tick { riders: [...riderState values], queueDepth: pendingQueue.length }
```

---

# Phase 1 — Straight-Line Lerp (Current)

Movement math inside the tick loop:

```
lat = lerp(startLat, endLat, progress)
lng = lerp(startLng, endLng, progress)
```

Where:
- `startLat/Lng` = leg start coordinates (stored in Order or rider position at ACCEPTED time)
- `endLat/Lng` = restaurant coords (leg 1) or customer coords (leg 2)
- `progress` = elapsed_ms / (leg_duration_s * 1000)
- `leg_duration_s` = haversine_distance_km / RIDER_SPEED_KMH * 3600

**No Mapbox API calls. Zero external cost.**

Transition note: `leg1Coords` and `leg2Coords` on Order are empty arrays in Phase 1. The tick loop checks: if coords array is empty → use lerp fallback. This fallback remains in Phase 2+ as a safety net.

---

# Phase 2 — Road-Snapped Movement

### What changes

1. **`routingService.js`** (new file, `backend/src/services/`)
   - `getRoute(riderCoords, restaurantCoords, customerCoords)` — ONE Directions API call with 3 waypoints
   - Profile: `mapbox/driving`
   - Response: two legs → split into `leg1Coords [[lng,lat]...]` and `leg2Coords [[lng,lat]...]`
   - Also extracts `leg1Duration_s` and `leg2Duration_s` from Mapbox's `duration` field (replaces Haversine estimate)

2. **`allocation.js` route handler** (modify `POST /allocation/allocate`)
   - After winner selected: call `getRoute()` asynchronously
   - Write `leg1Coords`, `leg2Coords`, `leg1Duration_s`, `leg2Duration_s` to Order in MongoDB
   - These fields persist across server restarts — no re-querying needed on boot

3. **`simulationEngine.js` tick** (modify movement math)
   - Replace lerp with polyline traversal:
     - Maintain `currentSegmentIdx` and `distanceOnSegment` per active trip (in riderState)
     - Budget per tick: `RIDER_SPEED_KMH / 3.6 * (TICK_INTERVAL_MS / 1000)` meters
     - Carry-over logic: if next node is closer than budget, consume it, carry remainder to next segment
   - Lerp fallback remains for any order with empty coords (backward compatibility)

### Cost model

One Directions API call per order allocation. At 100 orders/day: ~3,000 calls/month. Mapbox free tier: 100,000/month. Well within limits.

Polylines are stored in MongoDB → zero re-querying on server restart.

---

# Phase 3 — Traffic-Aware Movement

### What changes (only two files)

1. **`routingService.js`**
   - Change profile: `mapbox/driving` → `mapbox/driving-traffic`
   - Add query param: `annotations=speed,congestion`
   - Each leg now returns a `segmentSpeeds: [m/s per segment]` array alongside coords
   - Store `segmentSpeeds` in riderState (RAM only — recalculated on re-poll)

2. **`simulationEngine.js`**
   - Dynamic budget per tick: `segmentSpeeds[currentSegmentIdx] * (TICK_INTERVAL_MS / 1000)` meters
   - Fallback: if speed is 0 (gridlock), use minimum 3 m/s (~10 km/h) so riders never freeze
   - Add traffic re-poll job (runs alongside tick loop, every 3 minutes):
     - For all orders currently ACCEPTED or PICKED_UP: call `getRoute()` again
     - Update `leg1Coords`/`leg2Coords` and `leg1Duration_s`/`leg2Duration_s` in DB + riderState
     - This reflects real-world traffic changes mid-delivery

### Cost model (re-poll job)

With 5 active orders at any time, polling every 3 min:
`5 orders × (60/3) polls/hour × 24h × 30 days = 72,000 calls/month`

Still within the 100,000/month free tier. If order volume grows, increase poll interval to 5 min.

### Frontend (Phase 3 upgrade)

The `simulation:tick` payload doesn't change — riders still send `lat/lng`. The only frontend change is route line coloring:

- Receive `congestion` metadata per segment (via a new `order:routeUpdate` event or initial `order:assigned` payload)
- Use Mapbox `line-color` data expression to color route segments: green → yellow → red based on congestion level
- Rider marker slows down naturally as backend applies lower speed budget on congested segments

---

## Transition Summary

| File | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|
| `simulationEngine.js` | lerp math | polyline walk | dynamic speed budget + re-poll job |
| `routingService.js` | does not exist | getRoute() with driving | switch to driving-traffic + annotations |
| `Order.js` | leg1/2Coords empty | filled from Directions | same, plus segmentSpeeds in RAM |
| `allocationEngine.js` | unchanged | unchanged | unchanged |
| `allocation.js` (route) | no route call | calls getRoute() | unchanged |
| Frontend | GeoJSON circles | GeoJSON circles + route line | + congestion coloring |
| Mapbox API calls | 0 | 1 per order | 1 per order + 1 per active order per 3 min |
