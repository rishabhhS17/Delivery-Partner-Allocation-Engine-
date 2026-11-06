import { getCandidateCells, allocateClub, bearing, bearingDiff } from '../allocationEngine.js';
import {
  getWeights,
  RIDER_SPEED_KMH,
  getH3Config,
  getOrderTtl,
  CLUBBING_RESTAURANT_RADIUS_KM,
  CLUBBING_DROP_RADIUS_KM,
  CLUBBING_BEARING_TOLERANCE_DEG,
  AGING_LOCK_S,
} from '../../config/constants.js';
import { haversine } from '../../utils/haversine.js';
import Rider from '../../models/Rider.js';
import Order from '../../models/Order.js';
import AllocationHistory from '../../models/AllocationHistory.js';
import { riderState, h3Buckets, pendingQueue, recentAssignments, RECENT_CAP, runtime } from './state.js';
import { _meta, _onboardIdsFromStops } from './itinerary.js';
import { _freeSlot, _syncIndex } from './h3Index.js';
import { _beginLegToHead } from './riderTrip.js';

// Drop orders that waited too long AFTER becoming dispatchable (TTL fix).
// Measured from prepReadyAt so a JIT-held order is never cancelled for sitting through prep.
export function _cancelExpiredOrders(now) {
  const ttlCutoff = now - getOrderTtl();
  for (const [orderId, order] of pendingQueue) {
    const dispatchableMs = order.prepReadyAt
      ? new Date(order.prepReadyAt).getTime()
      : ((order.queuedAt ?? order.createdAt)?.getTime?.() ?? now);
    if (dispatchableMs > ttlCutoff) continue;

    pendingQueue.delete(orderId);
    Order.findByIdAndUpdate(order._id, {
      status: 'CANCELLED', cancelledAt: new Date(now), assignedRiderId: null,
    }).catch(err => console.error('[sim] TTL cancel write failed:', err.message));
    if (runtime.io) runtime.io.emit('order:cancelled', { orderId, reason: 'no_rider' });
    console.warn('[sim] order TTL expired → CANCELLED', orderId);
  }
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

export function _tryAllocate(orderId, order, now) {
  const promisedByMs = order.promisedBy ? new Date(order.promisedBy).getTime() : Infinity;
  const force = (promisedByMs - now) / 1000 <= AGING_LOCK_S; // PENDING anti-starvation backstop

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
  if (!candidates.length) return;

  const result = allocateClub(order, candidates, getWeights(), now);
  if (!result) return;

  const winner   = result.winner.rider;
  const winnerId = winner._id.toString();

  // JIT hold — commit only once now ≥ departBy (unless force-assigning near the deadline).
  if (!force) {
    const travel_s = haversine({ lat: winner.lat, lng: winner.lng }, restaurant) / RIDER_SPEED_KMH * 3600;
    const grace_s  = order.jitGrace_s ?? 0;
    const prepReadyMs = order.prepReadyAt ? new Date(order.prepReadyAt).getTime() : now;
    const departBy = prepReadyMs - (travel_s + grace_s) * 1000;
    if (now < departBy) return; // hold this tick
  }

  _commitAssignment(order, orderId, winner, winnerId, result, now);
}

function _commitAssignment(order, orderId, winner, winnerId, result, now) {
  pendingQueue.delete(orderId);

  winner.orders.set(order._id.toString(), _meta(order));
  winner.stops = result.ordering;
  winner.currentOrderId = winner.stops[0].orderId;
  winner.nextLegCoords = [];        // stale after re-planning → refetch
  _syncIndex(winnerId, winner);     // may remove from index if now at capacity
  _beginLegToHead(winner, now, winnerId);

  Promise.all([
    Order.findByIdAndUpdate(order._id, {
      status: 'ASSIGNED',
      assignedRiderId: winner._id,
      assignedAt: new Date(now),
      allocationScore: result.score,
    }),
    Rider.findByIdAndUpdate(winner._id, {
      status:          winner.status,
      currentOrderId:  winner.currentOrderId,
      onboardOrderIds: _onboardIdsFromStops(winner),
      activeOrders:    winner.orders.size,
    }),
    AllocationHistory.create({
      orderId: order._id,
      riderId: winner._id,
      allocationScore: result.score,
      breakdown: result.breakdown,
      candidatesConsidered: result.candidatesConsidered,
    }),
  ]).catch(err => console.error('[sim] assign write failed:', err.message));

  if (runtime.io) {
    const payload = {
      orderId:        order._id.toString(),
      riderId:        winnerId,
      riderName:      winner.name,
      restaurantName: order.restaurantName,
      customerName:   order.customerName,
      score:          result.score,
      carrying:       winner.orders.size,
      ts:             now,
    };
    runtime.io.emit('order:assigned', payload);
    recentAssignments.push(payload);
    if (recentAssignments.length > RECENT_CAP) recentAssignments.shift();
  }
}
