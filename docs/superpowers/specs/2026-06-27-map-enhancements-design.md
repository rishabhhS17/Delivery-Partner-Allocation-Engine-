# Map Enhancements Design

**Date:** 2026-06-27  
**Scope:** Rider Map visual overhaul + Order Map trail effect, active-leg routing, color scheme

---

## Goal

Make both map pages more readable for an ops dispatcher: cleaner Rider Map with richer rider context, and a smarter Order Map that shows only the remaining route ahead of each rider with destination-coded colors.

---

## Rider Map Changes

### Route lines removed
Route lines are deleted entirely. The Rider Map's job is fleet position — dispatchers read rider movement from dot motion, not static polylines. Removing lines reduces visual clutter significantly.

### Color scheme — Swiggy-inspired
| Status | Color | Hex |
|---|---|---|
| IDLE | White | `#ffffff` |
| ACCEPTED | Light orange | `#fb923c` |
| PICKED_UP | Deep orange | `#ea580c` |
| OFFLINE | Gray, 35% opacity | `#6b7280` |

Mapbox `match` expression on `status` property drives the color. OFFLINE opacity handled via `circle-opacity` match on `availabilityStatus`.

### Pulse animation on active riders
A second Mapbox circle layer (`riders-pulse`) sits below the main dot layer. Filtered to ACCEPTED + PICKED_UP riders via a `filter` expression. Its `circle-radius` is animated `10 → 20` and `circle-opacity` `0.6 → 0` via `requestAnimationFrame` + `map.setPaintProperty` on a ~1.4 s loop. The pulse starts when the map loads and runs continuously.

### Rider click popup
`onClick` handler on the riders layer reads `event.features[0].properties` (riderId, status, since timestamp). Looks up the full rider from `useSimulation().riders`. Renders a react-map-gl `<Popup>` at the click latlng with:
- Rider name
- Status badge (colored to match dot)
- Time in current state (computed: `Date.now() - since`)
- Active order ID, linked to `/map/orders/:id` (shown only if ACCEPTED/PICKED_UP)

Popup closes on any map click outside it.

### Live stats overlay
Absolutely-positioned div inside the map container, top-right corner, `z-index: 10`. Four counters derived reactively from `useSimulation().riders` and `queueDepth`:
- **Idle** — count of `status === 'IDLE'`  
- **Active** — count of `ACCEPTED` + `PICKED_UP`
- **Offline** — count of `availabilityStatus === 'OFFLINE'`
- **Queued Orders** — `queueDepth` from SimulationContext (pending orders without a rider)

"Queued Orders" is explicitly labeled differently from rider counts to avoid confusion — it counts orders, not riders.

### Cluster markers at low zoom
`<Source cluster={true} clusterMaxZoom={14} clusterRadius={50}>` on the riders GeoJSON source. Two extra layers added:
- `clusters` — circle layer, radius scales with `point_count` (Mapbox built-in expressions)
- `cluster-count` — symbol layer showing the number

Individual rider dots only render at zoom ≥ 14. Clicking a cluster zooms the map in to expand it.

---

## Order Map Changes

### Active leg only
The current implementation concatenates `leg1Coords + leg2Coords` into one line. This changes to a per-status conditional:
- `ACCEPTED` → render `leg1Coords` only (rider heading to restaurant)
- `PICKED_UP` → render `leg2Coords` only (rider heading to customer)

Two separate GeoJSON sources (`leg1-routes`, `leg2-routes`) with separate layers lets each use its own color.

### Hard cut trail
As a rider moves, only the **remaining path ahead** is drawn. The coordinate array is sliced from `legStepIndex` forward:

```
ACCEPTED:  remainingCoords = leg1Coords.slice(legStepIndex)
PICKED_UP: remainingCoords = leg2Coords.slice(legStepIndex)
```

The path behind the rider disappears — no ghost trail, no faded history.

### Backend change — legStepIndex in tick payload
`simulationEngine.js` adds two fields to each rider entry in `simulation:tick`:
```js
{
  _id, lat, lng, status, orderId,
  legStepIndex,   // current step index in the active leg's coord array
  leg,            // 'leg1' | 'leg2' | null
}
```

`SimulationContext` stores these alongside existing position/status data.

### Destination color scheme
Route line color communicates where the line is going, not where the rider came from:

| Leg | Line color | Matches |
|---|---|---|
| Leg 1 (→ restaurant) | `#22c55e` green | Restaurant pin color |
| Leg 2 (→ customer) | `#06b6d4` cyan | Customer pin color |

### `nextOrderId` orders — no map impact
If a rider has a queued second order (`nextOrderId`), that order retains its own `status` (PENDING). The Order Map filters on the order's `status` field — PENDING orders always render as gray dots at the restaurant, never as routes. No special handling needed. Opening `/map/orders/:id` for a `nextOrderId` order shows it as PENDING (gray dot, no route, no rider).

### Pin colors unchanged
| Element | Color |
|---|---|
| Restaurant pins | `#22c55e` green |
| Customer drop pins | `#06b6d4` cyan |
| Pending order dots | `#888888` gray |
| Rider dots | Swiggy scheme (same as Rider Map) |

---

## Files to Change

| File | Change |
|---|---|
| `frontend/src/pages/RiderMap.jsx` | Remove route layer, new colors, pulse layer, popup, stats overlay, cluster source |
| `frontend/src/pages/RiderMap.module.css` | Stats overlay positioning |
| `frontend/src/pages/OrdersMap.jsx` | Split into leg1/leg2 sources, slice coords by legStepIndex, new colors |
| `frontend/src/context/SimulationContext.jsx` | Store legStepIndex + leg per rider |
| `backend/src/services/simulationEngine.js` | Emit legStepIndex + leg in tick payload |
