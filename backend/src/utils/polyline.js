import { haversine } from './haversine.js';

// ─── Position along a leg ────────────────────────────────────────────────────
// A rider's position is a pure function of their leg and how far they have travelled along it,
// so the same position can be rebuilt at any moment (after a restart, too) from the leg's start
// time and the clock. The path is the road route when there is one, else a straight line.

// Cumulative metres at each point of a path, cached per coords array (one leg's route).
const cumulativeMetresByPath = new WeakMap();

function cumulativeMetres(path) {
  let cumulative = cumulativeMetresByPath.get(path);
  if (cumulative) return cumulative;
  cumulative = [0];
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to   = path[i];
    cumulative.push(cumulative[i - 1] + haversine({ lat: from[1], lng: from[0] }, { lat: to[1], lng: to[0] }) * 1000);
  }
  cumulativeMetresByPath.set(path, cumulative);
  return cumulative;
}

/**
 * Where a rider is after travelling `metresTravelled` along a leg.
 * @param {{ originLat: number, originLng: number, targetLat: number, targetLng: number,
 *           coords?: number[][] }} leg  coords is the road route as [lng, lat] points.
 * @param {number} metresTravelled
 * @returns {{ lat: number, lng: number, segmentIdx: number, isComplete: boolean }}
 */
export function positionAlongLeg(leg, metresTravelled) {
  const path = leg.coords?.length >= 2
    ? leg.coords
    : [[leg.originLng, leg.originLat], [leg.targetLng, leg.targetLat]];
  const cumulative = cumulativeMetres(path);
  const totalMetres = cumulative[cumulative.length - 1];

  if (metresTravelled >= totalMetres) {
    const last = path[path.length - 1];
    return { lat: last[1], lng: last[0], segmentIdx: path.length - 1, isComplete: true };
  }

  // Binary search for the segment containing the travelled distance.
  let low = 0;
  let high = cumulative.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (cumulative[middle] <= metresTravelled) low = middle; else high = middle;
  }
  const segmentMetres = cumulative[high] - cumulative[low];
  const t = segmentMetres > 0 ? (metresTravelled - cumulative[low]) / segmentMetres : 0;
  const from = path[low];
  const to   = path[high];
  return {
    lat: from[1] + t * (to[1] - from[1]),
    lng: from[0] + t * (to[0] - from[0]),
    segmentIdx: low,
    isComplete: false,
  };
}
