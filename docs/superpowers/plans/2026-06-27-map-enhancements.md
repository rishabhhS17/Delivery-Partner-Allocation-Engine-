# Map Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul Rider Map (remove routes, Swiggy colors, pulse, popup, stats, clusters) and Order Map (active leg only, hard-cut trail, destination colors).

**Architecture:** Backend emits `legStepIndex` + `leg` + `availabilityStatus` in each simulation tick rider entry. Frontend RiderMap gets visual overhaul with five new features. OrdersMap splits into two GeoJSON sources (leg1/leg2) and slices coords by `legStepIndex` for the hard-cut trail effect.

**Tech Stack:** React, react-map-gl, Mapbox GL JS, Socket.IO, Node.js

---

## File Map

| File | Change |
|---|---|
| `backend/src/services/simulationEngine.js` | Add `legStepIndex`, `leg`, `availabilityStatus` to tick rider payload |
| `frontend/src/pages/RiderMap.jsx` | Full overhaul — colors, pulse, popup, stats overlay, clusters |
| `frontend/src/pages/RiderMap.module.css` | Add stats overlay + popup styles |
| `frontend/src/pages/OrdersMap.jsx` | Active leg only, hard-cut trail, destination colors |

SimulationContext needs no changes — `setRiders(data.riders ?? [])` passes all fields through automatically.

---

## Task 1: Backend — emit legStepIndex, leg, availabilityStatus in tick

**Files:**
- Modify: `backend/src/services/simulationEngine.js:223-231`

- [ ] **Step 1: Update tickRiders.push() in the tick() function**

Find this block (around line 223):
```js
tickRiders.push({
  _id:     riderId,
  name:    rider.name,
  lat:     rider.lat,
  lng:     rider.lng,
  status:  rider.status,
  orderId: rider.currentOrderId ? rider.currentOrderId.toString() : null,
});
```

Replace with:
```js
tickRiders.push({
  _id:                riderId,
  name:               rider.name,
  lat:                rider.lat,
  lng:                rider.lng,
  status:             rider.status,
  availabilityStatus: rider.availabilityStatus ?? 'ONLINE',
  orderId:            rider.currentOrderId ? rider.currentOrderId.toString() : null,
  legStepIndex:       rider.currentSegmentIdx ?? 0,
  leg:                rider.status === 'ACCEPTED' ? 'leg1'
                    : rider.status === 'PICKED_UP' ? 'leg2'
                    : null,
});
```

- [ ] **Step 2: Verify backend still starts**

```bash
cd backend && node src/index.js
```
Expected: server starts on port 5000 with no errors. Kill with Ctrl+C.

---

## Task 2: Rider Map — new colors + remove route layer

**Files:**
- Modify: `frontend/src/pages/RiderMap.jsx`

- [ ] **Step 1: Remove route imports and state**

Remove `routes` from the `useSimulation()` destructure (line ~60):
```js
// BEFORE
const { riders, connected, queueDepth, routes } = useSimulation();

// AFTER
const { riders, connected, queueDepth } = useSimulation();
```

- [ ] **Step 2: Delete the routeLineLayer constant**

Delete the entire `routeLineLayer` object (lines ~37-45):
```js
// DELETE THIS ENTIRE BLOCK:
const routeLineLayer = {
  id:   'routes',
  type: 'line',
  paint: {
    'line-color':   '#f5a623',
    'line-width':   2,
    'line-opacity': 0.65,
  },
};
```

- [ ] **Step 3: Delete routeGeojson useMemo**

Delete the entire `routeGeojson` useMemo (lines ~78-85):
```js
// DELETE THIS ENTIRE BLOCK:
const routeGeojson = useMemo(() => ({
  type: 'FeatureCollection',
  features: Array.from(routes.values()).map(({ leg1Coords, leg2Coords }) => ({
    type:     'Feature',
    geometry: { type: 'LineString', coordinates: [...leg1Coords, ...leg2Coords] },
    properties: {},
  })),
}), [routes]);
```

- [ ] **Step 4: Update circleLayer to Swiggy colors**

Replace the existing `circleLayer` constant with:
```js
const circleLayer = {
  id:   'unclustered-riders',
  type: 'circle',
  filter: ['!', ['has', 'point_count']],
  paint: {
    'circle-radius': 9,
    'circle-color': [
      'match', ['get', 'status'],
      'IDLE',      '#ffffff',
      'ACCEPTED',  '#fb923c',
      'PICKED_UP', '#ea580c',
      '#6b7280',
    ],
    'circle-stroke-color': '#1a1a1a',
    'circle-stroke-width': [
      'match', ['get', 'status'],
      'IDLE', 1.5,
      0.5,
    ],
    'circle-opacity': [
      'match', ['get', 'availabilityStatus'],
      'OFFLINE', 0.35,
      1,
    ],
  },
};
```

