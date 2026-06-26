import { latLngToCell, gridDisk } from 'h3-js';
import { haversine } from '../utils/haversine.js';
import {
  H3_RESOLUTION,
  H3_CANDIDATE_K,
  RIDER_SPEED_KMH,
  LOAD_WINDOW_MINUTES,
} from '../config/constants.js';

// Caches gridDisk results keyed by restaurant h3 cell — never invalidates.
// latLngToCell is O(1); gridDisk(res7, k=2) always returns the same 19 cells
// for a given restaurant hex, so caching is safe and free.
const diskCache = new Map();

export function getCandidateCells(restaurantLat, restaurantLng) {
  const cell = latLngToCell(restaurantLat, restaurantLng, H3_RESOLUTION);
  if (!diskCache.has(cell)) {
    diskCache.set(cell, gridDisk(cell, H3_CANDIDATE_K));
  }
  return diskCache.get(cell);
}

/**
 * Pure scoring function — no DB I/O, no side effects.
 *
 * candidates: pre-geo-filtered array of Rider objects.
 *   Each must have: latitude, longitude, status, rating,
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
      const etarScore   = (solo || maxEtar === 0) ? 1 : 1 - s.etar / maxEtar;
      const ratingScore = s.rider.rating / 5;
      const loadScore   = (solo || maxLoad === 0) ? 1 : 1 - s.recentLoad / maxLoad;
      const finalScore  =
        weights.etar   * etarScore +
        weights.rating * ratingScore +
        weights.load   * loadScore;
      return {
        rider: s.rider,
        score: finalScore,
        breakdown: {
          etarScore,
          ratingScore,
          loadScore,
          rawEtar_s: s.etar,
          rawRating: s.rider.rating,
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

function computeEtar(rider, restaurantCoords, now) {
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

  return timeToFree + travelTime_s;
}
