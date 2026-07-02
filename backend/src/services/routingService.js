import { config } from '../config/env.js';

const MAPBOX_BASE = 'https://api.mapbox.com/directions/v5/mapbox/driving';
const MAX_CONCURRENT = 3;

let _active = 0;
const _queue = [];

// Route cache — reuses a recently-computed route instead of hitting the Mapbox Directions API
// again for the same (or a very close) rider/restaurant/customer coordinate triple. Restaurants
// and customers are static, so their contribution to the cache key is exact; rider coordinates
// are rounded to a ~111m grid, which is acceptable because simulationEngine.js already treats a
// fetched route as an enhancement over a straight-line lerp fallback — a slightly-off cached
// origin is no worse than that existing gap, and it self-corrects at the rider's next
// assignment. Keys expire after ROUTE_CACHE_TTL_MS; pruned opportunistically on each write,
// matching orderController.js's `_isDuplicate` idempotency-cache pattern.
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const _routeCache = new Map(); // key -> { route, expiresAt }
let _cacheHits = 0;
let _cacheMisses = 0;

function _round(n) {
  return Math.round(n * 1000) / 1000;
}

function _cacheKey(riderCoords, restaurantCoords, customerCoords) {
  return [riderCoords, restaurantCoords, customerCoords]
    .map((c) => `${_round(c.lat)},${_round(c.lng)}`)
    .join('|');
}

function _pruneRouteCache() {
  const now = Date.now();
  for (const [key, entry] of _routeCache) {
    if (entry.expiresAt <= now) _routeCache.delete(key);
  }
}

function _logCacheStats() {
  const total = _cacheHits + _cacheMisses;
  if (total > 0 && total % 20 === 0) {
    console.log(`[routing] route cache: ${_cacheHits}/${total} hits (${Math.round((_cacheHits / total) * 100)}%), ${_routeCache.size} cached entries`);
  }
}

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
  const key = _cacheKey(riderCoords, restaurantCoords, customerCoords);
  const hit = _routeCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    _cacheHits++;
    _logCacheStats();
    return Promise.resolve(hit.route);
  }

  _cacheMisses++;
  _logCacheStats();

  return new Promise((resolve, reject) => {
    _queue.push({
      resolve: (route) => {
        _pruneRouteCache();
        _routeCache.set(key, { route, expiresAt: Date.now() + ROUTE_CACHE_TTL_MS });
        resolve(route);
      },
      reject,
      args: [riderCoords, restaurantCoords, customerCoords],
    });
    _drain();
  });
}

function _extractCoords(leg) {
  const all = [];
  for (const step of leg.steps) all.push(...step.geometry.coordinates);
  return all.filter((c, i) => i === 0 || c[0] !== all[i - 1][0] || c[1] !== all[i - 1][1]);
}
