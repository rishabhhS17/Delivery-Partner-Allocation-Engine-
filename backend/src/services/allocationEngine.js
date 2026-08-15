import { latLngToCell, gridDisk } from 'h3-js';
import { haversine } from '../utils/haversine.js';
import {
  getH3Config,
  RIDER_SPEED_KMH,
  LOAD_WINDOW_MINUTES,
  HEAD_FREEZE_S,
  AGING_LOCK_S,
} from '../config/constants.js';

// Caches gridDisk results keyed by restaurant h3 cell. Keys are resolution-specific (a cell id
// encodes its resolution), but a change to candidateK at the same resolution would leave stale
// disks — so setH3Config() clears this via clearCandidateCache() below.
const diskCache = new Map();

// Called by the /config/h3 route after setH3Config so the next allocation recomputes candidate
// rings with the new resolution / candidateK instead of serving cached ones.
export function clearCandidateCache() {
  diskCache.clear();
}

export function getCandidateCells(restaurantLat, restaurantLng) {
  const { resolution, candidateK } = getH3Config();
  const cell = latLngToCell(restaurantLat, restaurantLng, resolution);
  if (!diskCache.has(cell)) {
    diskCache.set(cell, gridDisk(cell, candidateK));
  }
  return diskCache.get(cell);
}

/**
 * Pure scoring function — no DB I/O, no side effects.
 *
 * candidates: pre-geo-filtered array of Rider objects.
 *   Each must have: latitude, longitude, status,
 *   deliveryTimestamps, currentOrderId (null or populated Order doc
 *   with leg1Duration_s, leg2Duration_s, legStartedAt).
 *
 * Returns { winner, score, breakdown, candidatesConsidered } or null.
 */
