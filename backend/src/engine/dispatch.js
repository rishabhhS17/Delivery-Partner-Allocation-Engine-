import {
  getCandidateCells, allocateClub, bearing, bearingDiff, cheapestInsertion, pickupStop, dropStop,
} from '../services/allocationEngine.js';
import {
  getWeights,
  RIDER_SPEED_KMH,
  getH3Config,
  getOrderTtl,
  CLUBBING_RESTAURANT_RADIUS_KM,
  CLUBBING_DROP_RADIUS_KM,
  CLUBBING_BEARING_TOLERANCE_DEG,
  MAX_SCORED_CANDIDATES,
  searchRangeKm,
} from '../config/constants.js';
import { haversine } from '../utils/haversine.js';
import { riderState, h3Buckets, pendingQueue, recentAssignments, RECENT_CAP } from './state.js';
import { _meta } from './itinerary.js';
import { saveAssignment, saveAllocationRecord, saveCancellation, appendOrderEvent, saveDispatchStarted } from './storage.js';
import { _freeSlot, _syncIndex } from './h3Index.js';
import { _beginLegToHead } from './riderLifecycle.js';
import { publish } from './broadcast.js';
import { recordTimeToAssignMs } from './health.js';
import { dequeueOrder, countScoring, forceAssignAt } from './wakeList.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('engine');

// Drop orders that waited too long AFTER becoming dispatchable (TTL fix).
// Measured from prepReadyAt so a JIT-held order is never cancelled for sitting through prep.
// The cancellation is saved first and only then announced.
export async function _cancelExpiredOrders(now) {
  const cancelledOrderIds = [];
  const ttlCutoff = now - getOrderTtl();
  for (const [orderId, order] of [...pendingQueue]) {
    // Dispatchable from when the food is ready or when it (re)entered the queue, whichever is
    // later — so an order a rider gave back gets a fresh window to find another rider.
    const queuedMs = new Date(order.queuedAt ?? order.createdAt ?? now).getTime();
    const dispatchableMs = Math.max(order.prepReadyAt ? new Date(order.prepReadyAt).getTime() : 0, queuedMs);
    if (dispatchableMs > ttlCutoff) continue;

    let isCancelled;
    try {
      isCancelled = await saveCancellation(order._id, now, 'no_rider');
    } catch (err) {
      log.error('TTL cancel write failed, will retry', { orderId, error: err.message });
      continue;
    }
    dequeueOrder(orderId);
    if (!isCancelled) continue; // the order had already changed (assigned or cancelled elsewhere)
    appendOrderEvent(order._id, 'cancelled', { details: { reason: 'no_rider' } });
    publish('order:cancelled', { orderId, reason: 'no_rider' });
    log.warn('order TTL expired, cancelled', { orderId, reason: 'no_rider' });
    cancelledOrderIds.push(orderId);
  }
  return cancelledOrderIds;
}

// An order that made dispatch throw is cancelled with reason 'engine_error' instead of being
// retried: retrying would throw again every round (and after a restart), so one bad order could
// otherwise stall dispatch for the whole city (decision E5, amended 2026-11-07).
export async function _cancelOrderAfterEngineError(orderId, order, err) {
  log.error('dispatch failed for this order, cancelling it', { orderId, reason: 'engine_error', error: err });
  dequeueOrder(orderId);
  try {
    if (!(await saveCancellation(order._id, Date.now(), 'engine_error'))) return;
  } catch (saveErr) {
    log.error('could not save the engine_error cancellation', { orderId, error: saveErr.message });
    return; // the order is still PENDING in the database and will be retried after a restart
  }
  appendOrderEvent(order._id, 'cancelled', { details: { reason: 'engine_error', error: String(err?.message ?? err) } });
  publish('order:cancelled', { orderId, reason: 'engine_error' });
}