- [ ] **Step 5: Add pulse layer constant**

Add this after `circleLayer`:
```js
const pulseLayer = {
  id:     'riders-pulse',
  type:   'circle',
  filter: ['all',
    ['!', ['has', 'point_count']],
    ['match', ['get', 'status'], ['ACCEPTED', 'PICKED_UP'], true, false],
  ],
  paint: {
    'circle-radius':       10,
    'circle-color':        'transparent',
    'circle-stroke-color': [
      'match', ['get', 'status'],
      'ACCEPTED',  '#fb923c',
      'PICKED_UP', '#ea580c',
      '#fb923c',
    ],
    'circle-stroke-width': 2,
    'circle-opacity':      0.6,
  },
};
```

- [ ] **Step 6: Add cluster layer constants**

Add these after `pulseLayer`:
```js
const clusterCircleLayer = {
  id:     'clusters',
  type:   'circle',
  filter: ['has', 'point_count'],
  paint: {
    'circle-radius': ['step', ['get', 'point_count'], 18, 5, 24, 10, 30],
    'circle-color':  '#fb923c',
    'circle-stroke-color': '#1a1a1a',
    'circle-stroke-width': 1.5,
    'circle-opacity': 0.9,
  },
};

const clusterCountLayer = {
  id:     'cluster-count',
  type:   'symbol',
  filter: ['has', 'point_count'],
  layout: {
    'text-field':  ['get', 'point_count_abbreviated'],
    'text-size':   13,
    'text-font':   ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
  },
  paint: {
    'text-color': '#1a1a1a',
  },
};
```

- [ ] **Step 7: Update riderGeojson to include name and availabilityStatus**

Replace the riderGeojson useMemo:
```js
const riderGeojson = useMemo(() => ({
  type: 'FeatureCollection',
  features: riders.map((r) => ({
    type:       'Feature',
    geometry:   { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: {
      id:                 r._id,
      name:               r.name,
      status:             r.status,
      availabilityStatus: r.availabilityStatus ?? 'ONLINE',
      orderId:            r.orderId ?? null,
    },
  })),
}), [riders]);
```

- [ ] **Step 8: Remove route Source/Layer from JSX and add cluster Source**

In the return JSX, remove the routes Source block:
```jsx
{/* DELETE THIS */}
<Source id="routes" type="geojson" data={routeGeojson}>
  <Layer {...routeLineLayer} />
</Source>
```

Replace the riders Source with a clustered version containing all four layers:
```jsx
<Source
  id="riders"
  type="geojson"
  data={riderGeojson}
  cluster={true}
  clusterMaxZoom={14}
  clusterRadius={50}
>
  <Layer {...clusterCircleLayer} />
  <Layer {...clusterCountLayer} />
  <Layer {...pulseLayer} />
  <Layer {...circleLayer} />
</Source>
```

- [ ] **Step 9: Update legend to new colors**

Replace the legend array in `<MapPanel>`:
```jsx
legend={[
  { label: 'Idle',       color: 'riderIdle'    },
  { label: 'Accepted',   color: 'warning'      },
  { label: 'Picked up',  color: 'riderPickup'  },
  { label: 'Offline',    color: 'faint'        },
  { label: 'Restaurant', color: 'restaurant'   },
]}
```

Then add the two new dot colors to `frontend/src/components/common/MapPanel.module.css`:
```css
.legendDot[data-color='riderIdle']   { background-color: #ffffff; border: 1.5px solid #555; }
.legendDot[data-color='riderPickup'] { background-color: #ea580c; }
```

- [ ] **Step 10: Verify map loads with no console errors**

Start dev server (`npm run dev` at root), navigate to `/map/riders`, open browser console. Expected: green restaurant pins + colored rider dots visible, no route lines, no errors.

---

## Task 3: Rider Map — pulse animation

**Files:**
- Modify: `frontend/src/pages/RiderMap.jsx`

- [ ] **Step 1: Add useRef import and mapRef**

Add `useRef` to the React import line:
```js
import { useEffect, useState, useMemo, useRef } from 'react';
```

Add ref declarations at top of the component function body (after the existing state declarations):
```js
const mapRef = useRef(null);
const rafRef = useRef(null);
```

