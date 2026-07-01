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