// Busy-rider clubbing gate: B's restaurant near the rider's path, and B's drop near an existing
// drop in a compatible direction (drop-to-drop bearing within tolerance).
function _clubbable(rider, order) {
  const restB = { lat: order.restaurantLat, lng: order.restaurantLng };
  const dropB = { lat: order.customerLat,   lng: order.customerLng };

  let nearRest = haversine({ lat: rider.lat, lng: rider.lng }, restB) <= CLUBBING_RESTAURANT_RADIUS_KM;
  if (!nearRest) {
    for (const s of rider.stops) {
      if (haversine({ lat: s.lat, lng: s.lng }, restB) <= CLUBBING_RESTAURANT_RADIUS_KM) { nearRest = true; break; }
    }
  }
  if (!nearRest) return false;

  const origin  = { lat: rider.lat, lng: rider.lng };
  const bearToB = bearing(origin, dropB);
  for (const s of rider.stops) {
    if (s.type !== 'DROP') continue;
    if (haversine({ lat: s.lat, lng: s.lng }, dropB) <= CLUBBING_DROP_RADIUS_KM &&
        bearingDiff(bearing(origin, { lat: s.lat, lng: s.lng }), bearToB) <= CLUBBING_BEARING_TOLERANCE_DEG) {
      return true;
    }
  }
  return false;
}

// Picks the rider for one queued order. Pure decision, no writes. Returns one of:
//   { kind: 'assign', … }      — assign now to the chosen rider
//   { kind: 'hold', wakeAt }   — the best rider need not leave yet: look again at wakeAt
//   { kind: 'no_rider' }       — nobody in range with room
// skipJitHold chooses now instead of waiting for the departure moment (manual dispatch).
export function _chooseAssignment(orderId, order, now, options = {}) {
  const decision = scoreOrderForDispatch(orderId, order, now, options);
  // Waiting for the food is not a failed search, so the widening clock starts at the first real
  // try: nobody in range, or the moment to send a rider.
  if (decision.kind !== 'hold') startSearchClock(orderId, order, now);
  return decision;
}

function scoreOrderForDispatch(orderId, order, now, { skipJitHold = false } = {}) {
  const force = skipJitHold || now >= forceAssignAt(order); // PENDING anti-starvation backstop
  const timesScored = countScoring(orderId);
  const maxRangeKm = currentSearchRangeKm(orderId, order, now);

  const cells = getCandidateCells(order.restaurantLat, order.restaurantLng, maxRangeKm);
  const restaurant = { lat: order.restaurantLat, lng: order.restaurantLng };

  const seen = new Set();
  const candidates = [];
  for (const cell of cells) {
    const bucket = h3Buckets.get(cell);
    if (!bucket) continue;
    for (const rid of bucket) {
      if (seen.has(rid)) continue;
      seen.add(rid);
      const r = riderState.get(rid);
      if (!r || r.status === 'WAITING') continue;   // don't disturb a parked pickup
      if (r.openOffer) continue;                     // one offer at a time
      if (hasRejected(order, rid)) continue;         // never re-offer an order a rider rejected
      if (!_freeSlot(r)) continue;                   // no capacity
      const distanceKm = haversine({ lat: r.lat, lng: r.lng }, restaurant);
      if (distanceKm > maxRangeKm) continue;          // range gate (authority)
      const isIdle = r.orders.size === 0;
      if (!isIdle && !_clubbable(r, order)) continue; // busy → clubbing gate
      candidates.push({
        rider: r,
        startPos: { lat: r.lat, lng: r.lng },
        stops: r.stops,
        deliveryTimestamps: r.deliveryTimestamps,
        distanceKm,
      });
    }
  }
  if (!candidates.length) return { kind: 'no_rider' };

  // Score only the nearest few: far riders almost never win, and scoring is the costly part.
  const nearestCandidates = candidates.length > MAX_SCORED_CANDIDATES
    ? candidates.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, MAX_SCORED_CANDIDATES)
    : candidates;
  const result = allocateClub(order, nearestCandidates, getWeights(), now);
  if (!result) return { kind: 'no_rider' };

  const winner = result.winner.rider;

  // JIT hold — commit only once now ≥ departBy (unless force-assigning near the deadline).
  if (!force) {
    const travel_s = haversine({ lat: winner.lat, lng: winner.lng }, restaurant) / RIDER_SPEED_KMH * 3600;
    const grace_s  = order.jitGrace_s ?? 0;
    const prepReadyMs = order.prepReadyAt ? new Date(order.prepReadyAt).getTime() : now;
    const departBy = prepReadyMs - (travel_s + grace_s) * 1000;
    if (now < departBy) return { kind: 'hold', wakeAt: Math.min(departBy, forceAssignAt(order)) };
  }

  return { kind: 'assign', orderId, order, winnerId: winner._id.toString(), result, timesScored };
}