- [ ] **Step 2: Add pulse animation useEffect**

Add this useEffect after the existing `getRestaurants` useEffect:
```js
useEffect(() => {
  const map = mapRef.current?.getMap();
  if (!map) return;

  let rafId;
  const animate = (ts) => {
    const t = (ts % 1400) / 1400;
    const radius  = 10 + t * 16;
    const opacity = 0.65 * (1 - t);
    if (map.getLayer('riders-pulse')) {
      map.setPaintProperty('riders-pulse', 'circle-stroke-width', 2 + t * 2);
      map.setPaintProperty('riders-pulse', 'circle-radius',  radius);
      map.setPaintProperty('riders-pulse', 'circle-opacity', opacity);
    }
    rafId = requestAnimationFrame(animate);
  };

  const start = () => { rafId = requestAnimationFrame(animate); };

  if (map.isStyleLoaded()) {
    start();
  } else {
    map.once('load', start);
  }

  return () => { cancelAnimationFrame(rafId); };
}, []);
```

- [ ] **Step 3: Wire mapRef to the Map component**

Add `ref={mapRef}` to the `<Map>` JSX element:
```jsx
<Map
  ref={mapRef}
  mapboxAccessToken={MAPBOX_TOKEN}
  initialViewState={RANCHI_CENTER}
  mapStyle={MAP_STYLE}
>
```

- [ ] **Step 4: Verify pulse renders**

Navigate to `/map/riders` with simulation running. ACCEPTED/PICKED_UP riders should show an expanding ring. IDLE riders should not pulse. Open console — no errors.

---

## Task 4: Rider Map — click popup

**Files:**
- Modify: `frontend/src/pages/RiderMap.jsx`

- [ ] **Step 1: Add Popup import**

Add `Popup` to the react-map-gl import:
```js
import Map, { Source, Layer, Popup } from 'react-map-gl';
```

- [ ] **Step 2: Add popup state**

Add after existing state declarations:
```js
const [popup, setPopup] = useState(null); // { lng, lat, name, status, orderId }
```

- [ ] **Step 3: Add onClick handler**

Add this handler inside the component (after the animation useEffect):
```js
const handleMapClick = useCallback((e) => {
  const features = e.features ?? [];
  const riderFeature = features.find(
    (f) => f.layer.id === 'unclustered-riders'
  );
  const clusterFeature = features.find(
    (f) => f.layer.id === 'clusters'
  );

  if (clusterFeature) {
    const map = mapRef.current?.getMap();
    const source = map?.getSource('riders');
    source?.getClusterExpansionZoom(
      clusterFeature.properties.cluster_id,
      (err, zoom) => {
        if (err) return;
        map.easeTo({ center: clusterFeature.geometry.coordinates, zoom });
      }
    );
    setPopup(null);
    return;
  }

  if (riderFeature) {
    const { name, status, orderId } = riderFeature.properties;
    const [lng, lat] = riderFeature.geometry.coordinates;
    setPopup({ lng, lat, name, status, orderId });
    return;
  }

  setPopup(null);
}, []);
```

Add `useCallback` to the React import:
```js
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
```

- [ ] **Step 4: Wire onClick and interactiveLayerIds to Map**

Update the `<Map>` element:
```jsx
<Map
  ref={mapRef}
  mapboxAccessToken={MAPBOX_TOKEN}
  initialViewState={RANCHI_CENTER}
  mapStyle={MAP_STYLE}
  onClick={handleMapClick}
  interactiveLayerIds={['unclustered-riders', 'clusters']}
>
```

- [ ] **Step 5: Add Popup JSX inside Map**

Add inside `<Map>`, after the Sources:
```jsx
{popup && (
  <Popup
    longitude={popup.lng}
    latitude={popup.lat}
    anchor="bottom"
    onClose={() => setPopup(null)}
    closeOnClick={false}
  >
    <div className={styles.popup}>
      <div className={styles.popupName}>{popup.name}</div>
      <span className={`${styles.popupBadge} ${styles[`badge${popup.status}`]}`}>
        {popup.status}
      </span>
      {popup.orderId && (
        <div className={styles.popupOrder}>
          Order <a href={`/map/orders/${popup.orderId}`} className={styles.popupLink}>
            #{popup.orderId.slice(-8).toUpperCase()}
          </a>
        </div>
      )}
    </div>
  </Popup>
)}
```

- [ ] **Step 6: Add popup styles to RiderMap.module.css**