export function allocateOrder(order, candidates, weights) {
  if (!candidates.length) return null;

  const now = Date.now();
  const restaurantCoords = { lat: order.restaurantLat, lng: order.restaurantLng };
  const loadWindowMs = LOAD_WINDOW_MINUTES * 60 * 1000;

  const scored = candidates.map(rider => ({
    rider,
    etar: computeEtar(rider, restaurantCoords, now),
    recentLoad: rider.deliveryTimestamps.filter(
      t => new Date(t).getTime() > now - loadWindowMs
    ).length,
  }));

  const maxEtar = Math.max(...scored.map(s => s.etar));
  const maxLoad = Math.max(...scored.map(s => s.recentLoad));
  // With a single candidate there is no relative comparison — give full ETAR/load scores.
  const solo = candidates.length === 1;

  const ranked = scored
    .map(s => {
      const etarScore  = (solo || maxEtar === 0) ? 1 : 1 - s.etar / maxEtar;
      const loadScore  = (solo || maxLoad === 0) ? 1 : 1 - s.recentLoad / maxLoad;
      const finalScore =
        weights.etar * etarScore +
        weights.load * loadScore;
      return {
        rider: s.rider,
        score: finalScore,
        breakdown: {
          etarScore,
          loadScore,
          rawEtar_s: s.etar,
          rawLoad:   s.recentLoad,
        },
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    winner:               ranked[0].rider,
    score:                ranked[0].score,
    breakdown:            ranked[0].breakdown,
    candidatesConsidered: candidates.length,
  };
}

// ─── Stage 3: marginal-cost clubbing machinery (Model A) ───────────────────────
//
// A stop is { type:'PICKUP'|'DROP', orderId, lat, lng, prepReadyAt?, promisedBy? }. The rider
// walks the list top-to-bottom from its live position. These helpers are pure (no I/O) and
// N-general: everything is driven by the array length, nothing is hardcoded to a cap of 2.

const _oid = (stop) => String(stop.orderId);
const _travel_s = (a, b) =>
  haversine({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) / RIDER_SPEED_KMH * 3600;

function _toRad(d) { return (d * Math.PI) / 180; }
function _toDeg(r) { return (r * 180) / Math.PI; }

// Initial bearing (degrees, 0–360) from point a to point b.
export function bearing(a, b) {
  const p1 = _toRad(a.lat), p2 = _toRad(b.lat);
  const dLng = _toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLng);
  return (_toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Smallest absolute angular difference between two bearings (0–180).
export function bearingDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function pickupStop(order) {
  return {
    type: 'PICKUP', orderId: order._id,
    lat: order.restaurantLat, lng: order.restaurantLng,
    prepReadyAt: order.prepReadyAt, promisedBy: order.promisedBy,
  };
}

export function dropStop(order) {
  return {
    type: 'DROP', orderId: order._id,
    lat: order.customerLat, lng: order.customerLng,
    promisedBy: order.promisedBy,
  };
}

// Traverse a stop-list from startPos, charging wait at each pickup as max(arrival, prepReadyAt)
// (prep-aware, from Stage 1). Returns total traversal time (s) and each order's DROP completion
// time (ms epoch) so deadlines can be validated.
export function simulateRoute(stops, startPos, now = Date.now()) {
  let elapsed_s = 0;
  let pos = startPos;
  const dropTimes = {};
  for (const stop of stops) {
    elapsed_s += _travel_s(pos, stop);
    if (stop.type === 'PICKUP' && stop.prepReadyAt) {
      const arrivalMs = now + elapsed_s * 1000;
      const readyMs = new Date(stop.prepReadyAt).getTime();
      if (readyMs > arrivalMs) elapsed_s += (readyMs - arrivalMs) / 1000; // wait for prep
    }
    if (stop.type === 'DROP') dropTimes[_oid(stop)] = now + elapsed_s * 1000;
    pos = stop;
  }
  return { totalTime_s: elapsed_s, dropTimes };
}

export function routeTime(stops, startPos, now = Date.now()) {
  return simulateRoute(stops, startPos, now).totalTime_s;
}

// Every DROP with a promisedBy must complete before that deadline in the given ordering.
export function deadlineOk(stops, startPos, now = Date.now()) {
  const { dropTimes } = simulateRoute(stops, startPos, now);
  for (const stop of stops) {
    if (stop.type === 'DROP' && stop.promisedBy) {
      if (dropTimes[_oid(stop)] > new Date(stop.promisedBy).getTime()) return false;
    }
  }
  return true;
}

// Insert B's pickup+drop at every valid position (pickup before drop, existing stops never
// reordered), reject orderings that fail deadlineOk / head-freeze / aging, and return the cheapest
// feasible ordering + its marginal cost. O(stops²). Returns null when no feasible insertion exists.
export function cheapestInsertion(stops, pickupB, dropB, startPos, now = Date.now()) {
  const base = simulateRoute(stops, startPos, now);
  const baseCost = base.totalTime_s;

  // Head-freeze: if the very next stop is a DROP arriving within HEAD_FREEZE_S, nothing may be
  // inserted ahead of it (append after) — so B's pickup can't take position 0.
  const headFrozen =
    stops.length > 0 &&
    stops[0].type === 'DROP' &&
    (base.dropTimes[_oid(stops[0])] - now) / 1000 <= HEAD_FREEZE_S;

  // Aging: an onboard order within AGING_LOCK_S of its promisedBy is immovable — the insertion
  // must not add ANY delay before its drop.
  const agingLocked = new Set();
  for (const s of stops) {
    if (s.type === 'DROP' && s.promisedBy &&
        (new Date(s.promisedBy).getTime() - now) / 1000 <= AGING_LOCK_S) {
      agingLocked.add(_oid(s));
    }
  }

  let best = null;
  for (let i = (headFrozen ? 1 : 0); i <= stops.length; i++) {
    for (let j = i + 1; j <= stops.length + 1; j++) {
      const ordering = stops.slice();
      ordering.splice(i, 0, pickupB);
      ordering.splice(j, 0, dropB);

      if (!deadlineOk(ordering, startPos, now)) continue;

      if (agingLocked.size) {
        const sim = simulateRoute(ordering, startPos, now);
        let ok = true;
        for (const id of agingLocked) {
          if (sim.dropTimes[id] > base.dropTimes[id] + 1e-3) { ok = false; break; }
        }
        if (!ok) continue;
      }

      const cost = routeTime(ordering, startPos, now);
      if (!best || cost < best.cost) {
        best = { ordering, cost, marginalCost: cost - baseCost };
      }
    }
  }
  return best;
}

// Unified clubbing allocator: every candidate (idle or busy) is scored by the marginal cost of
// inserting order B into its stop-list — an idle rider inserts into an empty list, so its marginal
// cost is a full fresh trip ≈ ETAR. Infeasible candidates (no legal insertion) are dropped; the
// rest are blended with recent load via the existing weights and the lowest-cost rider wins.
//
// candidates: [{ rider, startPos:{lat,lng}, stops:[...], deliveryTimestamps:[...] }]
// Returns { winner, ordering, marginalCost, score, breakdown, candidatesConsidered } | null.
export function allocateClub(order, candidates, weights, now = Date.now()) {
  if (!candidates.length) return null;

  const pickupB = pickupStop(order);
  const dropB   = dropStop(order);
  const loadWindowMs = LOAD_WINDOW_MINUTES * 60 * 1000;

  const evaluated = [];
  for (const c of candidates) {
    const ins = cheapestInsertion(c.stops ?? [], pickupB, dropB, c.startPos, now);
    if (!ins) continue; // no feasible insertion for this rider
    evaluated.push({
      candidate: c,
      ordering: ins.ordering,
      marginalCost: ins.marginalCost,
      recentLoad: (c.deliveryTimestamps ?? []).filter(
        t => new Date(t).getTime() > now - loadWindowMs
      ).length,
    });
  }
  if (!evaluated.length) return null;

  const maxCost = Math.max(...evaluated.map(e => e.marginalCost));
  const maxLoad = Math.max(...evaluated.map(e => e.recentLoad));
  const solo = evaluated.length === 1;

  const ranked = evaluated
    .map(e => {
      const costScore = (solo || maxCost === 0) ? 1 : 1 - e.marginalCost / maxCost;
      const loadScore = (solo || maxLoad === 0) ? 1 : 1 - e.recentLoad / maxLoad;
      const score = weights.etar * costScore + weights.load * loadScore;
      return {
        ...e,
        score,
        breakdown: {
          costScore, loadScore,
          rawMarginalCost_s: e.marginalCost,
          rawLoad: e.recentLoad,
        },
      };
    })
    .sort((a, b) => b.score - a.score);

  const win = ranked[0];
  return {
    winner: win.candidate,
    ordering: win.ordering,
    marginalCost: win.marginalCost,
    score: win.score,
    breakdown: win.breakdown,
    candidatesConsidered: evaluated.length,
  };
}

export function computeEtar(rider, restaurantCoords, now) {
  let timeToFree = 0;

  if (rider.status !== 'IDLE') {
    const activeOrder = rider.currentOrderId; // populated Order doc or null
    if (activeOrder && activeOrder.legStartedAt) {
      const legDuration_s =
        rider.status === 'ACCEPTED'
          ? activeOrder.leg1Duration_s
          : activeOrder.leg2Duration_s;
      const progress = Math.min(
        1,
        (now - new Date(activeOrder.legStartedAt).getTime()) / (legDuration_s * 1000)
      );
      timeToFree =
        rider.status === 'ACCEPTED'
          ? (1 - progress) * activeOrder.leg1Duration_s + (activeOrder.leg2Duration_s || 0)
          : (1 - progress) * activeOrder.leg2Duration_s;
    }
  }

  const travelTime_s =
    haversine({ lat: rider.latitude, lng: rider.longitude }, restaurantCoords) /
    RIDER_SPEED_KMH *
    3600;

  // Guard against NaN/Infinity (e.g. a busy rider with a missing leg duration) —
  // a non-finite ETAR must rank the rider last, never poison the comparison.
  const etar = timeToFree + travelTime_s;
  return Number.isFinite(etar) ? etar : Infinity;
}
