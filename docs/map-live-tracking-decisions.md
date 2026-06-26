# Live Map Tracking Decisions

This document records agreed decisions for the live map feature. It reflects the current implementation (Mapbox GL JS, SimulationContext, socket.io) not the original Mappls draft.

---

## Map Provider

**Mapbox GL JS** via `react-map-gl@7` + `mapbox-gl@2`.

Token lives in `frontend/.env` as `VITE_MAPBOX_ACCESS_TOKEN`. Never committed. The token is a public key (starts with `pk.`) — restrict it to your deployment domain in the Mapbox dashboard once deployed.

Map style: `mapbox://styles/mapbox/dark-v11` (ops dashboard aesthetic).

---

## Frontend Architecture

```
frontend/src/
├── context/
│   └── SimulationContext.jsx     socket.io connection, exposes { connected, riders,
│                                 queueDepth, allocations }
├── pages/
│   ├── Dashboard.jsx             stat cards + mini map (zoom 12, 240px) + allocation feed
│   ├── RiderMap.jsx              full fleet map (zoom 13, 420px)
│   └── OrderMap.jsx              single-order tracking (stub — Phase 2 work)
```

No `features/map/` folder. No Mappls SDK loader. Map components are standard JSX that import `react-map-gl` directly.

---

## WebSocket Events

All real-time data flows through a single socket.io connection managed by `SimulationContext`.

| Event | Direction | Payload |
|-------|-----------|---------|
| `simulation:tick` | server → client | `{ riders: [{_id, lat, lng, status, availabilityStatus, currentOrderId}], queueDepth }` |
| `order:assigned` | server → client | `{ orderId, riderId, score, breakdown, ts }` |
| `order:delivered` | server → client | `{ orderId, riderId, ts }` |
| `order:status` | server → client | `{ orderId, status }` (PICKED_UP transition) |

Old event names from the previous draft (`rider_location_updated`, `order_status_updated`, `map_state_updated`) are not used.

---

## Map Rendering Approach

Riders are rendered as a single GeoJSON `Source` + `circle` `Layer` (WebGL). This means:

- **Zero Mapbox API calls per tick** — GeoJSON updates are client-side only
- No marker instances to manage or animate individually
- Works correctly for 20–50 riders at 1 fps with no performance concerns
- Status colors are driven by Mapbox data expressions, not per-marker JS

```js
'circle-color': ['match', ['get', 'status'],
  'IDLE',      '#0070f3',
  'ACCEPTED',  '#f5a623',
  'PICKED_UP', '#7928ca',
  '#a1a1a1'   // OFFLINE
]
```

**Note on marker animation:** In Phase 1 (straight-line), the tick fires every 1 second and rider position jumps to the interpolated coordinate. This is visually smooth enough at 1fps for a demo. In Phase 2+ (polyline), rider positions will be smoother because the backend walks more granular road coords. Client-side tweening is not needed and not implemented.

---

## Route Line Rendering

**Phase 1:** No route line drawn. Rider position updates are sufficient to communicate movement on the circle layer.

**Phase 2:** When an order is assigned, the `order:assigned` payload will include `leg1Coords` and `leg2Coords` arrays. The map draws a `line` Layer over a `Source` containing these coords. The route line updates from leg1 → leg2 on `order:status { status: 'PICKED_UP' }`.

**Phase 3:** Route line segments are colored by congestion (green → yellow → red) using a `line-color` expression against a `congestion` property per segment.

---

## Reconnect Behavior

socket.io handles reconnect automatically. `SimulationContext` sets `connected: false` on disconnect and `true` on reconnect. The simulation tick continues on the server — riders don't pause. On reconnect, the next `simulation:tick` event immediately restores the full rider array. No REST snapshot endpoint (`GET /api/map/state`) is needed.

If the socket misses events during a disconnect, the next tick delivers a full rider array (not a diff), so the map state is always consistent after one tick.

---

## Coordinate Snapping at Leg Boundaries

When a rider completes a leg, the backend sets rider coordinates **exactly** to the destination:

- Leg 1 complete → rider coordinates = restaurant lat/lng (exact, no float drift)
- Leg 2 complete → rider coordinates = customer lat/lng (exact)

This avoids tiny positional drift at status transitions and makes the color change (orange → purple on PICKED_UP) visually crisp.

---

## Rider & Order Statuses

**Rider statuses** on the map:

| Status | Color | Meaning |
|--------|-------|---------|
| IDLE | `#0070f3` blue | No active order |
| ACCEPTED | `#f5a623` orange | Moving toward restaurant |
| PICKED_UP | `#7928ca` purple | Moving toward customer |
| OFFLINE | `#a1a1a1` gray at 35% opacity | Unavailable |

**Order statuses** (used in allocation history and order tracking):

| Status | Meaning |
|--------|---------|
| PENDING | Created, not yet assigned |
| ASSIGNED | Rider accepted, moving to restaurant |
| PICKED_UP | Food collected, moving to customer |
| DELIVERED | Completed |

---

## API Endpoints Relevant to Map

| Endpoint | Purpose |
|----------|---------|
| `POST /api/allocation/allocate` | Manually trigger allocation for a PENDING order |
| `GET /api/allocation/history` | Paginated allocation history |
| `GET /api/config/weights` | Current ETAR/Rating/Load weights |
| `PUT /api/config/weights` | Update weights (normalized server-side) |
| `POST /api/simulation/start` | Start tick loop (B9) |
| `POST /api/simulation/stop` | Stop tick loop (B9) |

The old `/api/allocate-order` and `/api/simulation/tick` (manual tick) routes are replaced.

---

## Geocoding

Not needed. All entities store coordinates directly:

- `Rider.latitude`, `Rider.longitude`
- `Restaurant.latitude`, `Restaurant.longitude`
- `Customer.latitude`, `Customer.longitude`
- `Order.restaurantLat`, `Order.restaurantLng`, `Order.customerLat`, `Order.customerLng`

Address strings are display-only.

---

## Cost Summary

| Operation | Cost |
|-----------|------|
| Map tile loads | Free up to 50,000 loads/month |
| GeoJSON rider updates (per tick) | Zero |
| Phase 2 Directions call | 1 per order allocation |
| Phase 3 traffic re-poll | 1 per active order per 3 minutes |

With 100 orders/day and 5 concurrent active orders, Phase 3 totals ~75,000 API calls/month — within the 100,000/month free tier.

---

## What Still Needs Building

| Item | Phase | Status |
|------|-------|--------|
| `simulationEngine.js` tick loop + hydration | B8 | Not started |
| socket.io server wiring in `server.js` | B9 | Not started |
| `simulation.js` route (start/stop) | B9 | Not started |
| `OrderMap.jsx` single-order tracking | Phase 2 | Stub only |
| Route line rendering (leg1/leg2 polyline) | Phase 2 | Not started |
| Traffic congestion coloring | Phase 3 | Not started |
