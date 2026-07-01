# Production Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all remaining open issues from the production readiness review: setWeights zero-division, Mapbox concurrency spike, stale-state on page unmount, disconnection UX, helmet CSP, and update the review doc.

**Architecture:** Backend fixes are isolated to `constants.js` and `routingService.js`. Frontend fixes apply the same unmount-guard pattern to 5 page components, add a global connection-status banner, and configure CSP on the Express layer. No new dependencies needed.

**Tech Stack:** Node.js (node:test for backend tests), React 18, axios, helmet, Socket.IO

---

## File Map

| File | Change |
|---|---|
| `backend/src/config/constants.js` | Guard `setWeights` against `total === 0` |
| `backend/src/tests/config.test.js` | Add test for zero-total case |
| `backend/src/services/routingService.js` | Add 3-slot concurrency limiter |
| `backend/src/app.js` | Enable helmet CSP directives |
| `frontend/src/pages/Orders.jsx` | Add unmount guard to `fetchOrders` |
| `frontend/src/pages/Riders.jsx` | Add unmount guard to `fetchRiders` |
| `frontend/src/pages/AllocationHistory.jsx` | Add unmount guard to `fetchHistory` |
| `frontend/src/pages/Restaurants.jsx` | Add unmount guard to `fetchRestaurants` |
| `frontend/src/pages/Customers.jsx` | Add unmount guard to `fetchCustomers` |
| `frontend/src/pages/Dashboard.jsx` | Add unmount guard + in-flight abort to polling loop |
| `frontend/src/components/common/ConnectionBanner.jsx` | New — shows warning strip when WS disconnected |
| `frontend/src/components/common/ConnectionBanner.module.css` | Styles for the banner |
| `frontend/src/App.jsx` (or layout root) | Mount `<ConnectionBanner />` |
| `docs/PRODUCTION_READINESS_REVIEW.md` | Mark H3 + newly fixed items as done, update scores |

---

## Task 1: Fix setWeights zero-total guard

**Files:**
- Modify: `backend/src/config/constants.js:27-34`
- Modify: `backend/src/tests/config.test.js`

- [ ] **Step 1: Add the failing test**

Open `backend/src/tests/config.test.js` and append:

```javascript
test('setWeights throws when all weights are zero', () => {
  assert.throws(
    () => setWeights({ etar: 0, rating: 0, load: 0 }),
    /weights must sum to a positive number/i
  );
});

test('setWeights does not accept negative total', () => {
  assert.throws(
    () => setWeights({ etar: -1, rating: -1, load: -1 }),
    /weights must sum to a positive number/i
  );
});
```

- [ ] **Step 2: Run the tests — expect FAIL**

```bash
cd backend && node --test src/tests/config.test.js
```

Expected: last two tests fail with `setWeights did not throw`.

- [ ] **Step 3: Add the guard in constants.js**

Replace the `setWeights` function in `backend/src/config/constants.js`:

```javascript
export function setWeights({ etar, rating, load }) {
  const total = etar + rating + load;
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Weights must sum to a positive number — got ' + total);
  }
  currentWeights = {
    etar:   etar   / total,
    rating: rating / total,
    load:   load   / total,
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && node --test src/tests/config.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/constants.js backend/src/tests/config.test.js
git commit -m "fix(config): throw on zero-total setWeights to prevent NaN allocation scores"
```

---

## Task 2: Add Mapbox concurrency limiter

**Files:**
- Modify: `backend/src/services/routingService.js`

The tick loop fires one `getRoute` per order allocation in a single tick. With 100 pending orders all getting allocated at once, that's 100 simultaneous Mapbox calls. A 3-slot concurrency limiter queues excess requests and drains them as slots free up. Orders already have haversine fallback so this is purely an accuracy improvement — queuing is safe.

- [ ] **Step 1: Replace routingService.js with a version that includes the limiter**