```css
.popup {
  padding: 4px 2px;
  min-width: 160px;
}

.popupName {
  font-weight: 600;
  font-size: 14px;
  color: #111;
  margin-bottom: 6px;
}

.popupBadge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 6px;
}

.badgeIDLE     { background-color: #555; color: #fff; }
.badgeACCEPTED { background-color: #fb923c; }
.badgePICKED_UP { background-color: #ea580c; }
.badgeOFFLINE  { background-color: #6b7280; }

.popupOrder {
  font-size: 12px;
  color: #555;
  margin-top: 4px;
}

.popupLink {
  color: #fb923c;
  text-decoration: none;
  font-weight: 500;
}
.popupLink:hover { text-decoration: underline; }
```

- [ ] **Step 7: Verify popup**

Click a rider dot — popup should appear with name, status badge, and order link (if active). Click elsewhere on map — popup should close. Click a cluster — map should zoom in.

---

## Task 5: Rider Map — live stats overlay

**Files:**
- Modify: `frontend/src/pages/RiderMap.jsx`
- Modify: `frontend/src/pages/RiderMap.module.css`

- [ ] **Step 1: Compute stats with useMemo**

Add after the existing `restaurantGeojson` useMemo:
```js
const stats = useMemo(() => {
  const idle    = riders.filter((r) => r.status === 'IDLE').length;
  const active  = riders.filter((r) => r.status === 'ACCEPTED' || r.status === 'PICKED_UP').length;
  const offline = riders.filter((r) => r.availabilityStatus === 'OFFLINE').length;
  return { idle, active, offline };
}, [riders]);
```

- [ ] **Step 2: Add stats overlay JSX**

Inside the `<div className={styles.mapWrap}>`, add the stats div as the first child (before `<Map>`):
```jsx
<div className={styles.statsOverlay}>
  <span className={styles.statItem}>
    <span className={`${styles.statValue} ${styles.statIdle}`}>{stats.idle}</span>
    <span className={styles.statLabel}>Idle</span>
  </span>
  <span className={styles.statDivider} />
  <span className={styles.statItem}>
    <span className={`${styles.statValue} ${styles.statActive}`}>{stats.active}</span>
    <span className={styles.statLabel}>Active</span>
  </span>
  <span className={styles.statDivider} />
  <span className={styles.statItem}>
    <span className={`${styles.statValue} ${styles.statOffline}`}>{stats.offline}</span>
    <span className={styles.statLabel}>Offline</span>
  </span>
  <span className={styles.statDivider} />
  <span className={styles.statItem}>
    <span className={`${styles.statValue} ${styles.statQueue}`}>{queueDepth}</span>
    <span className={styles.statLabel}>Queued Orders</span>
  </span>
</div>
```

- [ ] **Step 3: Add overlay styles to RiderMap.module.css**

```css
.statsOverlay {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0;
  background: rgba(15, 15, 15, 0.82);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px 14px;
}

.statItem {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 10px;
}

.statValue {
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
}

.statIdle    { color: #ffffff; }
.statActive  { color: #fb923c; }
.statOffline { color: #6b7280; }
.statQueue   { color: #e5e5e5; }

.statLabel {
  font-size: 10px;
  color: #777;
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.statDivider {
  width: 1px;
  height: 28px;
  background: rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
}
```

- [ ] **Step 4: Make mapWrap position:relative**

Update `.mapWrap` in `RiderMap.module.css`:
```css
.mapWrap {
  width: 100%;
  height: 420px;
  position: relative;
}
```

- [ ] **Step 5: Verify overlay**

Navigate to `/map/riders`. Stats panel should appear top-right on the map, showing live counts that update each tick.

---

## Task 6: Order Map — active leg, hard-cut trail, destination colors

**Files:**
- Modify: `frontend/src/pages/OrdersMap.jsx`

- [ ] **Step 1: Replace the single routeLineLayer with two leg-specific layer configs**

Delete:
```js
const routeLineLayer = {
  id:   'order-routes',
  type: 'line',
  paint: { 'line-color': '#f5a623', 'line-width': 2, 'line-opacity': 0.65 },
};
```

Add in its place:
```js
const leg1LineLayer = {
  id:   'leg1-routes',
  type: 'line',
  paint: { 'line-color': '#22c55e', 'line-width': 2.5, 'line-opacity': 0.8 },
};

const leg2LineLayer = {
  id:   'leg2-routes',
  type: 'line',
  paint: { 'line-color': '#06b6d4', 'line-width': 2.5, 'line-opacity': 0.8 },
};
```

