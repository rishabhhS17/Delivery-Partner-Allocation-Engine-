import { config } from '../config/env.js';

const MAPBOX_BASE = 'https://api.mapbox.com/directions/v5/mapbox/driving';

// ONE Directions API call with 3 waypoints → two legs of coords + real durations
export async function getRoute(riderCoords, restaurantCoords, customerCoords) {
  if (!config.mapboxToken) throw new Error('MAPBOX_TOKEN not set in environment');

  const waypoints = [
    `${riderCoords.lng},${riderCoords.lat}`,
    `${restaurantCoords.lng},${restaurantCoords.lat}`,
    `${customerCoords.lng},${customerCoords.lat}`,
  ].join(';');

  const url = `${MAPBOX_BASE}/${waypoints}?geometries=geojson&steps=true&access_token=${config.mapboxToken}`;

  // Abort the request if Mapbox doesn't respond within 10s so a hung upstream
  // never stalls the simulation tick — callers fall back to lerp on rejection.
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

function _extractCoords(leg) {
  const all = [];
  for (const step of leg.steps) all.push(...step.geometry.coordinates);
  // Remove consecutive duplicates that appear at step join points
  return all.filter((c, i) => i === 0 || c[0] !== all[i - 1][0] || c[1] !== all[i - 1][1]);
}
