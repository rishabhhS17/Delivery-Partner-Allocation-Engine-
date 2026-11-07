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
  AGING_LOCK_S,
} from '../config/constants.js';
import { haversine } from '../utils/haversine.js';
import { riderState, h3Buckets, pendingQueue, recentAssignments, RECENT_CAP } from './state.js';
import { _meta } from './itinerary.js';
import { saveAssignment, saveAllocationRecord, saveCancellation, appendOrderEvent } from './storage.js';
import { _freeSlot, _syncIndex } from './h3Index.js';
import { _beginLegToHead } from './riderLifecycle.js';
import { publish } from './broadcast.js';
import { recordTimeToAssignMs } from './health.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('engine');

// Drop orders that waited too long AFTER becoming dispatchable (TTL fix).
// Measured from prepReadyAt so a JIT-held order is never cancelled for sitting through prep.
// The cancellation is saved first and only then announced.
export async function _cancelExpiredOrders(now) {
  const ttlCutoff = now - getOrderTtl();
  for (const [orderId, order] of [...pendingQueue]) {
    const dispatchableMs = order.prepReadyAt
      ? new Date(order.prepReadyAt).getTime()
      : ((order.queuedAt ?? order.createdAt)?.getTime?.() ?? now);
    if (dispatchableMs > ttlCutoff) continue;

    let isCancelled;
    try {
      isCancelled = await saveCancellation(order._id, now, 'no_rider');
    } catch (err) {
      log.error('TTL cancel write failed, will retry', { orderId, error: err.message });
      continue;
    }
    pendingQueue.delete(orderId);
    if (!isCancelled) continue; // the order had already changed (assigned or cancelled elsewhere)
    appendOrderEvent(order._id, 'cancelled', { details: { reason: 'no_rider' } });
    publish('order:cancelled', { orderId, reason: 'no_rider' });
    log.warn('order TTL expired, cancelled', { orderId, reason: 'no_rider' });
  }
}

// An order that made dispatch throw is cancelled with reason 'engine_error' instead of being
// retried: retrying would throw again every round (and after a restart), so one bad order could
// otherwise stall dispatch for the whole city (decision E5, amended 2026-11-07).
export async function _cancelOrderAfterEngineError(orderId, order, err) {
  log.error('dispatch failed for this order, cancelling it', { orderId, reason: 'engine_error', error: err });
  pendingQueue.delete(orderId);
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

// Picks the rider for one queued order. Pure decision, no writes: returns the chosen rider and
// score, or null when the order stays queued (no rider, or the just-in-time hold says not yet).
// skipJitHold chooses now instead of waiting for the departure moment (manual dispatch).
export function _chooseAssignment(orderId, order, now, { skipJitHold = false } = {}) {
  const promisedByMs = order.promisedBy ? new Date(order.promisedBy).getTime() : Infinity;
  const force = skipJitHold || (promisedByMs - now) / 1000 <= AGING_LOCK_S; // PENDING anti-starvation backstop

  const cells = getCandidateCells(order.restaurantLat, order.restaurantLng);
  const { maxRangeKm } = getH3Config();
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
      if (!_freeSlot(r)) continue;                   // no capacity
      if (haversine({ lat: r.lat, lng: r.lng }, restaurant) > maxRangeKm) continue; // range gate (authority)
      const isIdle = r.orders.size === 0;
      if (!isIdle && !_clubbable(r, order)) continue; // busy → clubbing gate
      candidates.push({
        rider: r,
        startPos: { lat: r.lat, lng: r.lng },
        stops: r.stops,
        deliveryTimestamps: r.deliveryTimestamps,
      });
    }
  }
  if (!candidates.length) return null;

  const result = allocateClub(order, candidates, getWeights(), now);
  if (!result) return null;

  const winner = result.winner.rider;

  // JIT hold — commit only once now ≥ departBy (unless force-assigning near the deadline).
  if (!force) {
    const travel_s = haversine({ lat: winner.lat, lng: winner.lng }, restaurant) / RIDER_SPEED_KMH * 3600;
    const grace_s  = order.jitGrace_s ?? 0;
    const prepReadyMs = order.prepReadyAt ? new Date(order.prepReadyAt).getTime() : now;
    const departBy = prepReadyMs - (travel_s + grace_s) * 1000;
    if (now < departBy) return null; // hold this tick
  }

  return { orderId, order, winnerId: winner._id.toString(), result };
}

// Saves the assignment, then applies and announces it. The save is one conditional update on the
// order (it must still be PENDING), so nothing is broadcast that the database does not hold.
// Returns the assignment summary, or null when it could not be saved.
export async function _commitAssignment({ orderId, order, winnerId, result }) {
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
    pendingQueue.delete(orderId);
    log.warn('order was no longer PENDING at save time, dropped from queue', { orderId });
    return null;
  }
  pendingQueue.delete(orderId);
  if (order.createdAt) recordTimeToAssignMs(now - new Date(order.createdAt).getTime());
  appendOrderEvent(order._id, 'assigned', {
    riderId: result.winner.rider._id,
    details: { score: result.score, candidatesConsidered: result.candidatesConsidered },
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