- [ ] **Step 2: Add riderByOrder lookup useMemo**

Add this useMemo after the existing `activeOrders` useMemo:
```js
const riderByOrder = useMemo(() => {
  const map = new Map();
  for (const r of riders) {
    if (r.orderId) map.set(r.orderId, r);
  }
  return map;
}, [riders]);
```

- [ ] **Step 3: Replace routeGeojson with two separate leg GeoJSONs**

Delete the existing `routeGeojson` useMemo entirely.

Add in its place:
```js
const leg1Geojson = useMemo(() => {
  const features = [];
  for (const o of activeOrders) {
    if (o.status !== 'ACCEPTED') continue;
    const live    = routes.get(o._id?.toString());
    const full    = live?.leg1Coords ?? o.leg1Coords ?? [];
    const rider   = riderByOrder.get(o._id?.toString());
    const stepIdx = rider?.legStepIndex ?? 0;
    const coords  = full.slice(stepIdx);
    if (coords.length >= 2) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
    }
  }
  return { type: 'FeatureCollection', features };
}, [activeOrders, routes, riderByOrder]);

const leg2Geojson = useMemo(() => {
  const features = [];
  for (const o of activeOrders) {
    if (o.status !== 'PICKED_UP') continue;
    const live    = routes.get(o._id?.toString());
    const full    = live?.leg2Coords ?? o.leg2Coords ?? [];
    const rider   = riderByOrder.get(o._id?.toString());
    const stepIdx = rider?.legStepIndex ?? 0;
    const coords  = full.slice(stepIdx);
    if (coords.length >= 2) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
    }
  }
  return { type: 'FeatureCollection', features };
}, [activeOrders, routes, riderByOrder]);
```

- [ ] **Step 4: Update rider colors in riderCircleLayer to match Swiggy scheme**

Replace the existing `riderCircleLayer`:
```js
const riderCircleLayer = {
  id:   'riders',
  type: 'circle',
  paint: {
    'circle-radius': 9,
    'circle-color': [
      'match', ['get', 'status'],
      'IDLE',      '#ffffff',
      'ACCEPTED',  '#fb923c',
      'PICKED_UP', '#ea580c',
      '#6b7280',
    ],
    'circle-stroke-color': '#1a1a1a',
    'circle-stroke-width': 0.5,
    'circle-opacity': [
      'match', ['get', 'availabilityStatus'],
      'OFFLINE', 0.35,
      1,
    ],
  },
};
```

- [ ] **Step 5: Replace the single route Source/Layer with two in JSX**

Delete:
```jsx
<Source id="order-routes" type="geojson" data={routeGeojson}>
  <Layer {...routeLineLayer} />
</Source>
```

Add in its place (keep them at the bottom of the layer stack — before restaurants):
```jsx
<Source id="leg1-routes" type="geojson" data={leg1Geojson}>
  <Layer {...leg1LineLayer} />
</Source>
<Source id="leg2-routes" type="geojson" data={leg2Geojson}>
  <Layer {...leg2LineLayer} />
</Source>
```

- [ ] **Step 6: Update riderGeojson to include availabilityStatus**

Replace the existing `riderGeojson` useMemo:
```js
const riderGeojson = useMemo(() => ({
  type: 'FeatureCollection',
  features: riders.map((r) => ({
    type:     'Feature',
    geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: {
      status:             r.status,
      availabilityStatus: r.availabilityStatus ?? 'ONLINE',
    },
  })),
}), [riders]);
```

- [ ] **Step 7: Update OrdersMap legend to new rider colors**

Replace the legend array in `<MapPanel>`:
```jsx
legend={[
  { label: 'Idle rider',     color: 'riderIdle'    },
  { label: 'To restaurant',  color: 'warning'      },
  { label: 'Carrying order', color: 'riderPickup'  },
  { label: 'Pending order',  color: 'faint'        },
  { label: 'Restaurant',     color: 'restaurant'   },
  { label: 'Customer drop',  color: 'customer'     },
]}
```

`riderIdle` and `riderPickup` tokens are already defined in `MapPanel.module.css` from Task 2.

- [ ] **Step 8: Verify Order Map**

Navigate to `/map/orders` with simulation running. Expected:
- Green lines for ACCEPTED riders (→ restaurant)
- Cyan lines for PICKED_UP riders (→ customer)  
- Lines visibly shorter than the full route — only remaining path shown
- Lines shrink as riders move (hard cut advancing each tick)
- Rider dots use same Swiggy colors as Rider Map
- No console errors