// The radius grows the longer dispatch has been trying (decision G1). The clock starts at the
// first real try (see _chooseAssignment) and is saved, so a restart does not reset it.
function currentSearchRangeKm(orderId, order, now) {
  const triedForMs = order.dispatchStartedAt ? now - new Date(order.dispatchStartedAt).getTime() : 0;
  const rangeKm = searchRangeKm(triedForMs);
  if (order.searchRangeKm && rangeKm > order.searchRangeKm) {
    appendOrderEvent(order._id, 'search_widened', { details: { rangeKm } });
    log.info('search widened', { orderId, rangeKm });
  }
  order.searchRangeKm = rangeKm;
  return rangeKm;
}

function startSearchClock(orderId, order, now) {
  if (order.dispatchStartedAt) return;
  order.dispatchStartedAt = new Date(now);
  saveDispatchStarted(order._id, now)
    .catch(err => log.error('dispatch start write failed', { orderId, error: err.message }));
}

function hasRejected(order, riderId) {
  return (order.rejectedRiderIds ?? []).some(id => String(id) === riderId);
}

// Score the order for one given rider (used when an offer made before a restart is accepted,
// since the original scoring is not saved). Returns an 'assign' decision, or null if it no
// longer fits that rider's stops.
export function _decisionForRider(orderId, order, rider, now) {
  const candidate = {
    rider, startPos: { lat: rider.lat, lng: rider.lng }, stops: rider.stops, deliveryTimestamps: rider.deliveryTimestamps,
  };
  const result = allocateClub(order, [candidate], getWeights(), now);
  return result ? { kind: 'assign', orderId, order, winnerId: rider._id.toString(), result, timesScored: null } : null;
}

// Saves the assignment, then applies and announces it. The save is one conditional update on the
// order (it must still be PENDING), so nothing is broadcast that the database does not hold.
// Returns the assignment summary, or null when it could not be saved.
export async function _commitAssignment({ orderId, order, winnerId, result, timesScored }) {
  const now = Date.now();
  let isSaved;
  try {
    isSaved = await saveAssignment(order._id, result.winner.rider._id, result.score, now);
  } catch (err) {
    log.error('assignment write failed, order stays queued', { orderId, riderId: winnerId, error: err.message });
    return null;
  }
  if (!isSaved) {
    // Someone else changed the order (cancelled, or assigned elsewhere) — it is no longer ours.
    dequeueOrder(orderId);
    log.warn('order was no longer PENDING at save time, dropped from queue', { orderId });
    return null;
  }
  dequeueOrder(orderId);
  if (order.createdAt) recordTimeToAssignMs(now - new Date(order.createdAt).getTime());
  appendOrderEvent(order._id, 'assigned', {
    riderId: result.winner.rider._id,
    details: { score: result.score, candidatesConsidered: result.candidatesConsidered, timesScored },
  });
  saveAllocationRecord(order._id, result.winner.rider._id, result)
    .catch(err => log.error('allocation history write failed', { orderId, error: err.message }));

  const winner = riderState.get(winnerId);

  // The rider may have moved on (picked up or delivered) while the save was in flight, so plan
  // the insertion again against their current stops.
  const insertion = cheapestInsertion(winner.stops, pickupStop(order), dropStop(order),
    { lat: winner.lat, lng: winner.lng }, now);
  winner.orders.set(orderId, _meta(order));
  winner.stops = insertion ? insertion.ordering : [...winner.stops, pickupStop(order), dropStop(order)];
  winner.currentOrderId = winner.stops[0].orderId;
  winner.nextLegCoords = [];        // stale after re-planning → refetch
  _syncIndex(winnerId, winner);     // may remove from index if now at capacity
  _beginLegToHead(winner, now, winnerId);

  const payload = {
    orderId,
    riderId:        winnerId,
    riderName:      winner.name,
    restaurantName: order.restaurantName,
    customerName:   order.customerName,
    score:          result.score,
    carrying:       winner.orders.size,
    ts:             now,
  };
  publish('order:assigned', payload);
  recentAssignments.push(payload);
  if (recentAssignments.length > RECENT_CAP) recentAssignments.shift();

  return { riderId: winnerId, riderName: winner.name, score: result.score, breakdown: result.breakdown,
           candidatesConsidered: result.candidatesConsidered };
}