```javascript
import { config } from '../config/env.js';

const MAPBOX_BASE = 'https://api.mapbox.com/directions/v5/mapbox/driving';
const MAX_CONCURRENT = 3;

let _active = 0;
const _queue = [];

function _drain() {
  while (_active < MAX_CONCURRENT && _queue.length > 0) {
    const { resolve, reject, args } = _queue.shift();
    _active++;
    _callMapbox(...args)
      .then((result) => { _active--; _drain(); resolve(result); })
      .catch((err)   => { _active--; _drain(); reject(err); });
  }
}

async function _callMapbox(riderCoords, restaurantCoords, customerCoords) {
  if (!config.mapboxToken) throw new Error('MAPBOX_TOKEN not set in environment');

  const waypoints = [
    `${riderCoords.lng},${riderCoords.lat}`,
    `${restaurantCoords.lng},${restaurantCoords.lat}`,
    `${customerCoords.lng},${customerCoords.lat}`,
  ].join(';');

  const url = `${MAPBOX_BASE}/${waypoints}?geometries=geojson&steps=true&access_token=${config.mapboxToken}`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Mapbox Directions error: ${res.status}`);
    const data = await res.json();

    if (!data.routes?.length) throw new Error('No route returned from Mapbox');

    const [leg1, leg2] = data.routes[0].legs;

    return {
      leg1Coords:     _extractCoords(leg1),
      leg2Coords:     _extractCoords(leg2),
      leg1Duration_s: Math.round(leg1.duration),
      leg2Duration_s: Math.round(leg2.duration),
    };
  } catch (err) {
    console.warn('[routing] getRoute failed:', {
      rider:      riderCoords,
      restaurant: restaurantCoords,
      customer:   customerCoords,
      error:      controller.signal.aborted ? 'request timed out after 10s' : err.message,
    });
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function getRoute(riderCoords, restaurantCoords, customerCoords) {
  return new Promise((resolve, reject) => {
    _queue.push({ resolve, reject, args: [riderCoords, restaurantCoords, customerCoords] });
    _drain();
  });
}

function _extractCoords(leg) {
  const all = [];
  for (const step of leg.steps) all.push(...step.geometry.coordinates);
  return all.filter((c, i) => i === 0 || c[0] !== all[i - 1][0] || c[1] !== all[i - 1][1]);
}
```

- [ ] **Step 2: Verify server starts without errors**

```bash
cd backend && node src/server.js
```

Expected: server starts on port 5000 with no errors. Ctrl-C to stop.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/routingService.js
git commit -m "perf(routing): add 3-slot concurrency limiter to prevent Mapbox request spikes"
```

---

## Task 3: Add unmount guard to page fetch hooks

**Files:**
- Modify: `frontend/src/pages/Orders.jsx`
- Modify: `frontend/src/pages/Riders.jsx`
- Modify: `frontend/src/pages/AllocationHistory.jsx`
- Modify: `frontend/src/pages/Restaurants.jsx`
- Modify: `frontend/src/pages/Customers.jsx`
- Modify: `frontend/src/pages/Dashboard.jsx`

The pattern for single-fetch pages: set a `mounted` flag in the effect, only update state if still mounted. For Dashboard (polling every 10 s), also cancel the previous in-flight request before firing the next one.

### 3a — Orders.jsx

- [ ] **Step 1: Replace the fetchOrders useEffect in Orders.jsx**

Change:
```javascript
const fetchOrders = () => {
  setStatus('loading');
  getOrders()
    .then((res) => {
      setOrders(res.data ?? []);
      setStatus('ready');
    })
    .catch(() => setStatus('error'));
};

useEffect(fetchOrders, []);
```

To:
```javascript
const fetchOrders = () => {
  setStatus('loading');
  getOrders()
    .then((res) => {
      setOrders(res.data ?? []);
      setStatus('ready');
    })
    .catch(() => setStatus('error'));
};

useEffect(() => {
  let mounted = true;
  setStatus('loading');
  getOrders()
    .then((res) => { if (mounted) { setOrders(res.data ?? []); setStatus('ready'); } })
    .catch(() =>   { if (mounted) setStatus('error'); });
  return () => { mounted = false; };
}, []);
```

Keep the standalone `fetchOrders` function unchanged — it is used by the Retry button and post-create refresh and does not need the guard (it's always called while mounted).

### 3b — Riders.jsx

- [ ] **Step 2: Apply same pattern to Riders.jsx**

Find the `useEffect(fetchRiders, [])` call and replace with:

```javascript
useEffect(() => {
  let mounted = true;
  setStatus('loading');
  getRiders()
    .then((res) => { if (mounted) { setRiders(res.data ?? []); setStatus('ready'); } })
    .catch(() =>   { if (mounted) setStatus('error'); });
  return () => { mounted = false; };
}, []);
```

### 3c — AllocationHistory.jsx

- [ ] **Step 3: Apply same pattern to AllocationHistory.jsx**

Find `useEffect(fetchHistory, [])` and replace with:

```javascript
useEffect(() => {
  let mounted = true;
  setStatus('loading');
  getAllocationHistory({ limit: 50 })
    .then((res) => { if (mounted) { setRecords(res.data.records ?? []); setStatus('ready'); } })
    .catch(() =>   { if (mounted) setStatus('error'); });
  return () => { mounted = false; };
}, []);
```

### 3d — Restaurants.jsx

- [ ] **Step 4: Apply same pattern to Restaurants.jsx**

Find `useEffect(fetchRestaurants, [])` and replace with:

```javascript
useEffect(() => {
  let mounted = true;
  setStatus('loading');
  getRestaurants()
    .then((res) => { if (mounted) { setRestaurants(res.data ?? []); setStatus('ready'); } })
    .catch(() =>   { if (mounted) setStatus('error'); });
  return () => { mounted = false; };
}, []);
```

### 3e — Customers.jsx

- [ ] **Step 5: Apply same pattern to Customers.jsx**

Find the initial fetch `useEffect` and replace with:

```javascript
useEffect(() => {
  let mounted = true;
  setStatus('loading');
  getCustomers()
    .then((res) => { if (mounted) { setCustomers(res.data ?? []); setStatus('ready'); } })
    .catch(() =>   { if (mounted) setStatus('error'); });
  return () => { mounted = false; };
}, []);
```

### 3f — Dashboard.jsx (polling — needs AbortController)

- [ ] **Step 6: Upgrade Dashboard's polling loop**

Find the analytics `useEffect` in Dashboard.jsx (the one with `setInterval(load, 10_000)`) and replace with:

```javascript
useEffect(() => {
  let controller = new AbortController();

  const load = () => {
    controller.abort();                  // cancel any prior in-flight request
    controller = new AbortController();
    getAnalytics({ signal: controller.signal })
      .then((res) => { setAnalytics(res.data); setAnalyticsStatus('ready'); })
      .catch((err) => { if (err?.code !== 'ERR_CANCELED') setAnalyticsStatus('error'); });
  };

  load();
  const id = setInterval(load, 10_000);
  return () => { clearInterval(id); controller.abort(); };
}, []);
```

Then update `endpoints.js` to pass the signal through for `getAnalytics`:

```javascript
export const getAnalytics = (opts = {}) => api.get('/analytics', opts);
```

- [ ] **Step 7: Verify frontend builds without errors**

```bash
cd frontend && npm run build
```

Expected: build completes with no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Orders.jsx frontend/src/pages/Riders.jsx \
        frontend/src/pages/AllocationHistory.jsx frontend/src/pages/Restaurants.jsx \
        frontend/src/pages/Customers.jsx frontend/src/pages/Dashboard.jsx \
        frontend/src/api/endpoints.js
git commit -m "fix(frontend): add unmount guards to all page fetch hooks to prevent stale state updates"
```

---

## Task 4: Add disconnection banner

**Files:**
- Create: `frontend/src/components/common/ConnectionBanner.jsx`
- Create: `frontend/src/components/common/ConnectionBanner.module.css`
- Modify: `frontend/src/App.jsx` (or whatever file wraps the main layout — find with `grep -r "SimulationProvider" frontend/src`)

`SimulationContext` already tracks `connected`. This task adds a fixed-position warning strip that appears at the top of the screen when the WebSocket drops. Socket.IO auto-reconnects, so the banner auto-dismisses.

- [ ] **Step 1: Create ConnectionBanner.jsx**

```jsx
import { useSimulation } from '../../context/SimulationContext';
import styles from './ConnectionBanner.module.css';

export default function ConnectionBanner() {
  const { connected } = useSimulation();
  if (connected) return null;
  return (
    <div className={styles.banner} role="alert">
      Live feed disconnected — rider positions may be stale. Reconnecting…
    </div>
  );
}
```

- [ ] **Step 2: Create ConnectionBanner.module.css**

```css
.banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  background: #b45309;
  color: #fff;
  text-align: center;
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.01em;
}
```

- [ ] **Step 3: Mount ConnectionBanner in the layout root**

Find where `<SimulationProvider>` wraps the app (run `grep -r "SimulationProvider" frontend/src` to locate the file).

Add `<ConnectionBanner />` as the first child inside `<SimulationProvider>`. Example:

```jsx
import ConnectionBanner from './components/common/ConnectionBanner';

// inside the JSX:
<SimulationProvider>
  <ConnectionBanner />
  {/* ...rest of app/router... */}
</SimulationProvider>
```

- [ ] **Step 4: Start the dev server and verify**

```bash
cd frontend && npm run dev
```

Open the app, then in the browser console run `window.__simSocket?.disconnect()` (or stop the backend) and confirm the amber banner appears. Reconnect and confirm it disappears.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/common/ConnectionBanner.jsx \
        frontend/src/components/common/ConnectionBanner.module.css \
        frontend/src/App.jsx
git commit -m "feat(ui): show disconnection banner when WebSocket drops to prevent stale-data confusion"
```

---

## Task 5: Enable helmet CSP

**Files:**
- Modify: `backend/src/app.js`

The Express app serves API responses only (no HTML); the CSP headers here protect API responses from being embedded in attacker-controlled iframes and lock down what this origin can load. This does **not** cover the frontend HTML page — that requires nginx/Vite config separately.

- [ ] **Step 1: Read the current helmet call in app.js**

Run:
```bash
grep -n "helmet" backend/src/app.js
```

You'll see something like `app.use(helmet())` or `helmet({ contentSecurityPolicy: false })`.

- [ ] **Step 2: Replace the helmet call with explicit CSP config**

Find the helmet line and replace with:

```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'blob:', 'https://*.mapbox.com'],
      connectSrc:  ["'self'", 'https://*.mapbox.com', process.env.FRONTEND_URL || 'http://localhost:3000'],
      workerSrc:   ["'self'", 'blob:'],
      fontSrc:     ["'self'", 'data:'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
```

- [ ] **Step 3: Restart backend and verify headers**

```bash
cd backend && node src/server.js &
curl -I http://localhost:5000/api/health
```

Expected: response includes `Content-Security-Policy` header with `default-src 'self'`. Kill the server after checking.

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.js
git commit -m "security(csp): enable helmet Content-Security-Policy directives for API server"
```

---

## Task 6: Update production readiness review

**Files:**
- Modify: `docs/PRODUCTION_READINESS_REVIEW.md`

- [ ] **Step 1: Mark newly fixed items in the checklist**

In the `## 6. Production Readiness Checklist` section, add checkmarks for:
- `[x] H3 — Auto-order job wired` (was already fixed in simulationEngine.js before this plan)
- `[x] H17 — Mapbox concurrency limiter added`
- `[x] H13 — Unmount guards on all page fetch hooks`
- `[x] Reconnecting UX — ConnectionBanner shown on WS disconnect`
- `[x] Helmet CSP enabled`
- `[x] setWeights zero-total guard`

- [ ] **Step 2: Update scores**

Update the scores table:

| Category | Previous | Current |
|---|---|---|
| Security | 6.0 / 10 | **7.0 / 10** |
| Frontend | 7.5 / 10 | **8.0 / 10** |
| Performance | 5.5 / 10 | **6.5 / 10** |
| Production Readiness | 6.0 / 10 | **7.5 / 10** |

- [ ] **Step 3: Update the "Would you deploy?" verdict**

Change the remaining public-production gaps to only reflect truly unresolved items (H10 localStorage token, H15 idempotency, H1 race condition).

- [ ] **Step 4: Commit**

```bash
git add docs/PRODUCTION_READINESS_REVIEW.md
git commit -m "docs: update production readiness review after phase-2 fixes"
```

---

## Verification

After all tasks complete, run:

```bash
# Backend tests
cd backend && node --test src/tests/config.test.js src/tests/allocationEngine.test.js src/tests/validators.test.js src/tests/simulationState.test.js

# Frontend build
cd frontend && npm run build

# Manual smoke test
# 1. Start backend: cd backend && node src/server.js
# 2. Start frontend: cd frontend && npm run dev
# 3. Login, navigate to each page — no React console warnings about setState on unmounted
# 4. Stop the backend while on Dashboard — amber banner appears within 1–2s
# 5. Restart backend — banner disappears when socket reconnects
# 6. Try setting weights to 0/0/0 via PUT /api/config/weights — expect 500 with "positive number" message
# 7. Check response headers: curl -I http://localhost:5000/api/health | grep -i "content-security"
```
